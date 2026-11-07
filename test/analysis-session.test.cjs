'use strict';

// Protocol and filesystem tests with a mocked editor, not live VS Code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {readFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const {createAnalysisSession, safeUri} = require('../analysis-session.cjs');
const {resolveSection} = require('../analysis.cjs');
const directory = path.join(__dirname, '../examples/analysis-contract');

async function harness(t) {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'analysis-session-'));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    for (const file of ['analysis.json', 'algorithm.cjs']) await fs.copyFile(path.join(directory, file), path.join(root, file));
    const documents = new Map(), changes = new Set(), selections = new Set(), active = new Set();
    const editors = [], states = [], calls = [];
    class Uri {
        constructor(file) { this.fsPath = file; this.scheme = 'file'; }
        toString() { return pathToFileURL(this.fsPath).toString(); }
        static file(file) { return new Uri(file); }
    }
    const subscription = (items, callback) => { items.add(callback); return {dispose: () => items.delete(callback)}; };
    const vscode = {
        Uri, ViewColumn: {One: 1, Beside: -2}, TextEditorRevealType: {InCenterIfOutsideViewport: 1},
        ThemeColor: class { constructor(id) { this.id = id; } },
        Range: class {
            constructor(a, b, c, d) { this.start = {line: a, character: b}; this.end = {line: c, character: d}; }
        },
        workspace: {
            fs: {readFile: uri => fs.readFile(uri.fsPath)},
            async openTextDocument(uri) {
                if (!documents.has(uri.fsPath)) {
                    const text = await fs.readFile(uri.fsPath, 'utf8');
                    documents.set(uri.fsPath, {uri, version: 1, text, getText() { return this.text; }});
                }
                return documents.get(uri.fsPath);
            },
            onDidChangeTextDocument: callback => subscription(changes, callback)
        },
        window: {
            visibleTextEditors: editors,
            onDidChangeTextEditorSelection: callback => subscription(selections, callback),
            onDidChangeActiveTextEditor: callback => subscription(active, callback),
            createTextEditorDecorationType() { return {dispose() {}}; },
            async showTextDocument(document, options) {
                calls.push(options);
                let editor = editors.find(item => item.document === document);
                if (!editor) {
                    editor = {document, viewColumn: 1, decorations: [], reveals: [],
                        setDecorations(_, ranges) { this.decorations = ranges; }, revealRange(range) { this.reveals.push(range); }};
                    editors.push(editor);
                }
                return editor;
            },
            createWebviewPanel() {
                const panel = {webview: {postMessage: message => states.push(message), onDidReceiveMessage(callback) { panel.receive = callback; return {dispose() {}}; }},
                    onDidDispose(callback) { this.onDispose = callback; return {dispose() {}}; },
                    dispose() { if (!this.disposed) { this.disposed = true; this.onDispose?.(); } }};
                return panel;
            }
        }
    };
    const session = await createAnalysisSession(vscode, Uri.file(root), Uri.file(path.join(root, 'analysis.json')));
    t.after(() => session.dispose());
    const state = () => states.at(-1);
    const send = (type, id, source) => session.panel.receive({type, id, source, revision: state()?.revision});
    await send('ready');
    const doc = documents.get(path.join(root, 'algorithm.cjs'));
    return {root, vscode, session, states, state, send, doc, editors, calls, changes, selections, active,
        edit(text) { doc.text = text; doc.version++; for (const callback of changes) callback({document: doc}); },
        move(editor, selection, multiple = false) {
            editor.selection = selection;
            editor.selections = multiple ? [selection, selection] : [selection];
            for (const callback of selections) callback({textEditor: editor, selections: editor.selections});
        }
    };
}

test('JSON-сессия: обзор → раздел → код, свойства, неверные и устаревшие сообщения, закрытие', async t => {
    const h = await harness(t);
    assert.equal(h.state().route.kind, 'overview');
    assert.equal(h.state().freshness['algorithm.cjs'], 'same');
    assert.match(h.session.panel.webview.html, /default-src 'none'/);
    assert.ok(!h.session.panel.webview.html.includes('data-mode="calls"'));
    await h.send('path', 'algorithm.cjs');
    assert.equal(h.state().route.kind, 'path');
    await h.send('section', 'sum-positive');
    assert.equal(h.state().bound.nodes.length, 14);
    await h.send('inspect', 'read');
    assert.equal(h.state().activeNode, 'read');
    await h.send('reveal', 'read');
    assert.equal(h.editors[0].decorations.length, 1);
    assert.equal(h.calls[0].preserveFocus, true);
    const pendingHover = h.send('hover', 'read');
    await h.send('clear');
    await pendingHover;
    assert.equal(h.editors[0].decorations.length, 0, 'mouseleave cancels an in-flight hover');
    const old = h.state();
    const count = h.states.length;
    for (const id of [null, {}, '../../secret', 'missing', 0]) await h.send('section', id);
    assert.equal(h.states.length, count);
    h.edit('// inserted\n' + h.doc.text);
    assert.equal(h.state().freshness['algorithm.cjs'], 'changed');
    assert.equal(h.editors[0].decorations.length, 0);
    await h.session.panel.receive({type: 'reveal', id: 'read', revision: old.revision});
    assert.equal(h.editors[0].decorations.length, 0);
    await h.send('reveal', 'read');
    assert.equal(h.editors[0].decorations[0].start.line, old.bound.nodes.find(node => node.id === 'read').binding.start.line + 1);
    h.session.dispose();
    assert.equal(h.changes.size + h.selections.size + h.active.size, 0);
    assert.equal(h.editors[0].decorations.length, 0);
});

test('JSON-сессия: курсор, несколько выделений, локальная неоднозначность и возврат из функции', async t => {
    const h = await harness(t);
    await h.send('section', 'sum-positive');
    await h.send('reveal', 'read');
    const editor = h.editors[0];
    const read = h.state().bound.nodes.find(node => node.id === 'read');
    h.move(editor, read.binding);
    assert.equal(h.state().activeNode, 'read');
    assert.equal(h.calls.length, 1);
    h.move(editor, read.binding, true);
    assert.equal(h.state().activeNode, null);
    await h.send('callee', 'nonpositive');
    assert.equal(h.state().route.id, 'is-positive');
    await h.send('back');
    assert.equal(h.state().route.id, 'sum-positive');
    await h.send('callee-code', 'nonpositive');
    assert.equal(h.editors[0].decorations.length, 1);
    const helper = resolveSection(h.doc.text, h.state().data.sections[1]);
    h.move(editor, helper.nodes[0].binding);
    assert.equal(h.state().route.id, 'is-positive');
    assert.equal(h.state().activeNode, 'compare');
    await h.send('section', 'sum-positive');
    h.edit(h.doc.text.replace('const value = values[index];', 'const value = values[index];\n        // const value = values[index];'));
    assert.ok(h.state().bound.nodes.find(node => node.id === 'read').bindingError);
    assert.ok(h.state().bound.nodes.find(node => node.id === 'add').binding);
    await h.send('reveal', 'read');
    assert.match(h.state().actionError, /однозначный/);
});

test('JSON-сессия: плохая перезагрузка сохраняет обзор, корректная принимает новую версию', async t => {
    const h = await harness(t);
    await h.send('section', 'sum-positive');
    const original = h.state().data;
    await fs.writeFile(path.join(h.root, 'analysis.json'), '{broken');
    await h.send('reload');
    assert.equal(h.state().data, original);
    assert.match(h.state().loadError, /Новая версия не загружена/);
    const next = structuredClone(original);
    next.title = 'Обновлённый анализ';
    await fs.writeFile(path.join(h.root, 'analysis.json'), JSON.stringify(next));
    await h.send('reload');
    assert.equal(h.state().data.title, next.title);
    assert.equal(h.state().route.id, 'sum-positive');
    assert.equal(h.state().loadError, '');
});

test('JSON-сессия: отложенный reveal не подсвечивает старый участок после смены раздела', async t => {
    const h = await harness(t);
    await h.send('section', 'sum-positive');
    let release;
    const wait = new Promise(resolve => { release = resolve; });
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    const show = h.vscode.window.showTextDocument;
    h.vscode.window.showTextDocument = async (...args) => { started(); await wait; return show(...args); };
    const pending = h.send('reveal', 'read');
    await entered;
    await h.send('section', 'is-positive');
    release(); await pending;
    assert.equal(h.state().route.id, 'is-positive');
    assert.equal(h.editors[0]?.decorations.length || 0, 0);
});

test('Файловая граница: ссылки наружу запрещены, отсутствующий файл не уничтожает объяснение', async t => {
    const h = await harness(t);
    const outside = await fs.mkdtemp(path.join(tmpdir(), 'analysis-outside-'));
    t.after(() => fs.rm(outside, {recursive: true, force: true}));
    await fs.writeFile(path.join(outside, 'secret'), 'not project data');
    await fs.symlink(path.join(outside, 'secret'), path.join(h.root, 'escape.cjs'));
    await assert.rejects(safeUri(h.vscode, h.vscode.Uri.file(h.root), 'escape.cjs'), /за корень/);
    await fs.symlink(path.join(h.root, 'algorithm.cjs'), path.join(h.root, 'internal.cjs'));
    const internal = await safeUri(h.vscode, h.vscode.Uri.file(h.root), 'internal.cjs');
    assert.equal(internal.fsPath, path.join(h.root, 'algorithm.cjs'));
    await assert.rejects(safeUri(h.vscode, h.vscode.Uri.file(h.root), path.join(outside, 'secret')), /за корень/);
    const next = structuredClone(h.state().data);
    next.entries[0].path = 'missing.cjs';
    for (const section of next.sections) {
        section.file = 'missing.cjs';
        for (const node of section.nodes) if (node.callee) node.callee.file = 'missing.cjs';
    }
    await fs.writeFile(path.join(h.root, 'analysis.json'), JSON.stringify(next));
    await h.send('reload');
    await h.send('section', 'sum-positive');
    assert.equal(h.state().freshness['missing.cjs'], 'unavailable');
    assert.ok(h.state().bound.bindingError);
    assert.equal(h.state().bound.nodes.length, 14);
});

test('JSON-сессия: запоздалая перезагрузка не заменяет более новую', async t => {
    const h = await harness(t);
    const read = h.vscode.workspace.fs.readFile;
    let release, started;
    const waiting = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { started = resolve; });
    let first = true;
    h.vscode.workspace.fs.readFile = async uri => {
        const bytes = await read(uri);
        if (uri.fsPath.endsWith('analysis.json') && first) {
            first = false; started(); await waiting;
        }
        return bytes;
    };
    const old = h.send('reload');
    await entered;
    const next = structuredClone(h.state().data);
    next.title = 'Самая новая версия';
    await fs.writeFile(path.join(h.root, 'analysis.json'), JSON.stringify(next));
    await h.send('reload');
    release(); await old;
    assert.equal(h.state().data.title, next.title);
});

test('Команда расширения открывает настоящий JSON через новый загрузчик и выбранный корень', async t => {
    const h = await harness(t);
    const commands = {}, errors = [];
    h.vscode.commands = {registerCommand(name, callback) { commands[name] = callback; return {dispose() {}}; }};
    h.vscode.workspace.workspaceFolders = [{uri: h.vscode.Uri.file(h.root)}];
    h.vscode.window.showOpenDialog = async () => [h.vscode.Uri.file(path.join(h.root, 'analysis.json'))];
    h.vscode.window.showErrorMessage = message => errors.push(message);
    const create = h.vscode.window.createWebviewPanel;
    let panel;
    h.vscode.window.createWebviewPanel = (...args) => { panel = create(...args); return panel; };
    const extension = path.join(__dirname, '../extension.cjs');
    const localRequire = createRequire(extension);
    const module = {exports: {}};
    vm.runInNewContext(readFileSync(extension, 'utf8'), {require: name => name === 'vscode' ? h.vscode : localRequire(name), module});
    const context = {subscriptions: []};
    module.exports.activate(context);
    t.after(() => context.subscriptions.forEach(item => item.dispose()));
    await commands['analysis.openDocument']();
    assert.deepEqual(errors, []);
    await panel.receive({type: 'ready'});
    assert.equal(h.state().data.title, 'Накопление положительных значений до порога');
    assert.equal(h.state().freshness['algorithm.cjs'], 'same');
});

test('JSON-сессия: несохранённый открытый буфер важнее диска, повреждённый UTF-8 без буфера недоступен', async t => {
    const h = await harness(t);
    h.edit('// unsaved\n' + h.doc.text);
    h.vscode.workspace.textDocuments = [h.doc];
    await fs.writeFile(path.join(h.root, 'algorithm.cjs'), Buffer.from([0xff]));
    await h.send('reload');
    await h.send('section', 'sum-positive');
    assert.equal(h.state().freshness['algorithm.cjs'], 'changed');
    assert.ok(h.state().bound.nodes[0].binding);
    h.vscode.workspace.textDocuments = [];
    await h.send('reload');
    assert.equal(h.state().freshness['algorithm.cjs'], 'unavailable');
    assert.ok(h.state().bound.bindingError);
});

test('Крупный узел и заголовок раздела показывают весь связанный код, не только малый узел', async t => {
    const h = await harness(t);
    await h.send('overview-hover', 'accumulation');
    assert.equal(h.calls.length, 0, 'hover does not open an editor');
    await h.send('overview-inspect', 'accumulation');
    assert.equal(h.state().activeNode, 'accumulation');
    const expected = resolveSection(h.doc.getText(), h.state().data.sections[0]).binding;
    assert.deepEqual({...h.editors[0].decorations[0]}, expected);
    assert.equal(h.calls.at(-1).preserveFocus, true);
    await h.send('section', 'sum-positive');
    await h.send('reveal-section');
    assert.deepEqual({...h.editors[0].decorations[0]}, expected);
    await h.send('path', 'algorithm.cjs');
    await h.send('path-reveal');
    assert.deepEqual({...h.editors[0].decorations[0]}, resolveSection(h.doc.getText(), {nodes: []}).binding);
    await h.send('overview');
    const pending = h.send('overview-hover', 'accumulation');
    await h.send('clear'); await pending;
    assert.equal(h.editors[0].decorations.length, 0, 'leaving a coarse node cancels pending hover');
});

test('Блоки раскрываются, сворачиваются и выбираются по крупному/малому диапазону без перехвата фокуса', async t => {
    const h = await harness(t);
    await h.send('section', 'sum-positive');
    assert.equal(h.state().graph.nodes.length, 4);
    await h.send('inspect', 'iteration');
    await h.send('reveal', 'iteration');
    const group = h.state().bound.groups.find(item => item.id === 'iteration');
    assert.deepEqual({...h.editors[0].decorations[0]}, group.binding);
    await h.send('toggle-group', 'iteration');
    assert.ok(h.state().graph.nodes.some(node => node.id === 'read'));
    const calls = h.calls.length;
    const read = h.state().bound.nodes.find(node => node.id === 'read');
    h.move(h.editors[0], read.binding);
    assert.equal(h.state().activeNode, 'read');
    assert.equal(h.calls.length, calls);
    await h.send('collapse-all');
    assert.equal(h.state().activeNode, 'iteration');
    assert.equal(h.state().graph.nodes.length, 4);
    h.move(h.editors[0], read.binding);
    assert.ok(h.state().expanded.includes('iteration'), 'code selection reveals the hidden child');
    assert.equal(h.state().activeNode, 'read');
    h.move(h.editors[0], group.binding);
    assert.equal(h.state().activeNode, 'iteration');
    await h.send('expand-all');
    assert.equal(h.state().graph.nodes.length, 14);
    assert.equal(h.state().graph.edges.length, 16);
    await h.send('back');
    await h.send('section', 'sum-positive');
    assert.equal(h.state().graph.nodes.length, 14, 'expansion survives navigation');
    await h.send('reload');
    assert.equal(h.state().graph.nodes.length, 4, 'new JSON resets expansion safely');
    const previous = h.state();
    await h.send('toggle-group', 'missing');
    assert.equal(h.state(), previous);
});

test('Фиксация детализации не раскрывает блоки при движении по коду', async t => {
    const h = await harness(t);
    await h.send('section', 'sum-positive');
    await h.send('inspect', 'iteration');
    await h.send('reveal', 'iteration');
    await h.send('collapse-all');
    await h.send('lock-detail');
    assert.equal(h.state().detailLocked, true);
    const read = h.state().bound.nodes.find(node => node.id === 'read');
    h.move(h.editors[0], read.binding);
    assert.equal(h.state().activeNode, 'read', 'the node is still highlighted');
    assert.equal(h.state().graph.nodes.length, 4, 'locked detail keeps the block collapsed');
    assert.ok(!h.state().expanded.includes('iteration'));
    await h.send('toggle-group', 'iteration');
    assert.ok(h.state().expanded.includes('iteration'), 'explicit expand still works while locked');
    await h.send('overview');
    assert.equal(h.state().detailLocked, true, 'the lock survives navigation');
    await h.send('section', 'sum-positive');
    await h.send('expand-all');
    assert.equal(h.state().expanded.length, h.state().bound.groups.length, 'expand-all still opens every block while locked');
    await h.send('collapse-all');
    await h.send('lock-detail');
    assert.equal(h.state().detailLocked, false);
    h.move(h.editors[0], read.binding);
    assert.ok(h.state().expanded.includes('iteration'), 'unlocked selection expands the block again');
});

test('Узел нескольких файлов предлагает выбор и не подсвечивает произвольный первый файл', async t => {
    const h = await harness(t);
    const data = structuredClone(h.state().data);
    await fs.writeFile(path.join(h.root, 'other.cjs'), 'const other = 1;\n');
    data.entries.push({path: '.', kind: 'directory', summary: 'Выборочный обзор'}, {path: 'other.cjs', kind: 'file', summary: 'Другой файл', sha256: '0'.repeat(64)});
    data.overview.nodes.push({id: 'project', title: 'Проект', summary: 'Несколько файлов', row: 2, column: 0, target: {path: '.'}});
    await fs.writeFile(path.join(h.root, 'analysis.json'), JSON.stringify(data));
    await h.send('reload');
    await h.send('overview-inspect', 'project');
    assert.equal(h.state().overviewCode.project.length, 2);
    assert.equal(h.calls.length, 0);
    await h.send('overview-hover', 'project');
    assert.equal(h.calls.length, 0);
    await h.send('overview-reveal', 'project', 1);
    assert.equal(path.basename(h.editors[0].document.uri.fsPath), 'other.cjs');
    const count = h.calls.length;
    const highlighted = h.editors[0].decorations;
    await h.send('overview-reveal', 'project', '../secret');
    await h.send('overview-reveal', 'project', 99);
    await h.send('overview-reveal', 'project', null);
    assert.equal(h.calls.length, count, 'only server-resolved source indices are actionable');
    assert.deepEqual(h.editors[0].decorations, highlighted, 'invalid indices do not clear an existing highlight');
    await fs.rm(path.join(h.root, 'other.cjs'));
    await h.send('overview-reveal', 'project', 1);
    assert.ok(h.state().actionError, 'source becoming unavailable is reported');
    await h.send('overview-reveal', 'project', 0);
    assert.equal(h.state().actionError, '', 'a successful source choice clears the earlier action error');
});
