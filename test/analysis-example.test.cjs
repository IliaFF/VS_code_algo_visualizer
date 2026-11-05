'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {createHash} = require('node:crypto');
const {isPositive, sumPositiveUntil} = require('../examples/analysis-contract/algorithm.cjs');

const directory = join(__dirname, '../examples/analysis-contract');
const analysis = JSON.parse(readFileSync(join(directory, 'analysis.json'), 'utf8'));
const source = readFileSync(join(directory, 'algorithm.cjs'), 'utf8');
const canonical = text => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const hash = text => createHash('sha256').update(canonical(text), 'utf8').digest('hex');

// Fixture self-check only: this is not the future document loader or its validator.
function rangeIn(text, range) {
    const unique = anchor => {
        assert.ok(anchor.length > 0);
        const start = text.indexOf(anchor);
        assert.ok(start >= 0, 'Missing anchor: ' + anchor);
        assert.equal(text.indexOf(anchor, start + 1), -1, 'Ambiguous anchor: ' + anchor);
        return start;
    };
    const start = unique(range.start);
    const endStart = unique(range.end);
    const end = endStart + range.end.length;
    assert.ok(endStart >= start && end >= start + range.start.length);
    return text.slice(start, end);
}

function uniqueIds(items) {
    const ids = new Set(items.map(item => item.id));
    assert.equal(ids.size, items.length);
    for (const id of ids) assert.match(id, /^[A-Za-z][A-Za-z0-9_-]*$/);
    return ids;
}

test('Пример алгоритма: ранние выходы, обход, отбор, отсутствие изменения входа', () => {
    for (const [values, limit, expected] of [
        [[2, 3], 0, 0], [[2, 3], -1, 0], [[], 10, 0],
        [[NaN, Infinity, -Infinity, -2, 0], 10, 0],
        [[NaN, -2, 0, 2, Infinity, 3, 10], 5, 5],
        [[1, 2], 10, 3], [[8, 2], 5, 8],
        [[Number.MAX_VALUE * 0.75, Number.MAX_VALUE * 0.75], Number.MAX_VALUE, Infinity]
    ]) {
        const before = [...values];
        assert.equal(sumPositiveUntil(values, limit), expected);
        assert.deepEqual(values, before);
    }
    assert.equal(isPositive(1), true);
    assert.equal(isPositive(0), false);
    assert.equal(isPositive(-1), false);
    assert.equal(isPositive(NaN), false);
    assert.equal(isPositive(Infinity), true);
});

test('JSON-пример: хеш, точные диапазоны, ссылки, раскладка и свойства', () => {
    assert.equal(analysis.version, 1);
    assert.equal(analysis.entries.length, 1);
    const file = analysis.entries[0];
    assert.equal(file.path, 'algorithm.cjs');
    assert.equal(file.kind, 'file');
    assert.equal(file.sha256, hash(source));
    assert.equal(hash('\uFEFF' + source.replaceAll('\n', '\r\n')), file.sha256);
    assert.equal(hash(source.replaceAll('\n', '\r')), file.sha256);
    assert.notEqual(hash(source + '\n'), file.sha256);
    const sections = uniqueIds(analysis.sections);
    const overviewNodes = uniqueIds(analysis.overview.nodes);
    assert.ok(overviewNodes.size <= 20);
    for (const node of analysis.overview.nodes) assert.ok(sections.has(node.target.section));
    for (const edge of analysis.overview.edges) {
        assert.ok(overviewNodes.has(edge.from) && overviewNodes.has(edge.to));
        assert.ok(edge.label.trim());
    }
    for (const section of analysis.sections) {
        assert.equal(section.file, file.path);
        assert.equal(section.scope, 'function');
        assert.equal(section.layout, 'graph');
        const body = rangeIn(canonical(source), section.range);
        assert.equal(rangeIn(canonical(source.replaceAll('\n', '\r\n')), section.range), body);
        assert.equal(rangeIn('// inserted\n' + canonical(source), section.range), body);
        const nodes = uniqueIds(section.nodes);
        assert.ok(nodes.has(section.entry));
        const positions = new Set();
        for (const node of section.nodes) {
            assert.ok(node.title.trim() && node.summary.trim());
            assert.ok(['action', 'condition', 'exit'].includes(node.kind));
            assert.ok(Number.isInteger(node.row) && node.row >= 0);
            assert.ok(Number.isInteger(node.column) && node.column >= 0);
            positions.add(node.row + ':' + node.column);
            rangeIn(body, node.range);
            if (node.callee) {
                assert.equal(node.callee.file, file.path);
                assert.ok(sections.has(node.callee.section));
                const target = analysis.sections.find(item => item.id === node.callee.section);
                assert.equal(rangeIn(canonical(source), node.callee.range), rangeIn(canonical(source), target.range));
            }
        }
        assert.equal(positions.size, nodes.size);
        for (const edge of section.edges) assert.ok(nodes.has(edge.from) && nodes.has(edge.to));
        assert.equal(new Set(section.edges.map(edge => JSON.stringify(edge))).size, section.edges.length);
        const grouped = (section.groups || []).flatMap(group => group.nodes);
        assert.equal(new Set(grouped).size, grouped.length);
        for (const id of grouped) assert.ok(nodes.has(id));
    }
    for (const property of analysis.properties) {
        const section = analysis.sections.find(item => item.id === property.section);
        assert.ok(section);
        assert.ok(property.subject.trim() && property.text.trim());
        assert.ok(['precondition', 'postcondition', 'invariant', 'data-contract'].includes(property.kind));
        if (property.node) assert.ok(section.nodes.some(node => node.id === property.node));
    }
    assert.ok(analysis.properties.some(property => property.kind === 'invariant'));
    assert.ok(analysis.properties.some(property => property.kind === 'data-contract'));
    assert.ok(!analysis.properties.some(property => property.section === 'is-positive'));
});

test('Граф примера: все явные переходы, короткое замыкание и continue через приращение', () => {
    const graph = analysis.sections.find(section => section.id === 'sum-positive');
    const actual = {};
    for (const node of graph.nodes) {
        const edges = graph.edges.filter(edge => edge.from === node.id);
        actual[node.id] = edges.map(edge => edge.to).sort();
        if (node.kind === 'condition') assert.deepEqual(edges.map(edge => edge.label).sort(), ['Да', 'Нет']);
        if (node.kind === 'exit') assert.equal(edges.length, 0);
    }
    assert.deepEqual(actual, {
        'check-limit': ['init-total', 'zero'],
        zero: [],
        'init-total': ['init-index'],
        'init-index': ['more'],
        more: ['exhausted', 'read'],
        read: ['nonfinite'],
        nonfinite: ['nonpositive', 'skip'],
        nonpositive: ['add', 'skip'],
        skip: ['increment'],
        add: ['reached'],
        reached: ['increment', 'return-prefix'],
        'return-prefix': [],
        increment: ['more'],
        exhausted: []
    });
    const yes = id => graph.edges.find(edge => edge.from === id && edge.label === 'Да').to;
    const no = id => graph.edges.find(edge => edge.from === id && edge.label === 'Нет').to;
    assert.equal(yes('check-limit'), 'zero');
    assert.equal(yes('more'), 'read');
    assert.equal(yes('nonfinite'), 'skip');
    assert.equal(no('nonfinite'), 'nonpositive');
    assert.equal(yes('nonpositive'), 'skip');
    assert.equal(yes('reached'), 'return-prefix');
    const helper = analysis.sections.find(section => section.id === 'is-positive');
    assert.equal(helper.nodes.length, 1);
    assert.equal(helper.nodes[0].kind, 'exit');
    assert.deepEqual(helper.edges, []);
});

test('Самопроверка якорей примера не принимает отсутствующее или неоднозначное соответствие', () => {
    const section = analysis.sections[0];
    assert.throws(() => rangeIn(source + source, section.range), /Ambiguous anchor/);
    assert.throws(() => rangeIn(source.replace('function sumPositiveUntil', 'function renamed'), section.range), /Missing anchor/);
    assert.throws(() => rangeIn('aaa', {start: 'aa', end: 'aa'}), /Ambiguous anchor/);
});
