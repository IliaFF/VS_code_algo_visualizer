'use strict';

// Optional browser regression: node test/browser-viewport.cjs (requires google-chrome).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {analysisHtml} = require('../webview.cjs');
const {parseAnalysis, resolveSection, projectGraph} = require('../analysis.cjs');
const root = path.join(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'algo-viewport-regression-'));
const data = parseAnalysis(fs.readFileSync(path.join(root, 'examples/analysis-contract/analysis.json')));
const bound = resolveSection(fs.readFileSync(path.join(root, 'examples/analysis-contract/algorithm.cjs'), 'utf8'), data.sections[0]);
const expanded = bound.groups.map(group => group.id);
const model = {type: 'analysis-state', data, bound, graph: projectGraph(bound, new Set(expanded)), expanded,
    route: {kind: 'section', id: bound.id}, activeNode: null, revision: 1,
    freshness: {'algorithm.cjs': 'same'}, loadError: '', actionError: '', canBack: false};
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const driver = `
window.addEventListener('load', async () => {
    const report = {ok: false, checks: 0};
    const check = (condition, message) => { if (!condition) throw Error(message); report.checks++; };
    const wait = () => new Promise(resolve => setTimeout(resolve, 40));
    const send = async state => { window.postMessage(state, '*'); await wait(); };
    const verify = phase => {
        const frame = document.querySelector('.graph-viewport');
        check(frame?.style.width === '450px' && frame.style.height === '360px', phase + ': manual frame size survives');
        check(Math.abs(frame.offsetWidth - Math.min(450, frame.parentElement.clientWidth)) <= 2, phase + ': rendered width');
        check(frame.offsetHeight === 360, phase + ': rendered height');
    };
    try {
        await wait();
        const viewport = document.querySelector('.graph-viewport');
        check(getComputedStyle(viewport).resize === 'both', 'native resize enabled');
        viewport.style.width = '450px'; viewport.style.height = '360px';
        await wait();
        await send({...browserState, activeNode: browserState.graph.nodes[0].id}); verify('node selection');
        await send({...browserState, graph: foldedGraph, expanded: []}); verify('fold');
        await send(browserState); verify('unfold');
        await send({...browserState, actionError: 'Test rerender'}); verify('status update');
        await send({...browserState, route: {kind: 'overview'}, bound: null, graph: null}); verify('overview');
        await send({...browserState, route: {kind: 'path', id: browserState.bound.file}});
        check(!document.querySelector('.graph-viewport'), 'file route has no graph');
        await send({...browserState, canBack: true}); verify('return from file');
        await send({...browserState, revision: 2, data: {...browserState.data, summary: 'Reloaded analysis'}}); verify('reload');
        window.dispatchEvent(new Event('resize')); await wait(); verify('window resize');
        await send({...browserState, bound: {...browserState.bound, id: 'other'}, route: {kind: 'section', id: 'other'}}); verify('other graph');
        await send(browserState); verify('back');
        report.ok = true;
    } catch (error) { report.error = error.message; }
    const output = document.createElement('pre'); output.id = 'viewport-report';
    output.textContent = JSON.stringify(report); document.body.append(output);
});`;
console.log('Artifacts:', work);
for (const width of [560, 1280]) {
    let html = analysisHtml();
    const nonce = html.match(/script-src 'nonce-([^']+)'/)[1];
    const stub = `const browserState=${json(model)}; const foldedGraph=${json(projectGraph(bound, new Set()))};
window.acquireVsCodeApi=()=>({postMessage(message){if(message.type==='ready')window.postMessage(browserState,'*');}});
window.matchMedia=()=>({matches:true});\n`;
    html = html.replace(`<script nonce="${nonce}">`, `<script nonce="${nonce}">${stub}`);
    html = html.replace('</body>', `<script nonce="${nonce}">${driver}</script></body>`);
    const fixture = path.join(work, 'viewport-' + width + '.html');
    fs.writeFileSync(fixture, html);
    const run = spawnSync(process.env.CHROME || 'google-chrome', ['--headless', '--disable-gpu', '--disable-background-networking', '--no-sandbox',
        '--user-data-dir=' + path.join(work, 'profile-' + width), '--window-size=' + width + ',1000', '--virtual-time-budget=4000', '--dump-dom', pathToFileURL(fixture).href],
    {encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024});
    assert.equal(run.status, 0, run.error?.message || run.stderr);
    fs.writeFileSync(path.join(work, 'result-' + width + '.html'), run.stdout);
    const output = run.stdout.match(/<pre id="viewport-report"[^>]*>([\s\S]*?)<\/pre>/)?.[1];
    assert(output, 'Browser did not return a report');
    const result = JSON.parse(output.replaceAll('&amp;', '&').replaceAll('&gt;', '>').replaceAll('&lt;', '<'));
    console.log('Window width', width, result);
    assert(result.ok, result.error);
}
