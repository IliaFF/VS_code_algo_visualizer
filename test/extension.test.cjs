'use strict';

// This tests the protocol with a mocked VS Code API, not a live editor.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {createRequire} = require('node:module');

const directory = join(__dirname, '..');
const localRequire = createRequire(join(directory, 'extension.cjs'));

function harness(extensionMode = 2) {
    const listeners = new Set();
    const selectionListeners = new Set();
    const activeListeners = new Set();
    const editors = [];
    const documents = new Map();
    const messages = [];
    const errors = [];
    const commands = {};
    const panels = [];
    class Uri {
        constructor(path) { this.path = path; }
        toString() { return 'file://' + this.path; }
        with({path}) { return new Uri(path); }
        static joinPath(root, path) { return new Uri(root.path + '/' + path); }
    }
    function document(file) {
        const path = '/repo/raytracing/geometry/src/' + file;
        if (!documents.has(path)) {
            documents.set(path, {uri: new Uri(path), version: 1,
                text: readFileSync(join(directory, 'examples/geometry/raytracing/geometry/src', file), 'utf8'),
                getText() { return this.text; },
                lineAt(index) { return {text: this.text.split('\n')[index]}; }
            });
        }
        return documents.get(path);
    }
    const vscode = {
        Uri, ExtensionMode: {Production: 1, Development: 2, Test: 3}, ViewColumn: {One: 1, Beside: -2}, TextEditorRevealType: {InCenterIfOutsideViewport: 2},
        ThemeColor: class { constructor(id) { this.id = id; } },
        Range: class {
            constructor(startLine, startCharacter, endLine, endCharacter) {
                this.start = {line: startLine, character: startCharacter};
                this.end = {line: endLine, character: endCharacter};
            }
        },
        commands: {registerCommand(name, callback) { commands[name] = callback; return {dispose() {}}; }},
        workspace: {
            workspaceFolders: [{uri: new Uri('/repo')}], fs: {async stat() {}},
            async openTextDocument(uri) { return document(uri.path.split('/').at(-1)); },
            onDidChangeTextDocument(callback) { listeners.add(callback); return {dispose: () => listeners.delete(callback)}; }
        },
        window: {
            visibleTextEditors: editors,
            onDidChangeTextEditorSelection(callback) { selectionListeners.add(callback); return {dispose: () => selectionListeners.delete(callback)}; },
            onDidChangeActiveTextEditor(callback) { activeListeners.add(callback); return {dispose: () => activeListeners.delete(callback)}; },
            async showTextDocument(doc, options) {
                let editor = editors.find(editor => editor.document === doc);
                if (!editor) {
                    editor = {document: doc, viewColumn: options.viewColumn, selection: {active: {line: 0}},
                        decorations: [], reveals: [],
                        setDecorations(type, ranges) { this.decorations = ranges; },
                        revealRange(range) { this.reveals.push(range); }
                    };
                    editors.push(editor);
                }
                return editor;
            },
            createTextEditorDecorationType() { return {dispose() {}}; },
            createWebviewPanel(type, title, position, options) {
                const panel = {options, position, disposed: false,
                    webview: {html: '', postMessage: message => messages.push(message),
                        onDidReceiveMessage(callback) { panel.receive = callback; return {dispose() {}}; }},
                    onDidDispose(callback) { panel.onDispose = callback; return {dispose() {}}; },
                    dispose() { if (!this.disposed) { this.disposed = true; this.onDispose?.(); } }
                };
                panels.push(panel);
                return panel;
            },
            showErrorMessage(message) { errors.push(message); }
        }
    };
    const module = {exports: {}};
    vm.runInNewContext(readFileSync(join(directory, 'extension.cjs'), 'utf8'), {
        require: name => name === 'vscode' ? vscode : localRequire(name), module
    }, {filename: 'extension.cjs'});
    const context = {subscriptions: [], extensionMode};
    module.exports.activate(context);
    return {vscode, document, editors, messages, panels, errors, commands, listeners, selectionListeners, activeListeners, context,
        move(editor, start, end = start) {
            const selection = {start: {line: start}, end: {line: end}, active: {line: end}};
            editor.selection = selection;
            for (const callback of selectionListeners) callback({textEditor: editor, selections: [selection], kind: 1});
        },
        async open() {
            await commands['geometry.openDiagram']();
            const panel = panels.at(-1);
            await panel.receive({type: 'ready'});
            return panel;
        },
        edit(doc, text) {
            doc.text = text; doc.version++;
            for (const callback of listeners) callback({document: doc});
        }
    };
}

const client = (state, type, index = 0) => ({type, index, selected: state.selected, version: state.version});

test('Открытие, hover, reveal, смена файла и закрытие панели', async () => {
    const h = harness();
    const panel = await h.open();
    let state = h.messages.at(-1);
    assert.equal(state.error, '');
    assert.equal(state.names.length, 11);
    assert.equal(panel.position.viewColumn, -2);
    assert.equal(panel.options.enableScripts, true);
    assert.equal(panel.options.localResourceRoots.length, 0);
    assert.ok(panel.webview.html.includes("default-src 'none'"));
    await panel.receive(client(state, 'hover', 1));
    const editor = h.editors[0];
    assert.equal(editor.decorations[0].start.line, state.view.steps[1].start - 1);
    await panel.receive(client(state, 'clear'));
    assert.equal(editor.decorations.length, 0);
    await panel.receive(client(state, 'reveal', 2));
    assert.equal(editor.reveals.at(-1).start.line, state.view.steps[2].start - 1);
    await panel.receive({type: 'select', index: 5});
    state = h.messages.at(-1);
    assert.equal(state.view.file, 'vector');
    assert.equal(editor.decorations.length, 0);
    await panel.receive(client(state, 'hover'));
    assert.equal(h.editors[1].decorations.length, 1);
    panel.dispose();
    assert.equal(h.listeners.size, 0);
    assert.equal(h.editors[1].decorations.length, 0);
    assert.deepEqual(h.errors, []);
});

test('Несохранённые изменения обновляют диапазоны и отвергают старые сообщения', async () => {
    const h = harness();
    const panel = await h.open();
    const old = h.messages.at(-1);
    await panel.receive(client(old, 'hover'));
    const doc = h.editors[0].document;
    h.edit(doc, '// inserted\n' + doc.text);
    const updated = h.messages.at(-1);
    assert.equal(updated.view.steps[0].start, old.view.steps[0].start + 1);
    assert.equal(h.editors[0].decorations.length, 0);
    await panel.receive(client(old, 'hover'));
    assert.equal(h.editors[0].decorations.length, 0);
    await panel.receive(client(updated, 'hover'));
    assert.equal(h.editors[0].decorations.length, 1);
    h.edit(doc, doc.text.replace('    const Vector offset', '    const Vector renamed'));
    const broken = h.messages.at(-1);
    assert.match(broken.error, /Подсветка отключена/);
    assert.equal(broken.view.steps.length, 0);
    assert.equal(h.editors[0].decorations.length, 0);
    await panel.receive(client(updated, 'reveal'));
    assert.equal(h.editors[0].decorations.length, 0);
});

test('Неверные сообщения не управляют файлами или диапазонами', async () => {
    const h = harness();
    const panel = await h.open();
    const state = h.messages.at(-1);
    for (const index of [-1, 1000, '0', 0.5, null]) {
        await panel.receive({type: 'select', index});
        await panel.receive(client(state, 'hover', index));
    }
    await panel.receive(null);
    await panel.receive({...client(state, 'hover'), selected: 9});
    await panel.receive({...client(state, 'hover'), version: -1});
    assert.equal(h.messages.length, 1);
    assert.equal(h.editors.length, 1);
    assert.equal(h.editors[0].decorations.length, 0);
});

test('Отложенное открытие старого раздела не заменяет новый', async () => {
    const h = harness();
    const panel = await h.open();
    const open = h.vscode.workspace.openTextDocument;
    let release;
    const waiting = new Promise(resolve => { release = resolve; });
    h.vscode.workspace.openTextDocument = async uri => {
        if (uri.path.endsWith('/vector.cpp')) await waiting;
        return open(uri);
    };
    const pending = panel.receive({type: 'select', index: 5});
    await panel.receive({type: 'select', index: 6});
    release();
    await pending;
    assert.equal(h.messages.at(-1).view.file, 'matrix');
    assert.equal(h.editors.some(editor => editor.document.uri.path.endsWith('/vector.cpp')), false);
    panel.dispose();
    assert.equal(h.listeners.size, 0);
});

test('Активный Vector выбирается автоматически, повторная команда закрывает старую панель', async () => {
    const h = harness();
    h.vscode.window.activeTextEditor = await h.vscode.window.showTextDocument(h.document('vector.cpp'), {viewColumn: 1});
    const first = await h.open();
    assert.equal(h.messages.at(-1).view.file, 'vector');
    await h.open();
    assert.equal(first.disposed, true);
    assert.equal(h.listeners.size, 1);
    h.context.subscriptions.forEach(item => item.dispose());
    assert.equal(h.listeners.size, 0);
});

test('Курсор и выделение выбирают блок без открытия документа и без перехвата фокуса', async () => {
    const h = harness();
    const panel = await h.open();
    const state = h.messages.at(-1);
    const editor = h.editors[0];
    const reveals = editor.reveals.length;
    h.move(editor, state.view.steps[2].start - 1);
    assert.equal(h.messages.at(-1).activeStep, 2);
    assert.equal(h.messages.at(-1).selected, 0);
    assert.equal(h.editors.length, 1);
    assert.equal(editor.reveals.length, reveals);
    h.move(editor, state.view.steps[1].start - 1, state.view.steps[2].start - 1);
    assert.equal(h.messages.at(-1).activeStep, null);
    h.move(editor, 0);
    assert.equal(h.messages.at(-1).activeStep, null);
    panel.dispose();
    assert.equal(h.selectionListeners.size, 0);
    assert.equal(h.activeListeners.size, 0);
});

test('Переход курсора в другую функцию или файл меняет раздел без showTextDocument', async () => {
    const h = harness();
    const panel = await h.open();
    const {resolveView} = require('../bindings.cjs');
    const views = require('../diagrams.cjs');
    const triangle = resolveView(h.document('geometry.cpp').text, views[1]);
    const matrix = resolveView(h.document('matrix.cpp').text, views[6]);
    let opens = 0;
    const show = h.vscode.window.showTextDocument;
    h.vscode.window.showTextDocument = async (...args) => { opens++; return show(...args); };
    h.move(h.editors[0], triangle.steps[1].start - 1);
    assert.equal(h.messages.at(-1).selected, 1);
    assert.equal(h.messages.at(-1).activeStep, 1);
    const editor = await show(h.document('matrix.cpp'), {viewColumn: 3});
    h.move(editor, matrix.steps[2].start - 1);
    assert.equal(h.messages.at(-1).view.file, 'matrix');
    assert.equal(h.messages.at(-1).activeStep, 2);
    assert.equal(opens, 0);
    await panel.receive(client(h.messages.at(-1), 'hover', 2));
    assert.equal(editor.decorations[0].start.line, matrix.steps[2].start - 1);
    panel.dispose();
});

test('Geometry сохраняет свойства и демостатусы, но больше не показывает отдельные этапы и вызовы', async () => {
    const h = harness();
    const panel = await h.open();
    for (let index = 0; index < 11; index++) {
        if (index) await panel.receive({type: 'select', index});
        const state = h.messages.at(-1);
        assert.ok(state.view.steps.length > 0);
        assert.equal(state.prototype, undefined);
        assert.ok(!panel.webview.html.includes('data-mode="calls"'));
        assert.ok(!panel.webview.html.includes('data-mode="stages"'));
        assert.ok(panel.webview.html.includes('demo-status'));
    }
    await panel.receive({type: 'select', index: 0});
    assert.equal(h.messages.at(-1).edited, false);
    h.edit(h.document('geometry.cpp'), '// inserted\n' + h.document('geometry.cpp').text);
    assert.equal(h.messages.at(-1).edited, true);
    await panel.receive({type: 'select', index: 5});
    assert.equal(h.messages.at(-1).edited, false);
    await panel.receive({type: 'select', index: 0});
    assert.equal(h.messages.at(-1).edited, true);
    panel.dispose();
});

test('Несколько выделений, чужой workspace и неоднозначный якорь не выбирают блок', async () => {
    const h = harness();
    const panel = await h.open();
    const state = h.messages.at(-1);
    const editor = h.editors[0];
    h.move(editor, state.view.steps[0].start - 1);
    for (const callback of h.selectionListeners) callback({textEditor: editor, selections: [editor.selection, editor.selection]});
    assert.equal(h.messages.at(-1).activeStep, null);
    const foreign = {...editor, document: {...editor.document, uri: new h.vscode.Uri('/other/raytracing/geometry/src/geometry.cpp')}};
    h.move(foreign, state.view.steps[1].start - 1);
    assert.equal(h.messages.at(-1).activeStep, null);
    assert.equal(h.messages.at(-1).selected, 0);
    const anchor = '    const Vector offset';
    h.edit(editor.document, editor.document.text.replace(anchor, anchor + '\n' + anchor));
    h.move(editor, state.view.steps[0].start - 1);
    assert.match(h.messages.at(-1).error, /Подсветка отключена/);
    assert.equal(h.messages.at(-1).activeStep, null);
    assert.equal(editor.decorations.length, 0);
    panel.dispose();
});

test('Выбор в коде отменяет отложенное открытие раздела из панели', async () => {
    const h = harness();
    const panel = await h.open();
    const step = h.messages.at(-1).view.steps[1];
    const open = h.vscode.workspace.openTextDocument;
    let release;
    const waiting = new Promise(resolve => { release = resolve; });
    h.vscode.workspace.openTextDocument = async uri => {
        if (uri.path.endsWith('/vector.cpp')) await waiting;
        return open(uri);
    };
    const pending = panel.receive({type: 'select', index: 5});
    h.move(h.editors[0], step.start - 1);
    const state = h.messages.at(-1);
    assert.equal(state.selected, 0);
    assert.equal(state.activeStep, 1);
    release();
    await pending;
    assert.equal(h.messages.at(-1), state);
    assert.equal(h.editors.length, 1);
    panel.dispose();
});

test('При открытии панели выбран блок под существующим курсором', async () => {
    const h = harness();
    const {resolveView} = require('../bindings.cjs');
    const step = resolveView(h.document('geometry.cpp').text, require('../diagrams.cjs')[0]).steps[2];
    const editor = await h.vscode.window.showTextDocument(h.document('geometry.cpp'), {viewColumn: 1});
    const line = step.start - 1;
    editor.selection = {start: {line}, end: {line}, active: {line}};
    h.vscode.window.activeTextEditor = editor;
    const panel = await h.open();
    assert.equal(h.messages.at(-1).activeStep, 2);
    panel.dispose();
});

test('Переключатель прототипа доступен через F5, но скрыт в установленной версии', async () => {
    const production = harness(1);
    const panel = await production.open();
    assert.ok(panel.webview.html.includes('class="prototype-toggle" hidden'));
    const development = harness();
    const preview = await development.open();
    assert.ok(preview.webview.html.includes('class="prototype-toggle">'));
    const testing = harness(3);
    const testPanel = await testing.open();
    assert.ok(testPanel.webview.html.includes('class="prototype-toggle">'));
    panel.dispose();
    preview.dispose();
    testPanel.dispose();
});

test('Команда JSON зарегистрирована, отмена выбора и отсутствие workspace сохраняют текущую панель', async () => {
    const h = harness();
    const panel = await h.open();
    const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    assert.ok(metadata.contributes.commands.some(item => item.command === 'analysis.openDocument'));
    h.vscode.window.showOpenDialog = async () => undefined;
    await h.commands['analysis.openDocument']();
    assert.equal(panel.disposed, false);
    h.vscode.workspace.workspaceFolders = [];
    await h.commands['analysis.openDocument']();
    assert.match(h.errors.at(-1), /папку целевого проекта/);
    assert.equal(panel.disposed, false);
    h.vscode.workspace.workspaceFolders = [{}, {}];
    h.vscode.window.showWorkspaceFolderPick = async () => undefined;
    await h.commands['analysis.openDocument']();
    assert.equal(panel.disposed, false);
    panel.dispose();
});

test('Смена активного редактора учитывает несколько курсоров и не вызывает навигацию', async () => {
    const h = harness();
    const panel = await h.open();
    const editor = await h.vscode.window.showTextDocument(h.document('vector.cpp'), {viewColumn: 3});
    const {resolveView} = require('../bindings.cjs');
    const line = resolveView(editor.document.text, require('../diagrams.cjs')[5]).steps[2].start - 1;
    editor.selection = {start: {line}, end: {line}, active: {line}};
    editor.selections = [editor.selection];
    for (const callback of h.activeListeners) callback(editor);
    assert.equal(h.messages.at(-1).selected, 5);
    assert.equal(h.messages.at(-1).activeStep, 2);
    editor.selections = [editor.selection, editor.selection, editor.selection];
    for (const callback of h.activeListeners) callback(editor);
    assert.equal(h.messages.at(-1).activeStep, null);
    assert.equal(editor.reveals.length, 0);
    panel.dispose();
});
