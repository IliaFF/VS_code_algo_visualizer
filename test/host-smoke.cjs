'use strict';

// Run by the installed VS Code with --extensionTestsPath, not by node --test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const proofDir = '/tmp/algo-vscode-host-proof';

exports.run = async function () {
    fs.mkdirSync(proofDir, {recursive: true});
    const report = {started: new Date().toISOString(), vscode: vscode.version, steps: []};
    const save = () => fs.writeFileSync(path.join(proofDir, 'report.json'), JSON.stringify(report, null, 2));
    let watcher;
    let timeout;
    try {
        const expected = fs.realpathSync(path.join(__dirname, '..'));
        const extension = vscode.extensions.getExtension('local-geometry.geometry-diagrams');
        assert(extension, 'Geometry extension is missing from the real Extension Host');
        report.extensionPath = extension.extensionPath;
        save();
        assert.equal(fs.realpathSync(extension.extensionPath), expected, 'An installed/old copy was loaded instead of current sources');
        await extension.activate();
        assert(extension.isActive);
        assert((await vscode.commands.getCommands()).includes('geometry.openDiagram'));
        const uri = vscode.Uri.file(path.join(expected, 'examples/geometry/raytracing/geometry/src/geometry.cpp'));
        const document = await vscode.workspace.openTextDocument(uri);
        assert(!document.isDirty, 'Do not reuse a document with existing unsaved edits');
        const editor = await vscode.window.showTextDocument(document, {viewColumn: vscode.ViewColumn.One});
        const {resolveView} = require('../bindings.cjs');
        const initial = resolveView(document.getText(), require('../diagrams.cjs')[0]);
        editor.selection = new vscode.Selection(initial.steps[0].start - 1, 0, initial.steps[0].start - 1, 0);
        await vscode.commands.executeCommand('geometry.openDiagram');
        report.steps.push('Current extension activated in the real Development Host; command executed with real geometry document');
        report.document = document.uri.toString();
        report.phase = 'ready-for-ui-check';
        save();
        await new Promise((resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('UI smoke check timed out')), 300000);
            watcher = fs.watch(proofDir, (event, filename) => {
                if (filename !== 'action.json') return;
                let action;
                try { action = JSON.parse(fs.readFileSync(path.join(proofDir, 'action.json'), 'utf8')); } catch { return; }
                if (action.run !== report.started || action.id <= (report.lastAction || 0)) return;
                report.lastAction = action.id;
                if (action.type === 'select') {
                    const {resolveView} = require('../bindings.cjs');
                    const view = resolveView(document.getText(), require('../diagrams.cjs')[0]);
                    const line = view.steps[2].start - 1;
                    editor.selection = new vscode.Selection(line, 0, line, 0);
                    editor.revealRange(editor.selection);
                    report.steps.push('Real editor selection changed to sphere block 2');
                    save();
                } else if (action.type === 'finish') {
                    report.status = 'passed';
                    save();
                    resolve();
                } else {
                    reject(new Error('Unknown smoke action'));
                }
            });
        });
    } catch (error) {
        report.status = 'failed';
        report.error = error.stack;
        save();
        throw error;
    } finally {
        clearTimeout(timeout);
        watcher?.close();
    }
};
