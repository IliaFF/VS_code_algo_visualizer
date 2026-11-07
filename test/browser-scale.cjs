'use strict';

// Optional browser regression: node test/browser-scale.cjs (requires google-chrome).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {analysisHtml} = require('../webview.cjs');
const {parseAnalysis, resolveSection, projectGraph} = require('../analysis.cjs');
const root = path.join(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'algo-scale-regression-'));
const data = parseAnalysis(fs.readFileSync(path.join(root, 'examples/analysis-contract/analysis.json')));
const source = fs.readFileSync(path.join(root, 'examples/analysis-contract/algorithm.cjs'), 'utf8');
const bound = resolveSection(source, data.sections[0]);
const expanded = bound.groups.map(group => group.id);
const model = {type: 'analysis-state', data, bound, graph: projectGraph(bound, new Set(expanded)), expanded,
    route: {kind: 'section', id: bound.id}, activeNode: null, revision: 1,
    freshness: {'algorithm.cjs': 'same'}, loadError: '', actionError: '', canBack: false};
const geometryData = parseAnalysis(fs.readFileSync(path.join(root, 'examples/geometry/analysis.json')));
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const driver = `
window.addEventListener('load', async () => {
    const report = {ok: false, checks: 0};
    const check = (condition, message) => { if (!condition) throw Error(message); report.checks++; };
    const wait = () => new Promise(resolve => setTimeout(resolve, 40));
    const control = label => document.querySelector('[aria-label="' + label + '"]');
    try {
        document.body.style.fontSize = '13px';
        document.body.style.zoom = ROOT_ZOOM;
        // Wait for webfont metrics: labels measured against fallback fonts drift and look overlapping.
        await document.fonts.ready; await wait();
        const canvas = document.querySelector('.graph-canvas');
        const viewport = document.querySelector('.graph-viewport');
        const svg = canvas.querySelector('svg');
        const paths = [...svg.querySelectorAll('.edge-path')];
        const verifyArrows = target => {
            const edges = [...target.querySelectorAll('.edge-path')];
            check(edges.length > 0, 'arrow fixture must contain edges');
            check(target.querySelectorAll('.edge-halo').length === edges.length, 'one halo per edge, no stale halos');
            edges.forEach(edge => {
                const halo = edge.previousElementSibling;
                check(halo.classList.contains('edge-halo') && halo.getAttribute('d') === edge.getAttribute('d'), 'halo immediately below its own edge with identical route');
                check(halo.getAttribute('aria-hidden') === 'true' && !halo.hasAttribute('marker-end'), 'halo is decorative, without extra arrowheads');
                check(getComputedStyle(edge).strokeWidth === '2.5px', 'thicker arrow stroke');
                check(getComputedStyle(halo).strokeWidth === '6.5px', 'two pixel clearance on either side');
                check(getComputedStyle(halo).stroke === getComputedStyle(document.body).backgroundColor, 'halo matches theme background');
                check(getComputedStyle(edge).fill === 'none' && getComputedStyle(halo).fill === 'none', 'routes remain unfilled');
                check(edge.getAttribute('marker-end') === 'url(#analysis-arrow)', 'direction marker preserved');
            });
        };
        verifyArrows(svg);
        for (const [background, foreground] of [['#ffffff', '#222222'], ['#000000', '#ffffff']]) {
            document.body.style.setProperty('--vscode-editor-background', background);
            document.body.style.setProperty('--vscode-foreground', foreground);
            verifyArrows(svg);
        }
        document.body.style.removeProperty('--vscode-editor-background');
        document.body.style.removeProperty('--vscode-foreground');
        const checkRoutes = (target, graph) => {
            const routes = [...target.querySelectorAll('.edge-path')];
            const labels = [...target.querySelectorAll('.edge-label')];
            const starts = new Set(), ends = new Set();
            const boxes = labels.map(label => label.getBoundingClientRect());
            const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
            boxes.forEach((box, i) => {
                check(boxes.slice(i + 1).every(other => !overlaps(box, other)), 'condition labels must not overlap each other');
                check(graph.nodes.every(node => !overlaps(box, target.parentElement.querySelector('[data-node="' + node.id + '"]').getBoundingClientRect())), 'condition labels must not overlap cards');
            });
            check(routes.length === graph.edges.length, 'all graph edges rendered');
            routes.forEach((edge, i) => {
                const link = graph.edges[i];
                const start = edge.getPointAtLength(0).matrixTransform(edge.getScreenCTM());
                const end = edge.getPointAtLength(edge.getTotalLength()).matrixTransform(edge.getScreenCTM());
                const source = [link.from, start.x.toFixed(1), start.y.toFixed(1)].join(':');
                const destination = [link.to, end.x.toFixed(1), end.y.toFixed(1)].join(':');
                check(!starts.has(source), 'separate outgoing ports: ' + link.from);
                check(!ends.has(destination), 'separate incoming ports: ' + link.to);
                starts.add(source); ends.add(destination);
                for (const node of graph.nodes) {
                    const rect = target.parentElement.querySelector('[data-node="' + node.id + '"]').getBoundingClientRect();
                    for (let distance = 4; distance < edge.getTotalLength(); distance += 8) {
                        const point = edge.getPointAtLength(distance).matrixTransform(edge.getScreenCTM());
                        check(!(point.x > rect.left + 2 && point.x < rect.right - 2 && point.y > rect.top + 2 && point.y < rect.bottom - 2), 'route through card: ' + link.from + ' -> ' + link.to + ' / ' + node.id);
                    }
                }
                if (link.label) {
                    const label = labels.shift();
                    const rect = label.getBoundingClientRect();
                    check(label.textContent.includes(link.label), 'original condition text preserved');
                    check(Math.abs(rect.left + rect.width / 2 - start.x) < 2 && rect.top > start.y && rect.top - start.y < 30 * ROOT_ZOOM, 'label attached to its source port: ' + link.from);
                }
            });
            check(target.querySelectorAll('.edge-origin').length === routes.length, 'visible origin for each edge');
            if (graph.nodes.some(node => node.id === 'increment')) {
                const loopIndex = graph.edges.findIndex(edge => edge.from === 'increment' && edge.to === 'more');
                check(loopIndex >= 0 && routes[loopIndex].classList.contains('edge-return'), 'real cycle return must be distinguished');
                const loop = routes[loopIndex];
                const left = Math.min(...graph.nodes.map(node => target.parentElement.querySelector('[data-node="' + node.id + '"]').getBoundingClientRect().left));
                let outside = false;
                for (let d = 0; d < loop.getTotalLength(); d += 8) outside ||= loop.getPointAtLength(d).matrixTransform(loop.getScreenCTM()).x < left - 10;
                check(outside, 'cycle return uses an external lane');
                check(getComputedStyle(loop).strokeDasharray !== 'none', 'cycle return has a distinct line style');
            }
        };
        checkRoutes(svg, browserState.graph);
        const original = paths.map(item => item.getAttribute('d'));
        const ports = paths.map((edge, i) => {
            const link = browserState.graph.edges[i];
            const from = canvas.querySelector('[data-node="' + link.from + '"]').getBoundingClientRect();
            const to = canvas.querySelector('[data-node="' + link.to + '"]').getBoundingClientRect();
            const start = edge.getPointAtLength(0).matrixTransform(edge.getScreenCTM());
            const end = edge.getPointAtLength(edge.getTotalLength()).matrixTransform(edge.getScreenCTM());
            return {source: (start.x - from.left) / from.width, target: (end.x - to.left) / to.width};
        });
        const size = {width: canvas.offsetWidth, height: canvas.offsetHeight};
        const verify = label => {
            const scale = parseInt(document.querySelector('.graph-tools output').textContent, 10) / 100;
            const current = [...svg.querySelectorAll('.edge-path')];
            check(current.length === paths.length, label + ': all edges present');
            check(current.every((item, i) => item === paths[i] && item.getAttribute('d') === original[i]), label + ': zoom must not rebuild or reroute edges');
            check(canvas.offsetWidth === size.width && canvas.offsetHeight === size.height, label + ': zoom must not relayout cards');
            current.forEach((edge, i) => {
                const link = browserState.graph.edges[i];
                const from = canvas.querySelector('[data-node="' + link.from + '"]').getBoundingClientRect();
                const to = canvas.querySelector('[data-node="' + link.to + '"]').getBoundingClientRect();
                const start = edge.getPointAtLength(0).matrixTransform(edge.getScreenCTM());
                const end = edge.getPointAtLength(edge.getTotalLength()).matrixTransform(edge.getScreenCTM());
                const tolerance = 2;
                check(Math.abs(start.x - from.left - from.width * ports[i].source) < tolerance && Math.abs(start.y - from.bottom) < tolerance, label + ': detached source ' + link.from);
                check(Math.abs(end.x - to.left - to.width * ports[i].target) < tolerance && Math.abs(end.y - to.top + 3 * scale * ROOT_ZOOM) < tolerance, label + ': detached target ' + link.to);
            });
            check(Math.abs(viewport.scrollWidth - (Math.ceil(canvas.offsetWidth * scale) + 2 * viewport.offsetWidth)) < 3, label + ': scroll area follows scaled graph plus free space');
            check(Math.abs(viewport.scrollHeight - (Math.ceil(canvas.offsetHeight * scale) + 2 * viewport.offsetHeight)) < 3, label + ': scroll height follows scaled graph plus free space');
        };
        verify('100%');
        for (const [label, count] of [['Уменьшить граф', 4], ['Увеличить граф', 4], ['Уменьшить граф', 8], ['Увеличить граф', 5], ['Увеличить граф', 13], ['Уменьшить граф', 18]]) {
            for (let i = 0; i < count; i++) {
                control(label).click();
                verify(label + ' immediate ' + i);
                await wait();
                verify(label + ' settled ' + i);
            }
        }
        for (const deltaY of [-100, -100, 100, 100]) {
            viewport.dispatchEvent(new WheelEvent('wheel', {ctrlKey: true, deltaY, cancelable: true, clientX: 300, clientY: 300}));
            verify('Ctrl+wheel'); await wait(); verify('Ctrl+wheel settled');
        }
        control('Сбросить масштаб до 100%').click();
        await wait();
        verify('100% before viewport resize');
        const availableWidth = viewport.offsetWidth;
        check(getComputedStyle(viewport).resize === 'both', 'native two-axis resize enabled');
        for (const [width, height] of [[380, 320], [1, 1], [10000, 10000], [450, 360]]) {
            viewport.style.width = width + 'px'; viewport.style.height = height + 'px';
            window.dispatchEvent(new Event('mouseup')); await wait();
            check(Math.abs(viewport.offsetWidth - Math.max(Math.min(280, availableWidth), Math.min(width, availableWidth))) <= 2, 'width limits: ' + width);
            check(Math.abs(viewport.offsetHeight - Math.max(Math.min(240, innerHeight * .8), Math.min(height, innerHeight * .8))) <= 2, 'height limits: ' + height);
            check(document.documentElement.scrollWidth <= innerWidth + 2, 'resize must not overflow the page horizontally');
            verify('viewport ' + width + 'x' + height);
            if (width === 1) {
                check(viewport.scrollWidth > viewport.clientWidth, 'small viewport needs horizontal scrolling');
                check(viewport.scrollHeight > viewport.clientHeight, 'small viewport needs vertical scrolling');
            }
            viewport.scrollLeft = 100000; viewport.scrollTop = 100000;
            check(Math.abs(viewport.scrollLeft - (viewport.scrollWidth - viewport.clientWidth)) <= 2, 'horizontal scroll reaches end');
            check(Math.abs(viewport.scrollTop - (viewport.scrollHeight - viewport.clientHeight)) <= 2, 'vertical scroll reaches end');
            verify('scrolled resized viewport');
        }
        const manualSize = {width: viewport.offsetWidth, height: viewport.offsetHeight};
        const verifyManualSize = phase => {
            check(viewport.offsetWidth === manualSize.width && viewport.offsetHeight === manualSize.height, phase + ': middle-button pan must preserve resized viewport');
        };
        viewport.scrollLeft = 100; viewport.scrollTop = 100;
        viewport.dispatchEvent(new MouseEvent('mousedown', {button: 1, buttons: 4, clientX: 300, clientY: 300, bubbles: true, cancelable: true}));
        verifyManualSize('mousedown');
        check(viewport.classList.contains('dragging'), 'middle button starts panning');
        window.dispatchEvent(new MouseEvent('mousemove', {buttons: 4, clientX: 260, clientY: 270, cancelable: true}));
        verifyManualSize('mousemove');
        check(Math.abs(viewport.scrollLeft - 140) < 1 && Math.abs(viewport.scrollTop - 130) < 1, 'middle-button pan changes scroll position: ' + viewport.scrollLeft + ',' + viewport.scrollTop);
        await wait(); verifyManualSize('drag settled');
        window.dispatchEvent(new MouseEvent('mouseup', {button: 1, buttons: 0}));
        verifyManualSize('mouseup');
        check(!viewport.classList.contains('dragging'), 'middle-button release ends panning');
        window.postMessage({...browserState, actionError: 'Test rerender'}, '*');
        await wait();
        const resized = document.querySelector('.graph-viewport');
        check(resized !== viewport, 'fixture exercised full rerender');
        check(resized.style.width === '450px' && resized.style.height === '360px', 'manual sizes survive rerender');
        check(resized.querySelector('.graph-canvas').dataset.scale === canvas.dataset.scale, 'rerender preserves content scale');
        verifyArrows(resized.querySelector('svg'));
        const folded = {...browserState, graph: foldedGraph, expanded: []};
        window.postMessage(folded, '*'); await wait();
        const foldedSvg = document.querySelector('.graph-edges');
        verifyArrows(foldedSvg); checkRoutes(foldedSvg, foldedGraph);
        const topology = {...browserState.graph,
            nodes: ['earlier', 'later', 'self'].map((id, row) => ({...browserState.graph.nodes[0], id, row, column: 0})),
            edges: [{from: 'later', to: 'earlier', label: 'Вверх'}, {from: 'self', to: 'self', label: 'Повтор'}], groups: []};
        window.postMessage({...browserState, graph: topology}, '*'); await wait();
        const topologySvg = document.querySelector('.graph-edges');
        verifyArrows(topologySvg); checkRoutes(topologySvg, topology);
        const topologyRoutes = [...topologySvg.querySelectorAll('.edge-path')];
        check(!topologyRoutes[0].classList.contains('edge-return'), 'upward transition without a cycle is not marked as loop');
        check(topologyRoutes[1].classList.contains('edge-return'), 'self-loop is marked as return');
        window.postMessage({...browserState, data: geometryData, bound: null, graph: null, route: {kind: 'overview'}, activeNode: geometryData.overview.nodes[0].id}, '*');
        await wait();
        const overview = document.querySelector('.graph-canvas');
        const overviewSvg = overview.querySelector('svg');
        const overviewLabels = [...overviewSvg.querySelectorAll('.edge-label')];
        const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const checkOverviewLabels = () => {
            const boxes = overviewLabels.map(label => label.getBoundingClientRect());
            const cards = [...overview.querySelectorAll('.analysis-node')].map(card => card.getBoundingClientRect());
            boxes.forEach((box, index) => {
                check(boxes.slice(index + 1).every(other => !overlap(box, other)), 'geometry overview labels must not overlap each other');
                check(cards.every(card => !overlap(box, card)), 'geometry overview labels must not cover cards');
                check(overviewLabels[index].textContent === geometryData.overview.edges[index].label, 'full relation text preserved');
            });
        };
        checkOverviewLabels();
        const edgeControls = [...overviewSvg.querySelectorAll('.edge-control[tabindex="0"]')];
        check(edgeControls.length === geometryData.overview.edges.length, 'each edge must be keyboard focusable');
        const selection = [...overview.querySelectorAll('.selected')].map(card => card.dataset.node).join(',');
        check(selection === geometryData.overview.nodes[0].id, 'preselected card present before edge interaction');
        const messageCount = browserMessages.length;
        const verifyHighlight = (control, edge) => {
            check(overview.querySelector('.edge-source')?.dataset.node === edge.from, 'highlight exact source');
            check(overview.querySelector('.edge-target')?.dataset.node === edge.to, 'highlight exact destination');
            check(overview.querySelectorAll('.edge-source').length === 1 && overview.querySelectorAll('.edge-target').length === 1, 'no unrelated endpoints highlighted');
            const path = overviewSvg.querySelector('.edge-highlight .edge-active-path');
            check(path?.getAttribute('d') === control.querySelector('.edge-path').getAttribute('d'), 'highlight the complete original route without rerouting');
            check(path.getAttribute('marker-end') === 'url(#analysis-arrow-active)', 'highlight arrowhead too');
            check(getComputedStyle(overview.querySelector('.edge-source')).boxShadow !== 'none', 'source highlight must be visible');
            check(getComputedStyle(overview.querySelector('.edge-target')).boxShadow !== 'none', 'destination highlight must be visible');
            check([...overview.querySelectorAll('.selected')].map(card => card.dataset.node).join(',') === selection, 'edge hover/focus preserves selected node');
            check(browserMessages.length === messageCount, 'edge hover/focus must not navigate or highlight editor code');
        };
        const verifyCleared = () => check(!overviewSvg.querySelector('.edge-highlight') && !overview.querySelector('.edge-source,.edge-target'), 'clear transient highlight');
        edgeControls.forEach((control, index) => {
            const edge = geometryData.overview.edges[index];
            check(control.getAttribute('aria-label').includes(edge.label), 'accessible full relation label');
            const hit = control.querySelector('.edge-hit');
            check(hit && getComputedStyle(hit).pointerEvents === 'stroke', 'wide pointer hit area enabled');
            control.dispatchEvent(new PointerEvent('pointerenter'));
            verifyHighlight(control, edge);
            control.dispatchEvent(new PointerEvent('pointerleave'));
            verifyCleared();
            overviewLabels[index].dispatchEvent(new PointerEvent('pointerenter'));
            verifyHighlight(control, edge);
            overviewLabels[index].dispatchEvent(new PointerEvent('pointerleave'));
            verifyCleared();
            control.focus();
            check(document.activeElement === control, 'edge accepts keyboard focus');
            verifyHighlight(control, edge);
            control.blur();
            verifyCleared();
        });
        for (let step = 0; step < 4; step++) control('Уменьшить граф').click();
        await wait();
        check(overview.dataset.scale === '0.6', 'overview exercised at 60% scale');
        checkOverviewLabels();
        const first = edgeControls[0];
        first.dispatchEvent(new PointerEvent('pointerenter'));
        verifyHighlight(first, geometryData.overview.edges[0]);
        first.dispatchEvent(new PointerEvent('pointerleave'));
        verifyCleared();
        const area = overview.closest('.graph-viewport');
        let pathReachable = false;
        edgeControls.forEach((control, index) => {
            const hit = control.querySelector('.edge-hit');
            let reachable = false;
            for (let distance = 12; distance < hit.getTotalLength() - 12 && (!reachable || !pathReachable); distance += 20) {
                let point = hit.getPointAtLength(distance).matrixTransform(hit.getScreenCTM());
                const box = area.getBoundingClientRect();
                area.scrollLeft += point.x - (box.left + box.width / 2);
                area.scrollTop += point.y - (box.top + box.height / 2);
                point = hit.getPointAtLength(distance).matrixTransform(hit.getScreenCTM());
                const target = document.elementFromPoint(point.x, point.y);
                // A label on its own route is an equally valid pointer target, not an occluding card.
                reachable ||= target?.closest('[data-edge]')?.getAttribute('data-edge') === String(index);
                pathReachable ||= target?.closest('.edge-control') === control;
            }
            check(reachable, 'every relation must be reachable by a real pointer hit test at 60% scale');
        });
        check(pathReachable, 'visible arrow strokes, not only labels, must accept the pointer');
        report.ok = true;
    } catch (error) { report.error = error.message; }
    const output = document.createElement('pre'); output.id = 'scale-report'; output.hidden = true;
    output.textContent = JSON.stringify(report); document.body.append(output);
});`;
console.log('Artifacts:', work);
for (const [zoom, windowWidth, detailed] of [[1.25, 560], [1.25, 1280], [1, 560], [1, 1280]].flatMap(([zoom, width]) => [[zoom, width, false], [zoom, width, true]])) {
    const scenario = zoom + '-' + windowWidth + (detailed ? '-expanded' : '-folded');
    const initial = detailed ? model : {...model, graph: projectGraph(bound, new Set()), expanded: []};
    let html = analysisHtml();
    const nonce = html.match(/script-src 'nonce-([^']+)'/)[1];
    const stub = `const browserState=${json(initial)}; const foldedGraph=${json(projectGraph(bound, new Set()))}; const geometryData=${json(geometryData)}; const browserMessages=[];
window.acquireVsCodeApi=()=>({postMessage(message){browserMessages.push(message);if(message.type==='ready')window.postMessage(browserState,'*');}});
window.matchMedia=()=>({matches:true});\n`;
    html = html.replace(`<script nonce="${nonce}">`, `<script nonce="${nonce}">${stub}`);
    html = html.replace('</body>', `<script nonce="${nonce}">${driver.replaceAll('ROOT_ZOOM', String(zoom))}</script></body>`);
    const fixture = path.join(work, 'scale-' + scenario + '.html');
    fs.writeFileSync(fixture, html);
    const run = spawnSync(process.env.CHROME || 'google-chrome', ['--headless', '--disable-gpu', '--disable-background-networking', '--no-sandbox',
        '--user-data-dir=' + path.join(work, 'profile-' + scenario), '--window-size=' + windowWidth + ',1000', '--virtual-time-budget=9000', '--dump-dom', pathToFileURL(fixture).href],
    {encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024});
    assert.equal(run.status, 0, run.error?.message || run.stderr);
    fs.writeFileSync(path.join(work, 'result-' + scenario + '.html'), run.stdout);
    const output = run.stdout.match(/<pre id="scale-report"[^>]*>([\s\S]*?)<\/pre>/)?.[1];
    assert(output, 'Browser did not return a report');
    const result = JSON.parse(output.replaceAll('&amp;', '&').replaceAll('&gt;', '>').replaceAll('&lt;', '<'));
    console.log('Root zoom', zoom, 'window width', windowWidth, detailed ? 'expanded' : 'folded', result);
    assert(result.ok, result.error);
}
