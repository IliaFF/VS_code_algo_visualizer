'use strict';

const assert = require('node:assert/strict');
const {execFileSync, spawnSync} = require('node:child_process');
const {readFileSync, mkdtempSync, rmSync} = require('node:fs');
const {join} = require('node:path');
const {tmpdir} = require('node:os');
const {builtinModules} = require('node:module');

const root = join(__dirname, '..');
const directory = mkdtempSync(join(tmpdir(), 'algo-package-check-'));
const output = join(directory, 'installed extension.vsix');
const runtime = ['extension.cjs', 'diagrams.cjs', 'bindings.cjs', 'analysis.cjs', 'analysis-session.cjs', 'analysis-webview.js', 'webview.cjs', 'webview.js', 'webview.css'];
const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
try {
    // Build from another cwd; nothing is installed and the user's window is untouched.
    execFileSync(process.execPath, [join(root, 'package.mjs'), output], {cwd: directory});
    execFileSync('unzip', ['-t', output]);
    const names = execFileSync('unzip', ['-Z1', output], {encoding: 'utf8'}).trim().split('\n').filter(name => !name.endsWith('/'));
    assert.deepEqual(names.sort(), ['[Content_Types].xml', 'extension.vsixmanifest', ...['package.json', 'README.md', ...runtime].map(name => 'extension/' + name)].sort());
    const entry = name => execFileSync('unzip', ['-p', output, name]);
    assert.deepEqual(JSON.parse(entry('extension/package.json')), metadata);
    assert.equal(metadata.publisher + '.' + metadata.name, 'local-geometry.geometry-diagrams');
    assert.deepEqual(metadata.contributes.commands.map(item => item.command).sort(), ['analysis.openDocument', 'geometry.openDiagram']);
    assert.equal(metadata.main, './extension.cjs');
    assert.equal(metadata.engines.vscode, '^1.85.0');
    assert.deepEqual(metadata.extensionKind, ['workspace']);
    assert.equal(metadata.capabilities.untrustedWorkspaces.supported, false);
    assert.equal(metadata.dependencies, undefined);
    assert.equal(metadata.extensionDependencies, undefined);
    const readme = entry('extension/README.md').toString('utf8');
    assert.equal(readme, readFileSync(join(root, 'docs/INSTALL.md'), 'utf8'));
    for (const match of readme.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) assert.match(match[1], /^https:\/\//);
    for (const file of runtime) {
        const bytes = entry('extension/' + file);
        assert.deepEqual(bytes, readFileSync(join(root, file)), file);
        if (!file.endsWith('.css')) {
            execFileSync(process.execPath, ['--check', join(root, file)]);
            for (const match of bytes.toString('utf8').matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
                const module = match[1];
                if (module.startsWith('./')) assert.ok(runtime.includes(module.slice(2)), file + ': ' + module);
                else assert.ok(module === 'vscode' || builtinModules.includes(module) || builtinModules.includes(module.replace(/^node:/, '')), module);
            }
        }
    }
    const manifest = entry('extension.vsixmanifest').toString('utf8');
    assert.ok(manifest.includes(`Id="${metadata.name}" Version="${metadata.version}" Publisher="${metadata.publisher}"`));
    assert.ok(manifest.includes(`Value="${metadata.engines.vscode}"`));
    assert.match(manifest, /Microsoft\.VisualStudio\.Code\.Manifest" Path="extension\/package\.json"/);
    assert.match(manifest, /Microsoft\.VisualStudio\.Services\.Content\.Details" Path="extension\/README\.md"/);
    const before = readFileSync(output);
    const repeat = spawnSync(process.execPath, [join(root, 'package.mjs'), output], {cwd: directory});
    assert.notEqual(repeat.status, 0, 'Existing VSIX must not be overwritten');
    assert.match(repeat.stderr.toString('utf8'), /Файл уже существует/);
    assert.deepEqual(readFileSync(output), before);
    console.log(`PASS: VSIX ${metadata.version}; archive integrity, exact 13-file allowlist, bytes, metadata, README links, runtime imports/syntax, other cwd, no overwrite. No installation performed.`);
} finally {
    rmSync(directory, {recursive: true, force: true});
}
