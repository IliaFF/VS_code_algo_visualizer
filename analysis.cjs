'use strict';

const {createHash} = require('node:crypto');

const canonical = text => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const digest = text => createHash('sha256').update(canonical(text), 'utf8').digest('hex');
const fail = (path, message) => { throw new Error(path + ': ' + message); };
const text = (value, path) => {
    if (typeof value !== 'string' || !value.trim()) fail(path, 'нужен непустой текст');
};
function object(value, required, optional, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'нужен объект');
    for (const key of required) if (!Object.hasOwn(value, key)) fail(path + '.' + key, 'нет поля');
    for (const key of Object.keys(value)) if (![...required, ...optional].includes(key)) fail(path + '.' + key, 'неизвестное поле');
}
function array(value, path, nonempty = false) {
    if (!Array.isArray(value) || (nonempty && !value.length)) fail(path, 'нужен ' + (nonempty ? 'непустой ' : '') + 'массив');
}
function oneOf(value, choices, path) {
    if (!choices.includes(value)) fail(path, 'ожидается ' + choices.join(' / '));
}
function ids(items, path) {
    const result = new Set();
    for (const item of items) {
        if (!item || typeof item.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(item.id) || result.has(item.id)) fail(path, 'неверный или повторный id');
        result.add(item.id);
    }
    return result;
}
function range(value, path) {
    object(value, ['start', 'end'], [], path);
    for (const key of ['start', 'end']) {
        if (typeof value[key] !== 'string' || !value[key].length || value[key].includes('\r')) fail(path + '.' + key, 'нужен непустой якорь с окончаниями LF');
    }
}
function validPath(value, directory = false) {
    if (directory && value === '.') return true;
    return typeof value === 'string' && value.length > 0 && !/[\\:\x00-\x1f\x7f]/.test(value)
        && value.split('/').every(part => part && part !== '.' && part !== '..');
}
function validateAnalysis(data) {
    object(data, ['version', 'title', 'summary', 'entries', 'overview', 'sections'], ['properties'], '$');
    if (data.version !== 1) fail('version', 'поддерживается только версия 1');
    text(data.title, 'title'); text(data.summary, 'summary');
    array(data.entries, 'entries', true); array(data.sections, 'sections', true);
    const entries = new Map();
    for (const entry of data.entries) {
        object(entry, ['path', 'kind', 'summary'], ['sha256'], 'entries');
        oneOf(entry.kind, ['directory', 'file'], 'entries.kind');
        if (!validPath(entry.path, entry.kind === 'directory') || entries.has(entry.path)) fail('entries.path', 'недопустимый или повторный путь');
        text(entry.summary, entry.path);
        if (entry.kind === 'file' ? !/^[a-f0-9]{64}$/.test(entry.sha256 || '') : Object.hasOwn(entry, 'sha256')) fail(entry.path, 'неверное поле sha256');
        entries.set(entry.path, entry);
    }
    const sections = ids(data.sections, 'sections');
    const file = value => { if (entries.get(value)?.kind !== 'file') fail('file', 'неописанный файл: ' + value); };
    const positioned = (nodes, path) => {
        const used = new Set();
        for (const node of nodes) {
            for (const key of ['row', 'column']) if (!Number.isSafeInteger(node[key]) || node[key] < 0) fail(path + '.' + key, 'нужно неотрицательное целое');
            const position = node.row + ':' + node.column;
            if (used.has(position)) fail(path, 'повторная позиция ' + position);
            used.add(position);
        }
    };
    const edges = (items, nodes, path, overview = false) => {
        array(items, path);
        const used = new Set();
        for (const edge of items) {
            object(edge, ['from', 'to'], ['label'], path);
            if (!nodes.has(edge.from) || !nodes.has(edge.to)) fail(path, 'неизвестный конец ребра');
            if (overview || Object.hasOwn(edge, 'label')) text(edge.label, path + '.label');
            const key = JSON.stringify([edge.from, edge.to, edge.label]);
            if (used.has(key)) fail(path, 'повторное ребро');
            used.add(key);
        }
    };
    object(data.overview, ['nodes', 'edges'], [], 'overview');
    array(data.overview.nodes, 'overview.nodes', true);
    if (data.overview.nodes.length > 20) fail('overview.nodes', 'не более 20 узлов');
    const overviewIds = ids(data.overview.nodes, 'overview.nodes');
    for (const node of data.overview.nodes) {
        object(node, ['id', 'title', 'summary', 'row', 'column', 'target'], [], 'overview.nodes');
        text(node.title, node.id); text(node.summary, node.id);
        object(node.target, [], ['path', 'section'], node.id + '.target');
        if (Object.keys(node.target).length !== 1) fail(node.id, 'нужна одна цель');
        if (Object.hasOwn(node.target, 'path') ? !entries.has(node.target.path) : !sections.has(node.target.section)) fail(node.id, 'неизвестная цель');
    }
    positioned(data.overview.nodes, 'overview.nodes');
    edges(data.overview.edges, overviewIds, 'overview.edges', true);
    for (const section of data.sections) {
        const graph = section.layout === 'graph';
        object(section, ['id', 'title', 'summary', 'file', 'scope', 'layout', 'nodes'], graph ? ['range', 'entry', 'edges', 'groups'] : ['range'], section.id);
        oneOf(section.layout, ['graph', 'list'], section.id + '.layout');
        oneOf(section.scope, graph ? ['function', 'fragment'] : ['file', 'fragment'], section.id + '.scope');
        text(section.title, section.id); text(section.summary, section.id); file(section.file);
        if (section.scope !== 'file') range(section.range, section.id + '.range');
        else if (Object.hasOwn(section, 'range')) fail(section.id, 'список всего файла не имеет range');
        array(section.nodes, section.id + '.nodes', true);
        const nodes = ids(section.nodes, section.id + '.nodes');
        for (const node of section.nodes) {
            object(node, ['id', 'title', 'summary', 'range', ...(graph ? ['kind', 'row', 'column'] : [])], ['detail', 'callee'], section.id + '.' + node.id);
            text(node.title, node.id); text(node.summary, node.id); range(node.range, node.id + '.range');
            if (Object.hasOwn(node, 'detail') && typeof node.detail !== 'string') fail(node.id, 'detail должен быть текстом');
            if (graph) oneOf(node.kind, ['action', 'condition', 'exit'], node.id + '.kind');
            if (node.callee) {
                object(node.callee, ['file', 'range'], ['section'], node.id + '.callee');
                file(node.callee.file); range(node.callee.range, node.id + '.callee.range');
                if (Object.hasOwn(node.callee, 'section') && !data.sections.some(item => item.id === node.callee.section && item.file === node.callee.file)) fail(node.id, 'неизвестный раздел callee или другой файл');
            } else if (Object.hasOwn(node, 'callee')) fail(node.id, 'callee должен быть объектом');
        }
        if (!graph) continue;
        positioned(section.nodes, section.id);
        if (!nodes.has(section.entry)) fail(section.id + '.entry', 'неизвестный начальный узел');
        edges(section.edges, nodes, section.id + '.edges');
        for (const node of section.nodes) {
            const outgoing = section.edges.filter(edge => edge.from === node.id);
            if (node.kind === 'exit' ? outgoing.length : !outgoing.length) fail(node.id, 'неверное число исходящих рёбер');
            if (node.kind === 'condition') {
                if (outgoing.length < 2) fail(node.id, 'у условия не менее двух выходов');
                outgoing.forEach(edge => text(edge.label, node.id + '.edge.label'));
            }
        }
        if (Object.hasOwn(section, 'groups')) {
            array(section.groups, section.id + '.groups');
            const grouped = new Set();
            const groupIds = new Set(nodes);
            for (const group of section.groups) {
                object(group, ['title', 'nodes'], ['id', 'summary', 'range'], section.id + '.groups');
                if (['id', 'summary', 'range'].some(key => Object.hasOwn(group, key))) {
                    ids([group], 'groups.id');
                    if (groupIds.has(group.id)) fail('groups.id', 'повторный id группы или узла');
                    groupIds.add(group.id);
                    text(group.summary, 'groups.summary'); range(group.range, 'groups.range');
                }
                text(group.title, 'groups.title'); array(group.nodes, 'groups.nodes', true);
                for (const id of group.nodes) {
                    if (!nodes.has(id) || grouped.has(id)) fail('groups.nodes', 'неизвестный или повторный узел');
                    grouped.add(id);
                }
            }
        }
    }
    if (Object.hasOwn(data, 'properties')) {
        array(data.properties, 'properties');
        for (const property of data.properties) {
            object(property, ['kind', 'section', 'subject', 'text'], ['node'], 'properties');
            oneOf(property.kind, ['precondition', 'postcondition', 'invariant', 'data-contract'], 'properties.kind');
            const section = data.sections.find(item => item.id === property.section);
            if (!section || (Object.hasOwn(property, 'node') && ![...section.nodes, ...(section.groups || [])].some(node => node.id === property.node))) fail('properties', 'неизвестная область');
            text(property.subject, 'properties.subject');
            if (typeof property.text !== 'string') fail('properties.text', 'нужен текст');
        }
    }
    return data;
}
function parseAnalysis(bytes) {
    const source = typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    return validateAnalysis(JSON.parse(source.replace(/^\uFEFF/, '')));
}
function locate(text, anchor, base = 0) {
    const unique = value => {
        const index = text.indexOf(value);
        if (index < 0 || text.indexOf(value, index + 1) >= 0) fail('range', 'не найден однозначный якорь: ' + value.trim());
        return index;
    };
    const start = unique(anchor.start);
    const endStart = unique(anchor.end);
    const end = endStart + anchor.end.length;
    if (endStart < start || end < start + anchor.start.length) fail('range', 'изменился порядок якорей');
    return {start: base + start, end: base + end};
}
function resolveSection(raw, section) {
    const source = canonical(raw);
    const position = offset => {
        const prefix = source.slice(0, offset).split('\n');
        return {line: prefix.length - 1, character: prefix.at(-1).length + (prefix.length === 1 && raw.startsWith('\uFEFF') ? 1 : 0)};
    };
    const binding = span => ({start: position(span.start), end: position(span.end)});
    let scope, bindingError;
    try { scope = section.range ? locate(source, section.range) : {start: 0, end: source.length}; }
    catch (error) { bindingError = error.message; }
    const resolve = node => {
        if (!scope) return {...node, bindingError};
        try { return {...node, binding: binding(locate(source.slice(scope.start, scope.end), node.range, scope.start))}; }
        catch (error) { return {...node, bindingError: error.message}; }
    };
    const result = {...section, nodes: section.nodes.map(resolve)};
    if (scope) result.binding = binding(scope);
    else result.bindingError = bindingError;
    if (section.groups) result.groups = section.groups.map(group => {
        if (!group.id) return {...group};
        const resolved = resolve(group);
        if (resolved.binding && group.nodes.some(id => {
            const node = result.nodes.find(item => item.id === id);
            return !node?.binding || !contains(resolved.binding, node.binding);
        })) {
            delete resolved.binding;
            resolved.bindingError = 'Диапазон блока не содержит все привязки его узлов';
        }
        return resolved;
    });
    return result;
}
const compare = (a, b) => a.line - b.line || a.character - b.character;
const contains = (range, selection) => compare(range.start, selection.start) <= 0
    && compare(selection.end, range.end) <= 0 && (compare(selection.start, selection.end) !== 0 || compare(selection.start, range.end) < 0);

function projectGraph(section, expanded = new Set()) {
    const folded = (section.groups || []).filter(group => group.id && !expanded.has(group.id));
    const owner = new Map(folded.flatMap(group => group.nodes.map(id => [id, group.id])));
    const nodes = section.nodes.filter(node => !owner.has(node.id));
    for (const group of folded) {
        const members = section.nodes.filter(node => group.nodes.includes(node.id));
        const first = [...members].sort((a, b) => a.row - b.row || a.column - b.column)[0];
        nodes.push({...group, row: first.row, column: first.column, kind: 'action', collapsed: true,
            summary: group.summary + ` · Свернуто: ${members.length} узлов, условий: ${members.filter(node => node.kind === 'condition').length}, выходов: ${members.filter(node => node.kind === 'exit').length}.`});
    }
    const edges = [], seen = new Set();
    for (const edge of section.edges) {
        const from = owner.get(edge.from) || edge.from, to = owner.get(edge.to) || edge.to;
        if (from === to && owner.has(edge.from)) continue;
        const key = JSON.stringify([from, to, edge.label]);
        if (!seen.has(key)) { edges.push({...edge, from, to}); seen.add(key); }
    }
    return {...section, nodes, edges, entry: owner.get(section.entry) || section.entry};
}
function overviewSources(data, node) {
    if (node.target.section) {
        const section = data.sections.find(item => item.id === node.target.section);
        return [{file: section.file, ...(section.range ? {range: section.range} : {})}];
    }
    const entry = data.entries.find(item => item.path === node.target.path);
    return data.entries.filter(item => item.kind === 'file' && (item.path === entry.path
        || entry.kind === 'directory' && (entry.path === '.' || item.path.startsWith(entry.path + '/'))))
        .map(item => ({file: item.path}));
}

module.exports = {canonical, digest, validateAnalysis, parseAnalysis, locate, resolveSection, contains, projectGraph, overviewSources};
