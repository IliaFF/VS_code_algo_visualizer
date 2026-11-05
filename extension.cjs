'use strict';

const vscode = require('vscode');
const views = require('./diagrams.cjs');
const {resolveView} = require('./bindings.cjs');
const {webviewHtml} = require('./webview.cjs');
const {createAnalysisSession} = require('./analysis-session.cjs');

async function projectRoot() {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const marker = '/raytracing/geometry/';
    if (uri && uri.path.includes(marker)) {
        return uri.with({path: uri.path.slice(0, uri.path.lastIndexOf(marker))});
    }
    for (const folder of vscode.workspace.workspaceFolders || []) {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, 'raytracing/geometry/src/geometry.cpp'));
            return folder.uri;
        } catch {
            // Try the next workspace folder.
        }
    }
    throw new Error('Откройте папку с raytracing/geometry или файл этого примера');
}

function createSession(root, prototypeEnabled) {
    let column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;
    const active = vscode.window.activeTextEditor;
    let selected = views.findIndex(view => active?.document.uri.path.endsWith(`/src/${view.file}.cpp`));
    if (selected < 0) selected = 0;
    if (active) {
        for (const [i, view] of views.entries()) {
            if (!active.document.uri.path.endsWith(`/src/${view.file}.cpp`)) continue;
            try {
                const match = resolveView(active.document.getText(), view);
                if (active.selection.active.line >= match.start && active.selection.active.line <= match.end) selected = i;
            } catch {
                // The panel will explain an unavailable binding when selected.
            }
        }
    }
    const decoration = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        border: '1px solid',
        borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder')
    });
    const panel = vscode.window.createWebviewPanel('geometryDiagram', 'Geometry — схема',
        {viewColumn: vscode.ViewColumn.Beside, preserveFocus: true},
        {enableScripts: true, localResourceRoots: []});
    const subscriptions = [];
    const editedDocuments = new WeakSet();
    let document;
    let resolved;
    let highlighted;
    let activeStep = null;
    let request = 0;
    let disposed = false;

    function clear() {
        if (highlighted) highlighted.setDecorations(decoration, []);
        highlighted = undefined;
    }

    function send(error, fromEditor = false) {
        if (disposed) return;
        panel.webview.postMessage({
            type: 'state', selected, names: views.map(view => view.name),
            view: resolved || {...views[selected], steps: []},
            version: document?.version, activeStep, fromEditor,
            edited: Boolean(document?.isDirty || editedDocuments.has(document)),
            error: error || ''
        });
    }

    function update() {
        clear();
        resolved = undefined;
        activeStep = null;
        try {
            resolved = resolveView(document.getText(), views[selected]);
            const editor = vscode.window.activeTextEditor;
            const selections = editor?.selections || [editor?.selection];
            const selection = editor?.document === document && selections.length === 1 ? selections[0] : undefined;
            if (selection?.start && selection?.end) {
                const index = resolved.steps.findIndex(step =>
                    selection.start.line >= step.start - 1 && selection.end.line <= step.end - 1);
                if (index >= 0) activeStep = index;
            }
            send();
        } catch (error) {
            send('Подсветка отключена. ' + error.message);
        }
    }

    async function select(index) {
        const current = ++request;
        selected = index;
        document = resolved = undefined;
        activeStep = null;
        clear();
        const uri = vscode.Uri.joinPath(root, `raytracing/geometry/src/${views[index].file}.cpp`);
        try {
            const opened = await vscode.workspace.openTextDocument(uri);
            if (disposed || current !== request) return;
            document = opened;
            await vscode.window.showTextDocument(opened, {viewColumn: column, preserveFocus: true, preview: false});
            if (disposed || current !== request) return;
            update();
        } catch (error) {
            if (!disposed && current === request) send('Не удалось открыть файл. ' + error.message);
        }
    }

    subscriptions.push(panel.webview.onDidReceiveMessage(async message => {
        if (!message || typeof message !== 'object' || disposed) return;
        if (message.type === 'ready') return select(selected);
        if (message.type === 'select') {
            if (Number.isInteger(message.index) && message.index >= 0 && message.index < views.length) {
                return select(message.index);
            }
            return;
        }
        if (!resolved || message.selected !== selected || message.version !== document.version) return;
        if (message.type === 'clear') return clear();
        if (!['hover', 'reveal'].includes(message.type) || !Number.isInteger(message.index)) return;
        const step = resolved.steps[message.index];
        if (!step) return;
        const range = new vscode.Range(step.start - 1, 0, step.end - 1, document.lineAt(step.end - 1).text.length);
        const current = request;
        const targetDocument = document;
        let editor;
        if (message.type === 'reveal') {
            editor = await vscode.window.showTextDocument(targetDocument, {viewColumn: column, preserveFocus: true, preview: false});
            if (disposed || request !== current || message.version !== targetDocument.version) return;
        } else {
            editor = vscode.window.visibleTextEditors.find(candidate => candidate.document === document && candidate.viewColumn === column);
        }
        if (!editor) return;
        clear();
        editor.setDecorations(decoration, [range]);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        highlighted = editor;
    }));
    subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        editedDocuments.add(event.document);
        if (event.document === document) update();
    }));
    function followEditor(editor, selections = editor?.selections || [editor?.selection]) {
        if (!editor) return;
        const selection = selections.length === 1 ? selections[0] : undefined;
        const matches = [];
        if (selection?.start && selection?.end) {
            for (const [index, view] of views.entries()) {
                if (editor.document.uri.toString() !== vscode.Uri.joinPath(root, `raytracing/geometry/src/${view.file}.cpp`).toString()) continue;
                try {
                    const bound = resolveView(editor.document.getText(), view);
                    if (selection.start.line >= bound.start && selection.end.line <= bound.end) matches.push({index, bound});
                } catch {
                    // A missing or ambiguous binding must not select a guessed block.
                }
            }
        }
        clear();
        activeStep = null;
        if (matches.length === 1) {
            ++request;
            selected = matches[0].index;
            column = editor.viewColumn || column;
            document = editor.document;
            resolved = matches[0].bound;
            const index = resolved.steps.findIndex(step =>
                selection.start.line >= step.start - 1 && selection.end.line <= step.end - 1);
            if (index >= 0) activeStep = index;
        }
        if (resolved) send(undefined, true);
    }
    subscriptions.push(vscode.window.onDidChangeTextEditorSelection(event => followEditor(event.textEditor, event.selections)));
    subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => followEditor(editor)));
    const session = {dispose() {
        if (disposed) return;
        disposed = true;
        ++request;
        clear();
        subscriptions.forEach(item => item.dispose());
        decoration.dispose();
        panel.dispose();
    }};
    subscriptions.push(panel.onDidDispose(() => session.dispose()));
    panel.webview.html = webviewHtml(prototypeEnabled);
    return session;
}

function activate(context) {
    let session;
    let opening = 0;
    context.subscriptions.push(vscode.commands.registerCommand('analysis.openDocument', async () => {
        const request = ++opening;
        try {
            const folders = vscode.workspace.workspaceFolders || [];
            if (!folders.length) throw new Error('Сначала откройте папку целевого проекта');
            const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick();
            if (!folder || request !== opening) return;
            const picked = await vscode.window.showOpenDialog({canSelectMany: false, filters: {JSON: ['json']}, defaultUri: folder.uri, title: 'Открыть результат анализа агента'});
            if (!picked?.length || request !== opening) return;
            const next = await createAnalysisSession(vscode, folder.uri, picked[0]);
            if (request !== opening) { next.dispose(); return; }
            session?.dispose();
            session = next;
        } catch (error) {
            if (request === opening) vscode.window.showErrorMessage('Анализ агента: ' + error.message);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('geometry.openDiagram', async () => {
        const request = ++opening;
        try {
            const root = await projectRoot();
            if (request !== opening) return;
            session?.dispose();
            session = createSession(root, context.extensionMode !== vscode.ExtensionMode.Production);
        } catch (error) {
            vscode.window.showErrorMessage('Geometry: ' + error.message);
        }
    }));
    context.subscriptions.push({dispose() { ++opening; session?.dispose(); }});
}

module.exports = {activate};
