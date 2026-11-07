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
        const frame = document.querySelector('.graph-viewport');
        const inner = frame.getBoundingClientRect();
        const canvasBox = () => document.querySelector('.graph-canvas').getBoundingClientRect();
        check(frame.scrollWidth >= frame.clientWidth * 2, 'free space exists left and right');
        check(frame.scrollHeight >= frame.clientHeight * 2, 'free space exists top and bottom');
        frame.scrollLeft = 0; frame.scrollTop = 0; await wait();
        check(canvasBox().left - inner.left >= frame.clientWidth - 2, 'empty space on the left');
        check(canvasBox().top - inner.top >= frame.clientHeight - 2, 'empty space on the top');
        frame.scrollLeft = frame.scrollWidth; frame.scrollTop = frame.scrollHeight; await wait();
        check(inner.left + frame.clientWidth - canvasBox().right >= frame.clientWidth - 2, 'empty space on the right');
        check(inner.top + frame.clientHeight - canvasBox().bottom >= frame.clientHeight - 2, 'empty space on the bottom');
        frame.style.width = '300px'; frame.style.height = '240px';
        window.dispatchEvent(new Event('mouseup')); await wait();
        const shrunk = document.querySelector('.graph-viewport');
        check(Math.abs(shrunk.scrollWidth - (Math.ceil(canvasBox().width) + 2 * shrunk.offsetWidth)) < 3, 'free space follows viewport resize');
        check(Math.abs(shrunk.scrollHeight - (Math.ceil(canvasBox().height) + 2 * shrunk.offsetHeight)) < 3, 'vertical free space follows viewport resize');
        shrunk.style.width = '450px'; shrunk.style.height = '360px';
        window.dispatchEvent(new Event('mouseup')); await wait();
        frame.scrollLeft = (frame.scrollWidth - frame.clientWidth) / 2; frame.scrollTop = (frame.scrollHeight - frame.clientHeight) / 2; await wait();
        const kept = frame.scrollLeft, keptTop = frame.scrollTop;
        await send({...browserState, actionError: 'Test rerender'});
        const redrawn = document.querySelector('.graph-viewport');
        check(Math.abs(redrawn.scrollLeft - kept) <= 1 && Math.abs(redrawn.scrollTop - keptTop) <= 1, 'pan position survives rerender');
        const scaleBefore = Number(document.querySelector('.graph-canvas').dataset.scale);
        const leftBefore = document.querySelector('.graph-canvas').getBoundingClientRect().left;
        const box = redrawn.getBoundingClientRect();
        const cursor = {x: box.left + redrawn.clientWidth / 2, y: box.top + redrawn.clientHeight / 2};
        redrawn.dispatchEvent(new WheelEvent('wheel', {deltaY: -100, ctrlKey: true, clientX: cursor.x, clientY: cursor.y, bubbles: true, cancelable: true}));
        await wait();
        const scaleAfter = Number(document.querySelector('.graph-canvas').dataset.scale);
        const leftAfter = document.querySelector('.graph-canvas').getBoundingClientRect().left;
        check(scaleAfter > scaleBefore, 'ctrl+wheel zooms in');
        check(Math.abs((cursor.x - leftBefore) / scaleBefore - (cursor.x - leftAfter) / scaleAfter) <= 2, 'zoom keeps the point under the cursor');
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
