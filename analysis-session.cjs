'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {parseAnalysis, digest, resolveSection, contains, projectGraph, overviewSources} = require('./analysis.cjs');
const {analysisHtml} = require('./webview.cjs');

async function safeUri(vscode, root, file) {
    if (root.scheme !== 'file') throw new Error('Нужна папка workspace с файловой системой (file:)');
    const base = await fs.realpath(root.fsPath);
    const target = await fs.realpath(path.resolve(base, file));
    const relative = path.relative(base, target);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Путь выходит за корень проекта: ' + file);
    if (!(await fs.stat(target)).isFile()) throw new Error('Не обычный файл: ' + file);
    return vscode.Uri.file(target);
}

async function createAnalysisSession(vscode, root, analysisUri) {
    async function load() {
        const data = parseAnalysis(await vscode.workspace.fs.readFile(analysisUri));
        const files = new Map();
        for (const entry of data.entries.filter(item => item.kind === 'file')) {
            try {
                const uri = await safeUri(vscode, root, entry.path);
                const logical = vscode.Uri.file(path.resolve(root.fsPath, entry.path));
                const existing = vscode.workspace.textDocuments?.find(document => [uri.toString(), logical.toString()].includes(document.uri.toString()));
                if (!existing) new TextDecoder('utf-8', {fatal: true}).decode(await vscode.workspace.fs.readFile(uri));
                const document = existing || await vscode.workspace.openTextDocument(uri);
                files.set(entry.path, {uri: document.uri, realUri: uri, document});
            } catch (error) { files.set(entry.path, {error: error.message}); }
        }
        return {data, files};
    }
    let {data, files} = await load();
    const panel = vscode.window.createWebviewPanel('agentAnalysis', data.title,
        {viewColumn: vscode.ViewColumn.Beside, preserveFocus: true}, {enableScripts: true, localResourceRoots: []});
    const decoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        border: '1px solid', borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder')
    });
    let route = {kind: 'overview'};
    let activeNode = null;
    let bound;
    let revision = 0;
    let epoch = 0;
    let reloadId = 0;
    let disposed = false;
    let highlighted;
    let loadError = '';
    let actionError = '';
    let detailLocked = false;
    let column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;
    const history = [];
    const expanded = new Map();
    const openGroups = () => {
        if (!expanded.has(route.id)) expanded.set(route.id, new Set());
        return expanded.get(route.id);
    };
    const subscriptions = [];
    const section = () => data.sections.find(item => item.id === route.id);
    // Moving through the code opens a section folded; the active block still gets highlighted.
    const foldSection = () => {
        if (route.kind === 'section') openGroups().clear();
    };
    const clear = () => {
        highlighted?.setDecorations(decoration, []);
        highlighted = undefined;
    };
    function rebind() {
        bound = undefined;
        const selected = route.kind === 'section' && section();
        if (!selected) return;
        const file = files.get(selected.file);
        bound = file?.document ? resolveSection(file.document.getText(), selected)
            : {...selected, bindingError: file?.error || 'Файл недоступен', nodes: selected.nodes.map(node => ({...node, bindingError: file?.error || 'Файл недоступен'})),
                groups: selected.groups?.map(group => ({...group, bindingError: file?.error || 'Файл недоступен'}))};
    }
    function send(fromEditor = false) {
        if (disposed) return;
        revision++;
        const overviewCode = Object.fromEntries(data.overview.nodes.map(node => [node.id, overviewSources(data, node).map(source => {
            const file = files.get(source.file);
            const resolved = file?.document ? resolveSection(file.document.getText(), {...source, nodes: []}) : {bindingError: file?.error || 'Файл недоступен'};
            return {...source, binding: resolved.binding, bindingError: resolved.bindingError};
        })]));
        panel.webview.postMessage({type: 'analysis-state', revision, data, route, bound, activeNode, detailLocked, fromEditor, overviewCode,
            graph: bound?.layout === 'graph' ? projectGraph(bound, openGroups()) : undefined, expanded: bound ? [...openGroups()] : [],
            canBack: history.length > 0, loadError, actionError,
            freshness: Object.fromEntries(data.entries.filter(item => item.kind === 'file').map(entry => {
                const file = files.get(entry.path);
                return [entry.path, file?.document ? (digest(file.document.getText()) === entry.sha256 ? 'same' : 'changed') : 'unavailable'];
            }))});
    }
    function navigate(next, remember = true) {
        ++epoch;
        clear();
        if (remember) history.push({...route, activeNode});
        route = next;
        activeNode = next.activeNode || null;
        actionError = '';
        rebind();
        if (detailLocked) foldSection();
        send();
    }
    function follow(editor, selections = editor?.selections || [editor?.selection]) {
        if (!editor || disposed) return;
        ++epoch;
        clear();
        activeNode = null;
        const selection = selections.length === 1 && selections[0];
        const matches = [];
        if (selection?.start && selection?.end) {
            for (const candidate of data.sections) {
                const file = files.get(candidate.file);
                if (!file?.document || file.uri.toString() !== editor.document.uri.toString()) continue;
                const resolved = resolveSection(editor.document.getText(), candidate);
                if (resolved.binding && contains(resolved.binding, selection)) matches.push(resolved);
            }
            let selected = matches.find(item => route.kind === 'section' && item.id === route.id);
            if (!selected && matches.length === 1) selected = matches[0];
            if (selected) {
                const switching = route.kind !== 'section' || route.id !== selected.id;
                if (switching) history.push({...route});
                route = {kind: 'section', id: selected.id};
                bound = selected;
                foldSection();
                column = editor.viewColumn || column;
                const nodes = bound.nodes.filter(node => node.binding && contains(node.binding, selection));
                if (nodes.length === 1) {
                    activeNode = nodes[0].id;
                } else if (!nodes.length) {
                    const groups = (bound.groups || []).filter(group => group.id && group.binding && contains(group.binding, selection));
                    if (groups.length === 1) activeNode = groups[0].id;
                }
            }
        }
        send(true);
    }
    async function revealSource(source, hover = false, selected, nodeId) {
        const current = epoch;
        const filePath = source.file;
        const file = files.get(filePath);
        if (!file?.document) throw new Error(file?.error || 'Файл недоступен');
        // Recheck confinement immediately before acting; never trust a path sent by the panel.
        const uri = await safeUri(vscode, root, filePath);
        if (disposed || current !== epoch) return;
        if (uri.toString() !== file.realUri.toString()) throw new Error('Назначение ссылки изменилось; перезагрузите анализ');
        if (file.document.isClosed) {
            file.document = await vscode.workspace.openTextDocument(file.uri);
            if (disposed || current !== epoch) return;
            rebind();
        }
        const version = file.document.version;
        const resolvedSection = resolveSection(file.document.getText(), selected || {range: source.range, nodes: []});
        const target = selected ? [...resolvedSection.nodes, ...(resolvedSection.groups || [])].find(item => item.id === nodeId) : resolvedSection;
        const resolved = target?.binding;
        if (!resolved) throw new Error(target?.bindingError || 'Неоднозначный диапазон кода');
        let editor = vscode.window.visibleTextEditors.find(item => item.document === file.document && item.viewColumn === column);
        if (!hover) editor = await vscode.window.showTextDocument(file.document, {viewColumn: column, preserveFocus: true, preview: false});
        if (disposed || current !== epoch || version !== file.document.version || !editor) return;
        const range = new vscode.Range(resolved.start.line, resolved.start.character, resolved.end.line, resolved.end.character);
        clear();
        editor.setDecorations(decoration, [range]);
        if (!hover) editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        highlighted = editor;
    }
    const reveal = (node, callee = false, hover = false) => callee
        ? revealSource(node.callee, hover)
        : revealSource({file: section().file}, hover, section(), node.id);
    subscriptions.push(panel.webview.onDidReceiveMessage(async message => {
        if (disposed || !message || typeof message !== 'object') return;
        if (message.type === 'ready') return send();
        if (message.revision !== revision) return;
        let actionEpoch = epoch;
        try {
            if (message.type === 'reload') {
                const id = ++reloadId;
                try {
                    const next = await load();
                    if (disposed || id !== reloadId) return;
                    ++epoch; clear();
                    data = next.data; files = next.files; loadError = ''; actionError = '';
                    history.length = 0; expanded.clear();
                    if (route.kind === 'section' && !section()) route = {kind: 'overview'};
                    if (route.kind === 'path' && !data.entries.some(entry => entry.path === route.id)) route = {kind: 'overview'};
                    activeNode = null;
                    panel.title = data.title;
                    rebind(); send();
                } catch (error) {
                    if (!disposed && id === reloadId) { loadError = 'Новая версия не загружена: ' + error.message; send(); }
                }
                return;
            }
            if (message.type === 'overview') return navigate({kind: 'overview'});
            if (message.type === 'back') {
                const previous = history.pop();
                if (previous) navigate(previous, false);
                return;
            }
            if (message.type === 'path' && data.entries.some(entry => entry.path === message.id)) return navigate({kind: 'path', id: message.id});
            if (message.type === 'section' && data.sections.some(item => item.id === message.id)) return navigate({kind: 'section', id: message.id});
            if (message.type === 'clear') { ++epoch; return clear(); }
            if (message.type === 'lock-detail') { detailLocked = !detailLocked; return send(); }
            if (message.type === 'expand-active') {
                const owner = (bound?.groups || []).find(group => group.id && group.nodes.includes(activeNode));
                if (!owner) return;
                openGroups().add(owner.id);
                return send();
            }
            if (route.kind === 'overview' && ['overview-inspect', 'overview-hover', 'overview-reveal'].includes(message.type)) {
                const node = data.overview.nodes.find(item => item.id === message.id);
                if (!node) return;
                const sources = overviewSources(data, node);
                const index = message.source === undefined ? (sources.length === 1 ? 0 : undefined) : message.source;
                if (message.type !== 'overview-inspect' && (!Number.isInteger(index) || !sources[index])) return;
                ++epoch; clear(); actionEpoch = epoch; actionError = '';
                if (message.type === 'overview-inspect') { activeNode = node.id; send(); }
                if (Number.isInteger(index) && sources[index]) await revealSource(sources[index], message.type === 'overview-hover');
                if (!disposed && actionEpoch === epoch && message.type !== 'overview-hover') send();
                return;
            }
            if (message.type === 'path-reveal' && route.kind === 'path' && data.entries.some(item => item.path === route.id && item.kind === 'file')) {
                ++epoch; actionEpoch = epoch; actionError = '';
                await revealSource({file: route.id});
                if (!disposed && actionEpoch === epoch) send();
                return;
            }
            if (route.kind !== 'section') return;
            if (message.type === 'reveal-section') {
                ++epoch; actionEpoch = epoch; actionError = '';
                await revealSource(section());
                if (!disposed && actionEpoch === epoch) send();
                return;
            }
            if (['toggle-group', 'expand-all', 'collapse-all'].includes(message.type) && bound.layout === 'graph') {
                const groups = (bound.groups || []).filter(group => group.id);
                const group = groups.find(item => item.id === message.id);
                if (message.type === 'toggle-group' && !group) return;
                ++epoch; clear();
                if (message.type === 'expand-all') groups.forEach(item => openGroups().add(item.id));
                else if (message.type === 'collapse-all') openGroups().clear();
                else if (openGroups().has(group.id)) openGroups().delete(group.id);
                else openGroups().add(group.id);
                const owner = groups.find(item => !openGroups().has(item.id) && item.nodes.includes(activeNode));
                if (owner) activeNode = owner.id;
                send(); return;
            }
            const node = [...(bound?.nodes || []), ...(bound?.groups || []).filter(group => group.id)].find(item => item.id === message.id);
            if (!node) return;
            if (message.type === 'callee' && node.callee?.section) return navigate({kind: 'section', id: node.callee.section});
            if (!['inspect', 'reveal', 'hover', 'callee-code'].includes(message.type)) return;
            if (message.type === 'inspect') { ++epoch; clear(); activeNode = node.id; return send(); }
            ++epoch;
            if (message.type !== 'hover') activeNode = node.id;
            actionEpoch = epoch;
            actionError = '';
            await reveal(node, message.type === 'callee-code', message.type === 'hover');
            if (!disposed && actionEpoch === epoch && message.type !== 'hover') send();
        } catch (error) {
            if (!disposed && actionEpoch === epoch) {
                clear();
                if (!['hover', 'overview-hover'].includes(message.type)) { actionError = error.message; send(); }
            }
        }
    }));
    subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        const file = [...files.values()].find(file => file.uri?.toString() === event.document.uri.toString());
        if (!file) return;
        file.document = event.document;
        ++epoch; clear(); activeNode = null;
        rebind(); send();
    }));
    subscriptions.push(vscode.window.onDidChangeTextEditorSelection(event => follow(event.textEditor, event.selections)));
    subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => follow(editor)));
    const session = {panel, dispose() {
        if (disposed) return;
        disposed = true; ++epoch; ++reloadId;
        clear(); subscriptions.forEach(item => item.dispose()); decoration.dispose(); panel.dispose();
    }};
    subscriptions.push(panel.onDidDispose(() => session.dispose()));
    panel.webview.html = analysisHtml();
    return session;
}

module.exports = {createAnalysisSession, safeUri};
