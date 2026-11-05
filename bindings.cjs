'use strict';

function uniqueIndex(text, anchor) {
    const index = text.indexOf(anchor);
    if (index < 0 || index !== text.lastIndexOf(anchor)) {
        throw new Error('Не найден однозначный участок: ' + anchor.trim());
    }
    return index;
}

function resolveView(text, view) {
    const lines = text.replaceAll('\r\n', '\n').trimEnd().split('\n');
    let start = 0;
    let end = lines.length - 1;
    if (view.signature) {
        const matches = lines.flatMap((line, i) => line.startsWith(view.signature) ? [i] : []);
        if (matches.length !== 1) {
            throw new Error('Не найдена однозначная функция: ' + view.signature);
        }
        start = matches[0];
        // shortcut: existing functions end with an unindented }, use a C++ parser if this layout changes.
        end = lines.findIndex((line, i) => i > start && line === '}');
        if (end < start) {
            throw new Error('Не найдена граница функции');
        }
    }
    const snippet = lines.slice(start, end + 1).join('\n');
    const steps = view.steps.map(node => {
        const offset = uniqueIndex(snippet, node.anchor);
        return {...node, start: start + snippet.slice(0, offset).split('\n').length};
    });
    steps.forEach((node, i) => {
        if (i && node.start <= steps[i - 1].start) {
            throw new Error('Изменился порядок блоков');
        }
        node.end = i + 1 < steps.length ? steps[i + 1].start - 1 : end + 1;
    });
    return {...view, start, end, steps};
}

module.exports = {resolveView};
