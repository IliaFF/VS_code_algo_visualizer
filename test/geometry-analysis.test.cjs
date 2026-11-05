'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync, readdirSync} = require('node:fs');
const {join} = require('node:path');
const {parseAnalysis, canonical, digest, locate, resolveSection, projectGraph} = require('../analysis.cjs');

const root = join(__dirname, '../examples/geometry');
const data = parseAnalysis(readFileSync(join(root, 'analysis.json')));
const text = file => readFileSync(join(root, file), 'utf8');
const graph = id => data.sections.find(section => section.id === id);
const edge = (section, from, to, label) => assert.ok(section.edges.some(item =>
    item.from === from && item.to === to && item.label === label), `${section.id}: ${from} -> ${to} (${label})`);

// These checks cover authored data, not C++ execution or live VS Code.
test('Geometry JSON: every snapshot file, canonical hash and real text binding', () => {
    const files = ['README.md'];
    for (const dir of ['include', 'src']) {
        files.push(...readdirSync(join(root, 'raytracing/geometry', dir)).map(name => `raytracing/geometry/${dir}/${name}`));
    }
    assert.deepEqual(data.entries.filter(entry => entry.kind === 'file').map(entry => entry.path).sort(), files.sort());
    for (const entry of data.entries.filter(entry => entry.kind === 'file')) {
        assert.equal(entry.sha256, digest(text(entry.path)), entry.path);
    }
    for (const section of data.sections) {
        const raw = text(section.file);
        for (const variant of [raw, '\uFEFF' + canonical(raw).replaceAll('\n', '\r\n'), '// inserted\n' + raw]) {
            const resolved = resolveSection(variant, section);
            assert.ok(resolved.binding, section.id);
            assert.equal(resolved.bindingError, undefined, section.id);
            for (const node of [...resolved.nodes, ...(resolved.groups || [])]) {
                assert.ok(node.binding, `${section.id}.${node.id}`);
                assert.equal(node.bindingError, undefined, `${section.id}.${node.id}`);
                if (node.callee) {
                    assert.ok(locate(canonical(text(node.callee.file)), node.callee.range));
                    assert.equal(graph(node.callee.section).file, node.callee.file);
                }
            }
        }
        if (section.layout === 'graph') {
            const expanded = projectGraph(section, new Set((section.groups || []).map(group => group.id)));
            assert.deepEqual(expanded.nodes, section.nodes);
            assert.deepEqual(expanded.edges, section.edges);
            assert.equal(expanded.entry, section.entry);
        }
    }
});

test('Geometry JSON: all 54 definitions covered once; each API list links to its function graphs', () => {
    const graphs = data.sections.filter(section => section.layout === 'graph');
    assert.equal(graphs.length, 54);
    const expectedCounts = {geometry: 5, vector: 20, matrix: 15, ray: 3, sphere: 3, triangle: 4, intersection: 4};
    for (const [module, count] of Object.entries(expectedCounts)) {
        const file = `raytracing/geometry/src/${module}.cpp`;
        const functions = graphs.filter(section => section.file === file);
        assert.equal(functions.length, count, module);
        const raw = canonical(text(file));
        const ranges = functions.map(section => locate(raw, section.range));
        const lines = raw.split('\n');
        for (let index = 0, offset = 0; index < lines.length; index++) {
            const line = lines[index];
            if (line.trim() && !line.startsWith('#include')) {
                assert.equal(ranges.filter(range => range.start <= offset && range.end >= offset + line.length).length, 1,
                    `${file}:${index + 1} must belong to exactly one full function`);
            }
            offset += line.length + 1;
        }
        const api = graph(module + '-api');
        assert.equal(api.layout, 'list');
        assert.deepEqual(api.nodes.map(node => node.callee.section).sort(), functions.map(section => section.id).sort());
        assert.equal(graph(module + '-declarations').layout, 'list');
    }
});

test('Geometry JSON: explicit rejection paths, short-circuit OR and oriented normals', () => {
    const sphere = graph('sphere-intersection');
    for (const [from, to, label] of [
        ['miss', 'no-roots', 'Да'], ['miss', 'near', 'Нет'],
        ['near-small', 'far', 'Да'], ['near-small', 'far-small', 'Нет'],
        ['far', 'far-small', undefined], ['far-small', 'no-forward', 'Да'], ['far-small', 'position', 'Нет'],
        ['facing', 'flip', 'Да'], ['facing', 'hit', 'Нет'], ['flip', 'hit', undefined]
    ]) edge(sphere, from, to, label);
    const triangle = graph('triangle-intersection');
    for (const [from, to, label] of [
        ['parallel', 'no-plane', 'Да'], ['parallel', 'first', 'Нет'],
        ['first-low', 'no-first', 'Да'], ['first-low', 'first-high', 'Нет'],
        ['first-high', 'no-first', 'Да'], ['first-high', 'second', 'Нет'],
        ['second-low', 'no-second', 'Да'], ['second-low', 'sum-high', 'Нет'],
        ['sum-high', 'no-second', 'Да'], ['sum-high', 'distance', 'Нет'],
        ['behind', 'no-forward', 'Да'], ['behind', 'normal', 'Нет'],
        ['facing', 'flip', 'Да'], ['facing', 'hit', 'Нет'], ['flip', 'hit', undefined]
    ]) edge(triangle, from, to, label);
    edge(graph('refract'), 'internal', 'none', 'Да');
    edge(graph('refract'), 'internal', 'direction', 'Нет');
    for (const section of [sphere, triangle, graph('refract')]) {
        for (const node of section.nodes.filter(node => node.title.startsWith('Нет') || node.id.startsWith('no-'))) {
            if (node.kind === 'exit') assert.match(node.summary, /optional|пересечени|nullopt|попадани/i);
        }
    }
});

test('Geometry JSON: every explicit index increment lies on its loop back edge', () => {
    for (const id of ['vector-sub-assign', 'vector-add-assign', 'vector-scalar-add', 'matrix-add-assign', 'matrix-sub-assign', 'identity']) {
        const section = graph(id);
        edge(section, 'test', 'body', 'Да');
        edge(section, 'test', 'done', 'Нет');
        edge(section, 'body', 'step', undefined);
        edge(section, 'step', 'test', undefined);
        assert.match(section.nodes.find(node => node.id === 'step').range.start, /\+\+i/);
    }
    for (const [id, variables] of [['matrix-data', ['i', 'j']], ['transpose', ['i', 'j']], ['matrix-product', ['i', 'j', 'k']]]) {
        const section = graph(id);
        for (let index = 0; index < variables.length; index++) {
            const v = variables[index];
            edge(section, v + '-init', v + '-test', undefined);
            edge(section, v + '-step', v + '-test', undefined);
            edge(section, v + '-test', index ? variables[index - 1] + '-step' : id === 'matrix-data' ? 'done' : 'value', 'Нет');
            edge(section, v + '-test', index + 1 < variables.length ? variables[index + 1] + '-init' : id === 'matrix-data' ? 'copy' : 'body', 'Да');
        }
        edge(section, id === 'matrix-data' ? 'copy' : 'body', variables.at(-1) + '-step', undefined);
    }
    edge(graph('matrix-data'), 'empty', 'zero', 'Да');
    edge(graph('matrix-data'), 'empty', 'width', 'Нет');
    edge(graph('normalize'), 'positive', 'done', 'Нет');
    edge(graph('normalize'), 'positive', 'next', 'Да');
    edge(graph('normalize'), 'divide', 'next', undefined);
    edge(graph('scale'), 'multiply', 'next', undefined);
});

test('Geometry JSON: reachable paths, explicit exits and disclosed contextual anchors', () => {
    for (const section of data.sections.filter(section => section.layout === 'graph')) {
        const reachable = new Set([section.entry]);
        for (let pass = 0; pass < section.nodes.length; pass++) {
            for (const {from, to} of section.edges) if (reachable.has(from)) reachable.add(to);
        }
        assert.equal(reachable.size, section.nodes.length, section.id);
        const finishing = new Set(section.nodes.filter(node => node.kind === 'exit').map(node => node.id));
        for (let pass = 0; pass < section.nodes.length; pass++) {
            for (const {from, to} of section.edges) if (finishing.has(to)) finishing.add(from);
        }
        assert.equal(finishing.size, section.nodes.length, section.id);
        for (const node of section.nodes.filter(node => node.kind === 'condition')) {
            assert.deepEqual(section.edges.filter(edge => edge.from === node.id).map(edge => edge.label).sort(), ['Да', 'Нет']);
            assert.doesNotMatch(node.range.start, /\|\||&&/, `${section.id}.${node.id}`);
        }
    }
    const sphere = graph('sphere-intersection');
    assert.match(sphere.nodes.find(node => node.id === 'no-forward').detail, /контекст/);
    assert.match(data.summary, /неоднозначен/);
    assert.ok(data.properties.some(property => property.section === 'matrix-product' && property.node === 'k-test'));
    assert.ok(data.properties.some(property => property.section === 'barycentric' && /ненулевым/.test(property.text)));
});
