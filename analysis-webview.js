'use strict';

const api = acquireVsCodeApi();
const byId = id => document.getElementById(id);
let state;
let graphObserver;
let redrawGraph;
let inputController;
let dragging = false;
let detailTarget;
let layoutKey;
let renderedRoute;
let groupOwners = new Map();
const routeKey = () => state.route.kind + ':' + (state.route.id || '');
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const motion = () => reducedMotion() ? 'instant' : 'smooth';
const scales = new Map();
const send = (type, id, source) => api.postMessage({type, id, source, revision: state?.revision});
function element(tag, text, className) {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
}
function button(label, type, id, source) {
    const item = element('button', label);
    item.type = 'button';
    item.dataset.action = type;
    item.dataset.id = id || '';
    if (source !== undefined) item.dataset.source = String(source);
    item.addEventListener('click', () => {
        if (type === 'details' || type === 'overview-inspect') {
            detailTarget = {route: routeKey(), id};
            showDetail(); fitViewport();
            if (!byId('analysis-detail').hidden) byId('analysis-detail').scrollIntoView({block: 'nearest', behavior: motion()});
        }
        send(type === 'details' ? 'inspect' : type, id, source);
    });
    return item;
}
const freshness = file => ({same: 'Текст совпадает с версией анализа; это не проверка объяснения.',
    changed: 'Файл изменился после анализа. Объяснения могут быть неактуальны.',
    unavailable: 'Файл недоступен; актуальность не проверена.'}[state.freshness[file]]);
function properties(parent, section, node) {
    const items = (state.data.properties || []).filter(property => property.section === section
        && (node ? property.node === node : !property.node) && property.text.trim());
    if (!items.length) return;
    const container = element('section', undefined, 'properties');
    container.append(element('h3', 'Свойства · утверждения агента'));
    const labels = {precondition: 'Предусловие', postcondition: 'Постусловие', invariant: 'Инвариант', 'data-contract': 'Контракт данных'};
    for (const item of items) {
        container.append(element('h4', labels[item.kind] + ' · ' + item.subject), element('p', item.text));
    }
    parent.append(container);
}
function showDetail() {
    const parent = byId('analysis-detail');
    parent.replaceChildren();
    if (!detailTarget || detailTarget.route !== routeKey()) { parent.hidden = true; return; }
    const close = element('button', 'Скрыть подробности', 'close-detail');
    close.type = 'button';
    close.addEventListener('click', () => {
        const id = detailTarget.id;
        detailTarget = null; parent.hidden = true; fitViewport();
        const target = [...document.querySelectorAll('.analysis-node [data-action]')].find(item => !item.closest('[inert]') && item.dataset.id === id);
        (target || document.querySelector('.graph-viewport'))?.focus({preventScroll: true});
    });
    parent.append(close);
    const section = state.bound;
    if (state.route.kind === 'overview') {
        const node = state.data.overview.nodes.find(item => item.id === detailTarget.id);
        parent.hidden = !node;
        if (!node) return;
        parent.append(element('h2', node.title), element('p', node.summary));
        const sources = state.overviewCode?.[node.id] || [];
        if (sources.length > 1) parent.append(element('p', 'Этот узел связан с несколькими файлами. Выберите участок; перечислены только описанные в анализе файлы.'));
        for (const [index, source] of sources.entries()) {
            const label = source.file + (source.binding ? ':' + (source.binding.start.line + 1) + '–' + (source.binding.end.line + 1) : '');
            const control = button('Показать ' + label, 'overview-reveal', node.id, index);
            control.disabled = !source.binding;
            parent.append(control, element('small', freshness(source.file)));
            if (source.bindingError) parent.append(element('p', source.bindingError, 'warning'));
        }
        if (!sources.length) parent.append(element('p', 'У этого узла нет описанных участков кода.'));
        parent.append(button('Открыть ' + (node.target.section ? 'алгоритм' : 'каталог / файл'), node.target.section ? 'section' : 'path', node.target.section || node.target.path));
        return;
    }
    const node = [...(section?.nodes || []), ...(section?.groups || []).filter(group => group.id)].find(item => item.id === detailTarget.id);
    if (!node) { parent.hidden = true; return; }
    parent.hidden = false;
    parent.append(element('h2', node.title), element('p', node.summary));
    if (node.detail?.trim()) parent.append(element('p', node.detail));
    if (node.binding) {
        parent.append(element('p', section.file + ':' + (node.binding.start.line + 1) + '–' + (node.binding.end.line + 1), 'source-label'));
        parent.append(button('Показать участок кода', 'reveal', node.id));
    } else parent.append(element('p', 'Переход отключён: ' + node.bindingError, 'warning'));
    if (node.callee) {
        if (node.callee.section) parent.append(button('Объяснение вспомогательной функции', 'callee', node.id));
        parent.append(button('К исходнику вспомогательной функции', 'callee-code', node.id));
    }
    const group = section.groups?.find(item => item.id && (item.id === node.id || item.nodes.includes(node.id)));
    if (group) {
        const expanded = state.expanded.includes(group.id);
        const toggle = button((expanded ? 'Свернуть: ' : 'Раскрыть: ') + group.title, 'toggle-group', group.id);
        toggle.setAttribute('aria-expanded', String(expanded));
        parent.append(toggle);
    }
    properties(parent, section.id, node.id);
}
function nodeCard(node, overview, group) {
    const item = overview ? element('article') : button('', 'inspect', node.id);
    item.className = 'analysis-node ' + (node.kind || 'action');
    item.dataset.node = node.id;
    if (overview) {
        const open = button('', node.target.section ? 'section' : 'path', node.target.section || node.target.path);
        open.className = 'overview-open';
        open.append(element('strong', node.title), element('span', node.summary));
        open.addEventListener('mouseenter', () => send('overview-hover', node.id));
        open.addEventListener('mouseleave', () => send('clear'));
        open.addEventListener('focus', () => send('overview-hover', node.id));
        open.addEventListener('blur', () => send('clear'));
        item.append(open, button('Код этого узла', 'overview-inspect', node.id));
        if (node.id === state.activeNode) item.classList.add('selected');
        return item;
    }
    if (!overview) {
        const selected = node.id === state.activeNode || group?.id === state.activeNode;
        item.setAttribute('aria-pressed', String(selected));
        if (selected) item.classList.add('selected');
        item.addEventListener('mouseenter', () => send('hover', node.id));
        item.addEventListener('mouseleave', () => send('clear'));
        item.addEventListener('focus', () => send('hover', node.id));
        item.addEventListener('blur', () => send('clear'));
    }
    if (group) item.append(element('span', group.title, 'group-label'));
    item.append(element('strong', node.title), element('span', node.summary));
    if (node.bindingError) item.append(element('span', 'Привязка недоступна', 'warning'));
    const block = node.collapsed ? node : group?.id && group.nodes[0] === node.id ? group : null;
    const wrapper = element('article', undefined, item.className);
    wrapper.dataset.node = node.id;
    delete item.dataset.node;
    item.className = 'node-open';
    wrapper.append(item, button('Подробнее', 'details', node.id));
    if (block) {
        const toggle = button(node.collapsed ? 'Раскрыть блок' : 'Свернуть блок', 'toggle-group', block.id);
        toggle.setAttribute('aria-label', (node.collapsed ? 'Раскрыть: ' : 'Свернуть: ') + block.title);
        toggle.setAttribute('aria-expanded', String(!node.collapsed));
        wrapper.append(toggle);
    }
    wrapper.addEventListener('click', event => { if (event.target === wrapper) item.click(); });
    return wrapper;
}
function drawEdges(canvas, nodes, edges) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-label', 'Направленные связи графа');
    svg.classList.add('graph-edges');
    const ns = svg.namespaceURI;
    const add = (tag, attrs, text) => {
        const item = document.createElementNS(ns, tag);
        for (const [key, value] of Object.entries(attrs)) item.setAttribute(key, String(value));
        if (text !== undefined) item.textContent = text;
        return item;
    };
    const defs = add('defs', {});
    for (const active of [false, true]) {
        const marker = add('marker', {id: active ? 'analysis-arrow-active' : 'analysis-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'});
        marker.append(add('path', {d: 'M 0 0 L 10 5 L 0 10 z', class: active ? 'arrow-head-active' : 'arrow-head'}));
        defs.append(marker);
    }
    svg.append(defs); canvas.append(svg);
    const cards = new Map([...canvas.querySelectorAll('.analysis-node')].map(card => [card.dataset.node, card]));
    const reaches = (start, target, visited = new Set()) => {
        if (start === target) return true;
        if (visited.has(start)) return false;
        visited.add(start);
        return edges.some(edge => edge.from === start && reaches(edge.to, target, visited));
    };
    const returns = new Set(edges.filter(edge => {
        const from = nodes.find(node => node.id === edge.from), to = nodes.find(node => node.id === edge.to);
        return to.row <= from.row && reaches(edge.to, edge.from);
    }));
    const redraw = () => {
        if (!canvas.isConnected) return;
        const matrix = svg.getScreenCTM();
        if (!matrix) return;
        svg.querySelectorAll('.edge-control,.edge-label-layer,.edge-highlight').forEach(item => item.remove());
        cards.forEach(card => card.classList.remove('edge-source', 'edge-target'));
        svg.setAttribute('width', canvas.scrollWidth); svg.setAttribute('height', canvas.offsetHeight);
        const inverse = matrix.inverse();
        const positions = new Map(nodes.map(node => {
            const rect = cards.get(node.id).getBoundingClientRect();
            const top = new DOMPoint(rect.left + rect.width / 2, rect.top).matrixTransform(inverse);
            const bottom = new DOMPoint(rect.left + rect.width / 2, rect.bottom).matrixTransform(inverse);
            const left = new DOMPoint(rect.left, rect.top).matrixTransform(inverse).x;
            const right = new DOMPoint(rect.right, rect.top).matrixTransform(inverse).x;
            return [node.id, {left, right, top: top.y, bottom: bottom.y}];
        }));
        const left = Math.min(...[...positions.values()].map(rect => rect.left));
        const right = Math.max(...[...positions.values()].map(rect => rect.right));
        const labels = [], occupied = [...positions.values()];
        let hovered, focused;
        const highlight = () => {
            svg.querySelector('.edge-highlight')?.remove();
            cards.forEach(card => card.classList.remove('edge-source', 'edge-target'));
            const active = hovered || focused;
            if (!active) return;
            cards.get(active.edge.from).classList.add('edge-source');
            cards.get(active.edge.to).classList.add('edge-target');
            // Draw above other routes without reordering the original edges or their hit areas.
            const overlay = add('g', {class: 'edge-highlight', 'aria-hidden': 'true'});
            overlay.append(add('path', {d: active.path.getAttribute('d'), class: 'edge-active-halo'}),
                add('path', {d: active.path.getAttribute('d'), class: 'edge-active-path' + (returns.has(active.edge) ? ' edge-return' : ''), 'marker-end': 'url(#analysis-arrow-active)'}),
                add('circle', {cx: active.x1, cy: active.from.bottom, r: 4.5, class: 'arrow-head-active'}));
            if (active.label) {
                const label = active.label.cloneNode(true);
                label.setAttribute('class', 'edge-active-label');
                overlay.append(label);
            }
            svg.append(overlay);
        };
        const pointer = (item, relation) => {
            item.addEventListener('pointerenter', () => { hovered = relation; highlight(); });
            item.addEventListener('pointerleave', () => { if (hovered === relation) hovered = null; highlight(); });
        };
        edges.forEach((edge, index) => {
            const from = positions.get(edge.from), to = positions.get(edge.to);
            const outgoing = edges.filter(item => item.from === edge.from);
            const incoming = edges.filter(item => item.to === edge.to);
            const sourceIndex = outgoing.indexOf(edge), targetIndex = incoming.indexOf(edge);
            const x1 = from.left + (from.right - from.left) * (sourceIndex + 1) / (outgoing.length + 1);
            const x2 = to.left + (to.right - to.left) * (targetIndex + 1) / (incoming.length + 1);
            const y1 = from.bottom + 36 + sourceIndex * 18;
            const y2 = to.top - 30 - targetIndex * 12;
            const returning = returns.has(edge);
            const direct = !returning && to.top > from.bottom && to.top - from.bottom < 150;
            const lane = returning ? left - 40 - index * 24 : right + 40 + index * 24;
            const points = direct ? [[x1, from.bottom], [x1, y1], [x2, y1], [x2, to.top - 3]]
                : [[x1, from.bottom], [x1, y1], [lane, y1], [lane, y2], [x2, y2], [x2, to.top - 3]];
            const d = direct
                ? `M ${x1} ${from.bottom} V ${y1} H ${x2} V ${to.top - 3}`
                : `M ${x1} ${from.bottom} V ${y1} H ${lane} V ${y2} H ${x2} V ${to.top - 3}`;
            const path = add('path', {d, class: 'edge-path' + (returning ? ' edge-return' : ''), 'marker-end': 'url(#analysis-arrow)'});
            const title = nodes.find(node => node.id === edge.from).title + ' → ' + nodes.find(node => node.id === edge.to).title + (edge.label ? ': ' + edge.label : '');
            const control = add('g', {class: 'edge-control', tabindex: 0, role: 'img', 'aria-label': title, 'data-edge': index});
            control.append(add('title', {}, title), add('path', {d, class: 'edge-halo', 'aria-hidden': 'true'}), path,
                add('circle', {cx: x1, cy: from.bottom, r: 3.5, class: 'edge-origin', 'aria-hidden': 'true'}),
                add('path', {d, class: 'edge-hit', 'aria-hidden': 'true'}));
            svg.append(control);
            const relation = {edge, path, x1, from, points, index};
            pointer(control, relation);
            control.addEventListener('focus', () => { focused = relation; highlight(); });
            control.addEventListener('blur', () => { if (focused === relation) focused = null; highlight(); });
            if (edge.label || returning) labels.push(relation);
        });
        const layer = add('g', {class: 'edge-label-layer'});
        svg.append(layer);
        const overlaps = (a, b) => a.left < b.right + 5 && a.right + 5 > b.left && a.top < b.bottom + 5 && a.bottom + 5 > b.top;
        for (const relation of labels) {
            const {edge, x1, from, points, index} = relation;
            const label = add('foreignObject', {width: 180, height: 1000, class: 'edge-label', 'data-edge': index});
            const body = element('div', returns.has(edge) ? '↶ ' + (edge.label || 'Возврат цикла') : edge.label, 'edge-label-body');
            label.append(body); layer.append(label);
            const width = body.offsetWidth, height = body.offsetHeight;
            const candidates = [[x1, from.bottom + height / 2 + 7]];
            for (let i = 1; i < points.length; i++) {
                const [ax, ay] = points[i - 1], [bx, by] = points[i];
                if (ay === by && Math.abs(bx - ax) >= width + 16) {
                    const lo = Math.min(ax, bx) + width / 2 + 8, hi = Math.max(ax, bx) - width / 2 - 8;
                    candidates.push([(lo + hi) / 2, ay]);
                    for (let x = lo; x <= hi; x += Math.max(24, width / 2)) candidates.push([x, ay]);
                } else if (ax === bx && Math.abs(by - ay) >= height + 16) {
                    const lo = Math.min(ay, by) + height / 2 + 8, hi = Math.max(ay, by) - height / 2 - 8;
                    candidates.push([ax, (lo + hi) / 2]);
                    for (let y = lo; y <= hi; y += height + 8) candidates.push([ax, y]);
                }
            }
            const box = ([x, y]) => ({left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2});
            const free = center => { const rect = box(center); return rect.left >= 4 && rect.right <= canvas.offsetWidth - 4 && !occupied.some(other => overlaps(rect, other)); };
            let center = candidates.find(free);
            if (!center) {
                center = [Math.max(width / 2 + 8, left - width / 2 - 16), from.bottom + height / 2 + 7];
                while (!free(center)) center[1] += height + 8;
                layer.append(add('path', {d: `M ${x1} ${from.bottom + 4} L ${center[0]} ${center[1]}`, class: 'edge-label-leader', 'aria-hidden': 'true'}));
            }
            const rect = box(center);
            occupied.push(rect);
            label.setAttribute('x', rect.left); label.setAttribute('y', rect.top);
            label.setAttribute('width', width); label.setAttribute('height', height);
            relation.label = label;
            pointer(label, relation);
        }
        const bottom = Math.max(...[...positions.values()].map(rect => rect.bottom));
        canvas.style.paddingBottom = Math.max(90, ...occupied.map(rect => rect.bottom - bottom + 12)) + 'px';
        svg.setAttribute('height', canvas.offsetHeight);
    };
    return redraw;
}
function graph(parent, model, overview = false) {
    const viewport = element('div', undefined, 'graph-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', 'Граф с прокруткой');
    const world = element('div', undefined, 'graph-world');
    const canvas = element('div', undefined, 'graph-canvas');
    const grid = element('div', undefined, 'graph-grid');
    const columns = [...new Set(model.nodes.map(node => node.column))].sort((a, b) => a - b);
    const rows = [...new Set(model.nodes.map(node => node.row))].sort((a, b) => a - b);
    grid.style.gridTemplateColumns = `repeat(${columns.length}, 240px)`;
    canvas.style.paddingLeft = canvas.style.paddingRight = Math.max(150, model.edges.length * 24 + 80) + 'px';
    for (const node of [...model.nodes].sort((a, b) => a.row - b.row || a.column - b.column)) {
        const group = model.groups?.find(item => item.nodes.includes(node.id));
        const card = nodeCard(node, overview, group);
        card.style.gridColumn = String(columns.indexOf(node.column) + 1);
        card.style.gridRow = String(rows.indexOf(node.row) + 1);
        grid.append(card);
    }
    const key = state.route.kind + ':' + (state.route.id || '');
    let scale = scales.get(key) || 1;
    canvas.dataset.scale = String(scale);
    canvas.style.transform = `scale(${scale})`;
    const controls = element('nav', undefined, 'graph-tools');
    controls.setAttribute('aria-label', 'Масштаб графа');
    const minus = element('button', '−'), plus = element('button', '+'), reset = element('button', '100%');
    minus.setAttribute('aria-label', 'Уменьшить граф'); plus.setAttribute('aria-label', 'Увеличить граф');
    reset.setAttribute('aria-label', 'Сбросить масштаб до 100%');
    const value = element('output');
    value.setAttribute('aria-live', 'polite');
    for (const item of [minus, plus, reset]) item.type = 'button';
    controls.append(minus, value, plus, reset);
    parent.append(element('p', 'Точка — начало перехода, наконечник — вход в блок. Наведите на стрелку или её подпись, чтобы выделить связь и оба блока; Tab делает то же с клавиатуры. Пунктир ↶ — возврат по циклу. Скрытые внутри блока переходы видны после раскрытия. Размер области: потяните за правый нижний угол; масштаб содержимого не изменится.'));
    canvas.append(grid); world.append(canvas); viewport.append(world); parent.append(controls, viewport);
    const resizeWorld = () => {
        world.style.width = canvas.offsetWidth * scale + 'px';
        world.style.height = canvas.offsetHeight * scale + 'px';
    };
    const redrawEdges = drawEdges(canvas, model.nodes, model.edges);
    let width, height;
    const redraw = () => {
        redrawEdges(); resizeWorld();
        width = canvas.offsetWidth; height = canvas.offsetHeight;
    };
    redrawGraph = redraw;
    graphObserver = new ResizeObserver(() => {
        if (width !== canvas.offsetWidth || height !== canvas.offsetHeight) redraw();
    });
    graphObserver.observe(canvas);
    redraw();
    const update = () => {
        value.textContent = Math.round(scale * 100) + '%';
        minus.disabled = scale <= .25; plus.disabled = scale >= 2;
    };
    const zoom = (next, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) => {
        const point = {x: (viewport.scrollLeft + x) / scale, y: (viewport.scrollTop + y) / scale};
        scale = Math.max(.25, Math.min(2, Math.round(next * 100) / 100));
        scales.set(key, scale);
        canvas.dataset.scale = String(scale); canvas.style.transform = `scale(${scale})`;
        resizeWorld(); update();
        viewport.scrollLeft = point.x * scale - x; viewport.scrollTop = point.y * scale - y;
    };
    minus.addEventListener('click', () => zoom(scale - .1));
    plus.addEventListener('click', () => zoom(scale + .1));
    reset.addEventListener('click', () => zoom(1));
    viewport.addEventListener('wheel', event => {
        if (!event.ctrlKey || !event.deltaY) return;
        event.preventDefault();
        const box = viewport.getBoundingClientRect();
        zoom(scale + (event.deltaY < 0 ? .1 : -.1), event.clientX - box.left, event.clientY - box.top);
    }, {passive: false});
    update();
    const signal = inputController.signal;
    let drag;
    const endDrag = () => { drag = null; dragging = false; viewport.classList.remove('dragging'); };
    viewport.addEventListener('mousedown', event => {
        if (event.button !== 1) return;
        event.preventDefault();
        viewport.scrollTo({left: viewport.scrollLeft, top: viewport.scrollTop, behavior: 'instant'});
        drag = {x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop};
        dragging = true; viewport.classList.add('dragging');
    });
    viewport.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
    window.addEventListener('mousemove', event => {
        if (!drag) return;
        if (!(event.buttons & 4)) { endDrag(); return; }
        event.preventDefault();
        viewport.scrollLeft = drag.left - (event.clientX - drag.x);
        viewport.scrollTop = drag.top - (event.clientY - drag.y);
    }, {signal});
    window.addEventListener('mouseup', event => { if (event.button === 1) endDrag(); }, {signal});
    window.addEventListener('blur', endDrag, {signal});
    if (model.edges.length) {
        const relations = element('details');
        relations.append(element('summary', 'Связи графа текстом'));
        const list = element('ul');
        for (const edge of model.edges) {
            const from = model.nodes.find(node => node.id === edge.from).title;
            const to = model.nodes.find(node => node.id === edge.to).title;
            list.append(element('li', from + ' → ' + to + (edge.label ? ': ' + edge.label : '')));
        }
        relations.append(list); parent.append(relations);
    }
}
function entries(parent, items) {
    const list = element('ul', undefined, 'entry-list');
    for (const item of items) {
        const row = element('li');
        row.append(button(item.path + (item.kind === 'directory' ? '/' : ''), 'path', item.path), element('p', item.summary));
        if (item.kind === 'file') row.append(element('small', freshness(item.path)));
        list.append(row);
    }
    parent.append(list);
}
function markSelection() {
    for (const card of document.querySelectorAll('.graph-grid .analysis-node,.operation-list .analysis-node')) {
        const selected = card.dataset.node === state.activeNode || groupOwners.get(card.dataset.node) === state.activeNode;
        card.classList.toggle('selected', selected);
        card.querySelector('[data-action="inspect"]')?.setAttribute('aria-pressed', String(selected));
    }
}
function animateGraph(previous, owners) {
    const viewport = document.querySelector('.graph-viewport');
    if (!viewport || reducedMotion() || !previous.size) return;
    const scale = Number(viewport.querySelector('.graph-canvas').dataset.scale) || 1;
    const cards = new Map([...viewport.querySelectorAll('.graph-grid .analysis-node')].map(item => [item.dataset.node, item]));
    const rects = new Map([...cards].map(([id, item]) => [id, item.getBoundingClientRect()]));
    const groups = new Map((state.bound?.groups || []).filter(group => group.id).map(group => [group.id, group.nodes]));
    const animations = [];
    for (const [id, item] of cards) {
        const origin = previous.get(id) || previous.get(groupOwners.get(id)) || previous.get(groups.get(id)?.[0]);
        if (!origin) { animations.push(item.animate([{opacity: 0}, {opacity: 1}], {duration: 220})); continue; }
        const target = rects.get(id), from = origin.rect;
        if (Math.abs(from.left - target.left) + Math.abs(from.top - target.top) + Math.abs(from.width - target.width) + Math.abs(from.height - target.height) < 1 && previous.has(id)) continue;
        animations.push(item.animate([
            {transform: `translate(${(from.left - target.left) / scale}px,${(from.top - target.top) / scale}px) scale(${from.width / target.width},${from.height / target.height})`, opacity: previous.has(id) ? 1 : 0},
            {transform: 'none', opacity: 1}
        ], {duration: 220, easing: 'ease-in-out'}));
    }
    const box = viewport.getBoundingClientRect();
    for (const [id, source] of previous) {
        if (cards.has(id)) continue;
        const from = source.rect, to = rects.get(owners.get(id)) || rects.get(groups.get(id)?.[0]) || from;
        const ghost = source.item.cloneNode(true);
        ghost.removeAttribute('data-node'); ghost.dataset.ghost = ''; ghost.inert = true; ghost.setAttribute('aria-hidden', 'true');
        Object.assign(ghost.style, {position: 'absolute', pointerEvents: 'none', margin: '0', zIndex: '3', transformOrigin: '0 0',
            left: from.left - box.left + viewport.scrollLeft - viewport.clientLeft + 'px', top: from.top - box.top + viewport.scrollTop - viewport.clientTop + 'px',
            width: from.width / scale + 'px', height: from.height / scale + 'px'});
        viewport.append(ghost);
        const animation = ghost.animate([{transform: `scale(${scale})`, opacity: 1},
            {transform: `translate(${to.left - from.left}px,${to.top - from.top}px) scale(${scale * to.width / from.width},${scale * to.height / from.height})`, opacity: 0}], {duration: 220, easing: 'ease-in-out'});
        animations.push(animation);
        animation.finished.then(() => ghost.remove(), () => ghost.remove());
    }
    if (!animations.length) return;
    const edges = viewport.querySelector('.graph-edges');
    edges.style.visibility = 'hidden';
    Promise.allSettled(animations.map(item => item.finished)).then(() => {
        if (!edges.isConnected) return;
        redrawGraph();
        edges.style.visibility = '';
        edges.animate([{opacity: 0}, {opacity: 1}], {duration: 100});
    });
}
function render() {
    const key = JSON.stringify([state.route, state.data, state.bound, state.graph, state.expanded, state.freshness, state.loadError, state.actionError]);
    const sameRoute = renderedRoute === routeKey();
    byId('back').disabled = !state.canBack;
    if (key === layoutKey) {
        markSelection();
        if (!dragging) revealSelection();
        return;
    }
    const oldViewport = document.querySelector('.graph-viewport');
    const camera = sameRoute && oldViewport ? {left: oldViewport.scrollLeft, top: oldViewport.scrollTop, width: oldViewport.style.width, height: oldViewport.style.height} : null;
    const previous = new Map(sameRoute ? [...document.querySelectorAll('.graph-grid .analysis-node')].map(item => [item.dataset.node, {item, rect: item.getBoundingClientRect()}]) : []);
    const owners = groupOwners;
    groupOwners = new Map((state.bound?.groups || []).filter(group => group.id).flatMap(group => group.nodes.map(id => [id, group.id])));
    layoutKey = key; renderedRoute = routeKey();
    graphObserver?.disconnect(); inputController?.abort(); inputController = new AbortController(); dragging = false;
    const focused = document.activeElement?.dataset.action ? {...document.activeElement.dataset} : null;
    byId('analysis-title').textContent = state.data.title;
    byId('load-error').textContent = state.loadError;
    byId('action-error').textContent = state.actionError;
    byId('back').disabled = !state.canBack;
    const parent = byId('analysis-content');
    parent.replaceChildren();
    byId('analysis-status').textContent = '';
    if (state.route.kind === 'overview') {
        parent.append(element('h2', 'Общая логика проекта'), element('p', state.data.summary));
        graph(parent, state.data.overview, true);
        parent.append(element('h2', 'Описанные каталоги и файлы'));
        entries(parent, state.data.entries);
    } else if (state.route.kind === 'path') {
        const entry = state.data.entries.find(item => item.path === state.route.id);
        parent.append(element('h2', entry.path), element('p', entry.summary));
        if (entry.kind === 'directory') entries(parent, state.data.entries.filter(item => item.path !== entry.path && (entry.path === '.' || item.path.startsWith(entry.path + '/'))));
        const sections = state.data.sections.filter(item => item.file === entry.path);
        for (const section of sections) parent.append(button(section.title, 'section', section.id));
        if (entry.kind === 'file') {
            byId('analysis-status').textContent = freshness(entry.path);
            parent.append(button('Показать файл', 'path-reveal'));
        }
    } else {
        const section = state.bound;
        parent.append(element('h2', section.title + (section.scope === 'fragment' ? ' · ФРАГМЕНТ' : '')), element('p', section.summary));
        byId('analysis-status').textContent = freshness(section.file);
        if (section.bindingError) parent.append(element('p', section.bindingError, 'warning'));
        parent.append(button('Показать код раздела', 'reveal-section'));
        if (section.layout === 'graph') {
            const groups = (section.groups || []).filter(group => group.id);
            if (groups.length) {
                const controls = element('nav', undefined, 'detail-tools');
                controls.setAttribute('aria-label', 'Детализация алгоритма');
                controls.append(button('Все подробно', 'expand-all'), button('Свернуть смысловые блоки', 'collapse-all'));
                parent.append(controls);
            }
            const model = state.graph || section;
            parent.append(element('p', model.nodes.some(node => node.collapsed)
                ? 'Смысловые блоки: внутренние ветви и рёбра свёрнуты. Выберите блок и раскройте его либо нажмите «Все подробно».'
                : 'Малые смысловые участки: показаны все узлы описанного графа.'));
            graph(parent, model);
        }
        else {
            const list = element('ul', undefined, 'operation-list');
            for (const node of section.nodes) { const row = element('li'); row.append(nodeCard(node, false)); list.append(row); }
            parent.append(list);
        }
        properties(parent, section.id);
    }
    showDetail();
    const viewport = document.querySelector('.graph-viewport');
    fitViewport();
    if (viewport && camera) {
        viewport.style.width = camera.width; viewport.style.height = camera.height;
        viewport.scrollLeft = camera.left; viewport.scrollTop = camera.top;
    }
    markSelection();
    revealSelection(!sameRoute);
    animateGraph(previous, owners);
    if (focused && !state.fromEditor) [...document.querySelectorAll('button[data-action]')].find(item => item.dataset.action === focused.action
        && item.dataset.id === focused.id && item.dataset.source === focused.source)?.focus({preventScroll: true});
}
function fitViewport() {
    const viewport = document.querySelector('.graph-viewport');
    if (viewport) viewport.style.setProperty('--graph-height', Math.max(240, Math.min(innerHeight * .8, innerHeight - viewport.getBoundingClientRect().top - 24)) + 'px');
}
function revealSelection(initial = false) {
    const viewport = byId('analysis-content').querySelector('.graph-viewport');
    if (!viewport) return;
    let id = state.activeNode || (initial ? state.graph?.entry || state.bound?.entry : null);
    if (state.expanded?.includes(id)) id = state.bound.groups.find(group => group.id === id)?.nodes[0];
    const card = [...viewport.querySelectorAll('.analysis-node')].find(item => item.dataset.node === id);
    if (!card) return;
    let rect = card.getBoundingClientRect();
    if (card.getAnimations().length) {
        // Камера следует конечной раскладке, а не промежуточному кадру раскрытия.
        const grid = card.parentElement.getBoundingClientRect(), scale = Number(card.closest('.graph-canvas').dataset.scale) || 1;
        rect = new DOMRect(grid.left + card.offsetLeft * scale, grid.top + card.offsetTop * scale, card.offsetWidth * scale, card.offsetHeight * scale);
    }
    const box = viewport.getBoundingClientRect();
    const delta = (start, end, min, max) => {
        if (end - start > max - min && end > min && start < max) return 0;
        return start < min ? start - min : end > max ? end - max : 0;
    };
    const dx = delta(rect.left, rect.right, box.left + viewport.clientLeft, box.left + viewport.clientLeft + viewport.clientWidth);
    const dy = delta(rect.top, rect.bottom, box.top + viewport.clientTop, box.top + viewport.clientTop + viewport.clientHeight);
    if (dx || dy) viewport.scrollTo({left: viewport.scrollLeft + dx, top: viewport.scrollTop + dy, behavior: motion()});
}
window.addEventListener('resize', () => { if (state) { fitViewport(); if (!dragging) revealSelection(); } });
for (const type of ['back', 'overview', 'reload']) byId(type).addEventListener('click', () => send(type));
window.addEventListener('message', event => {
    if (event.data?.type !== 'analysis-state') return;
    state = event.data; render();
});
api.postMessage({type: 'ready'});
