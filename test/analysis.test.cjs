'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {parseAnalysis, validateAnalysis, resolveSection, canonical, digest, contains, locate, projectGraph, overviewSources} = require('../analysis.cjs');
const json = readFileSync(join(__dirname, '../examples/analysis-contract/analysis.json'));
const source = readFileSync(join(__dirname, '../examples/analysis-contract/algorithm.cjs'), 'utf8');
const fresh = () => JSON.parse(json);

test('Реальный валидатор принимает подготовленный по контракту пример и связывает каждый узел', () => {
    const data = parseAnalysis(json);
    assert.equal(digest(source), data.entries[0].sha256);
    for (const section of data.sections) {
        const bound = resolveSection(source, section);
        assert.ok(bound.binding);
        for (const node of bound.nodes) assert.ok(node.binding, node.bindingError);
        assert.deepEqual(resolveSection('\uFEFF' + source.replaceAll('\n', '\r\n'), section).nodes.map(node => node.binding.start.line), bound.nodes.map(node => node.binding.start.line));
    }
    assert.equal(canonical('\uFEFFa\r\nb\rc\n'), 'a\nb\nc\n');
    assert.throws(() => parseAnalysis(Buffer.from([0xff])), /encoded|encoding/i);
});

test('Граница JSON: неверные поля, ссылки, пути и структура графа не принимаются', () => {
    const mutations = [
        data => { data.version = 2; },
        data => { data.script = 'execute'; },
        data => { data.title = ' '; },
        data => { data.overview.nodes = []; },
        data => { data.overview.nodes[0].target.path = 'algorithm.cjs'; },
        data => { data.overview.edges[0].label = ''; },
        data => { data.sections[1].id = data.sections[0].id; },
        data => { data.sections[0].nodes[1].id = data.sections[0].nodes[0].id; },
        data => { data.sections[0].nodes[1].row = data.sections[0].nodes[0].row; data.sections[0].nodes[1].column = data.sections[0].nodes[0].column; },
        data => { data.sections[0].nodes[0].row = -1; },
        data => { data.sections[0].nodes[0].callee = null; },
        data => { data.sections[0].nodes[7].callee.section = 'missing'; },
        data => { data.sections[0].range.start = ''; },
        data => { data.sections[0].range.end = '\r\n}'; },
        data => { data.sections[0].entry = 'missing'; },
        data => { data.sections[0].edges[0].to = 'missing'; },
        data => { data.sections[0].edges[0].label = ' '; },
        data => { data.sections[0].edges.push(data.sections[0].edges[0]); },
        data => { data.sections[0].edges.push({from: 'zero', to: 'more'}); },
        data => { data.sections[0].groups[0].nodes.push('more', 'more'); },
        data => { data.properties[0].node = 'missing'; },
        data => { data.entries[0].sha256 = 'wrong'; },
        data => { data.sections[0].file = '../secret'; }
    ];
    for (const change of mutations) { const data = fresh(); change(data); assert.throws(() => validateAnalysis(data)); }
    for (const path of ['../secret', '/secret', 'a/../../secret', 'a//b', 'a/./b', 'a\\b', 'file:secret', 'a\0b', 'a/']) {
        const data = fresh(); data.entries[0].path = path;
        assert.throws(() => validateAnalysis(data), /путь/);
    }
});

test('Список независимых операций не имеет рёбер; пустые свойства допустимы, лимит 20 только у обзора', () => {
    const data = fresh();
    const list = {id: 'operations', title: 'Операции', summary: 'Независимы', file: 'algorithm.cjs', scope: 'file', layout: 'list',
        nodes: [{id: 'helper', title: 'Предикат', summary: 'Проверить знак', range: {start: 'value => value > 0', end: 'value => value > 0'}}]};
    data.sections.push(list);
    data.properties[0].text = ' ';
    validateAnalysis(data);
    assert.ok(resolveSection(source, list).nodes[0].binding);
    list.edges = [];
    assert.throws(() => validateAnalysis(data), /неизвестное поле/);
    delete list.edges;
    const graph = data.sections[1];
    graph.nodes = Array.from({length: 21}, (_, row) => ({...graph.nodes[0], id: 'node' + row, row}));
    graph.entry = 'node0';
    validateAnalysis(data);
    data.overview.nodes = Array.from({length: 21}, (_, row) => ({...data.overview.nodes[0], id: 'overview' + row, row}));
    assert.throws(() => validateAnalysis(data), /20/);
});

test('Якоря и обратный выбор: UTF-16, BOM, локальные ошибки и неоднозначные диапазоны', () => {
    const range = {start: '😀x', end: '😀x'};
    const section = {range, nodes: [{id: 'one', range}, {id: 'bad', range: {start: 'absent', end: 'absent'}}]};
    const bound = resolveSection('\uFEFF😀x\r\nnext', section);
    assert.deepEqual(bound.nodes[0].binding, {start: {line: 0, character: 1}, end: {line: 0, character: 4}});
    assert.ok(bound.nodes[1].bindingError);
    assert.equal(contains(bound.nodes[0].binding, {start: {line: 0, character: 1}, end: {line: 0, character: 4}}), true);
    assert.equal(contains(bound.nodes[0].binding, {start: {line: 0, character: 4}, end: {line: 0, character: 4}}), false);
    assert.throws(() => locate('aaa', {start: 'aa', end: 'aa'}), /однозначный/);
    assert.throws(() => locate('end start', {start: 'start', end: 'end'}), /порядок/);
    assert.ok(resolveSection('😀x 😀x', section).bindingError);
});

test('Смысловые блоки: совместимость, уникальные id и точные диапазоны', () => {
    const data = fresh(), section = data.sections[0];
    const bound = resolveSection(source, section);
    for (const group of bound.groups) {
        assert.ok(group.binding, group.bindingError);
        for (const id of group.nodes) assert.ok(contains(group.binding, bound.nodes.find(node => node.id === id).binding));
    }
    const broken = structuredClone(section);
    broken.groups[0].range = broken.nodes[0].range;
    const invalid = resolveSection(source, broken);
    assert.equal(invalid.groups[0].binding, undefined);
    assert.match(invalid.groups[0].bindingError, /не содержит/);
    assert.ok(invalid.nodes.every(node => node.binding));
    for (const change of [
        value => { delete value.groups[0].range; },
        value => { delete value.groups[0].id; },
        value => { value.groups[0].id = value.nodes[0].id; },
        value => { value.groups[1].id = value.groups[0].id; }
    ]) {
        const next = fresh(); change(next.sections[0]); assert.throws(() => validateAnalysis(next));
    }
    data.properties[0].node = section.groups[0].id;
    validateAnalysis(data);
    section.groups = section.groups.map(({title, nodes}) => ({title, nodes}));
    delete data.properties[0].node;
    validateAnalysis(data);
    assert.equal(projectGraph(section).nodes.length, section.nodes.length, 'old label-only groups remain expanded');
});

test('Сворачивание — проекция исходных рёбер; полный граф восстанавливается без потерь', () => {
    const section = resolveSection(source, fresh().sections[0]);
    const original = structuredClone(section);
    const collapsed = projectGraph(section);
    assert.equal(collapsed.nodes.length, 4);
    assert.equal(collapsed.entry, 'validation');
    assert.equal(collapsed.nodes.find(node => node.id === 'iteration').collapsed, true);
    assert.match(collapsed.nodes.find(node => node.id === 'iteration').summary, /условий: 4, выходов: 1/);
    assert.deepEqual(collapsed.edges, [
        {from: 'validation', to: 'initialization', label: 'Нет'},
        {from: 'initialization', to: 'iteration'},
        {from: 'iteration', to: 'exhausted', label: 'Нет'}
    ]);
    const detailed = projectGraph(section, new Set(section.groups.map(group => group.id)));
    assert.deepEqual(detailed.nodes, section.nodes);
    assert.deepEqual(detailed.edges, section.edges);
    assert.equal(detailed.entry, section.entry);
    const mixed = projectGraph(section, new Set(['iteration']));
    assert.ok(mixed.nodes.some(node => node.id === 'read'));
    assert.ok(mixed.edges.some(edge => edge.from === 'increment' && edge.to === 'more'));
    assert.deepEqual(section, original, 'projection never mutates the source graph');
    const self = {nodes: [{id: 'one', kind: 'condition', row: 0, column: 0}], edges: [{from: 'one', to: 'one', label: 'again'}], entry: 'one'};
    assert.deepEqual(projectGraph(self).edges, self.edges, 'a real ungrouped self-loop is preserved');
});

test('Код крупных узлов берётся из раздела, файла или описанных файлов каталога', () => {
    const data = fresh();
    assert.deepEqual(overviewSources(data, data.overview.nodes[0]), [{file: 'algorithm.cjs', range: data.sections[0].range}]);
    assert.deepEqual(overviewSources(data, {target: {path: 'algorithm.cjs'}}), [{file: 'algorithm.cjs'}]);
    data.entries.push({path: '.', kind: 'directory'}, {path: 'src', kind: 'directory'}, {path: 'src/a.cjs', kind: 'file'}, {path: 'src-other/b.cjs', kind: 'file'});
    assert.deepEqual(overviewSources(data, {target: {path: 'src'}}), [{file: 'src/a.cjs'}]);
    assert.equal(overviewSources(data, {target: {path: '.'}}).length, 3);
});
