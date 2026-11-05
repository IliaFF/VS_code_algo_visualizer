'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const views = require('../diagrams.cjs');
const {resolveView} = require('../bindings.cjs');

const source = view => readFileSync(join(__dirname, '../examples/geometry/raytracing/geometry/src', view.file + '.cpp'), 'utf8');

test('Все 43 блока соответствуют текущим исходникам', () => {
    let count = 0;
    for (const view of views) {
        const text = source(view);
        const resolved = resolveView(text, view);
        const lines = text.trimEnd().split('\n');
        for (const step of resolved.steps) {
            const snippet = lines.slice(step.start - 1, step.end).join('\n');
            assert.ok(snippet.includes(step.anchor));
            assert.ok(step.start <= step.end);
            assert.ok(step.start >= resolved.start + 1 && step.end <= resolved.end + 1);
            count++;
        }
    }
    assert.equal(count, 43);
});

test('Привязки сдвигаются после вставки строк и поддерживают CRLF', () => {
    const view = views[0];
    const original = resolveView(source(view), view);
    const changed = resolveView(('// inserted\n\n' + source(view)).replaceAll('\n', '\r\n'), view);
    assert.equal(changed.start, original.start + 2);
    assert.deepEqual(changed.steps.map(step => step.start), original.steps.map(step => step.start + 2));
    const internal = resolveView(source(view).replace('    const double root', '\n\n    const double root'), view);
    assert.equal(internal.steps[0].start, original.steps[0].start);
    assert.equal(internal.steps[2].start, original.steps[2].start + 2);
});

test('Отсутствующие, неоднозначные и переставленные якоря отключают привязку', () => {
    const view = views[0];
    const text = source(view);
    assert.throws(() => resolveView(text.replace(view.steps[0].anchor, '    const Vector renamed'), view), /однозначный участок/);
    assert.throws(() => resolveView(text.replace(view.steps[0].anchor, view.steps[0].anchor + '\n' + view.steps[0].anchor), view), /однозначный участок/);
    assert.throws(() => resolveView(text + '\n' + text, view), /однозначная функция/);
    assert.throws(() => resolveView(text, {...view, steps: [view.steps[1], view.steps[0]]}), /порядок/);
    assert.throws(() => resolveView(view.signature + ' {\n', view), /граница/);
});
