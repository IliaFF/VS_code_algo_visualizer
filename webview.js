'use strict';

const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const statusLabels = {unchecked: 'Не проверено', proved: 'Доказано', refuted: 'Опровергнуто', unknown: 'Неизвестно', stale: 'Устарело'};
let state;
let activeIndex = null;

function send(type, index) {
    if (state) vscode.postMessage({type, index, selected: state.selected, version: state.version});
}

function updateSelection(scroll = false) {
    for (const node of document.querySelectorAll('[data-step]')) {
        const selected = Number(node.dataset.step) === activeIndex;
        node.classList.toggle('is-selected', selected);
        if (selected) node.setAttribute('aria-current', 'true');
        else node.removeAttribute('aria-current');
    }
    const step = state?.view.steps[activeIndex];
    byId('selection-detail').textContent = step
        ? step.title + ' · строки ' + step.start + '–' + step.end + '. ' + step.note
        : 'Нет однозначно выбранного блока. Выберите блок или участок кода внутри его диапазона.';
    if (scroll && document.activeElement?.tagName !== 'SELECT') {
        document.querySelector('[data-step].is-selected')?.scrollIntoView({block: 'nearest'});
    }
}

function nodeButton(index) {
    const step = state.view.steps[index];
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.step = index;
    button.className = 'node' + (step.branch ? ' decision' : '');
    button.textContent = step.title;
    const note = document.createElement('small');
    note.textContent = step.note;
    button.append(note);
    const highlight = () => {
        activeIndex = index;
        updateSelection();
        byId('status').textContent = 'Строки ' + step.start + '–' + step.end;
        send('hover', index);
    };
    button.addEventListener('mouseenter', highlight);
    button.addEventListener('focus', highlight);
    button.addEventListener('click', () => { highlight(); send('reveal', index); });
    button.addEventListener('mouseleave', () => { if (document.activeElement !== button) send('clear'); });
    button.addEventListener('blur', () => send('clear'));
    return button;
}

function flowView() {
    if (!state.view.signature) {
        const list = document.createElement('ul');
        list.className = 'operation-list';
        state.view.steps.forEach((_, index) => {
            const item = document.createElement('li');
            item.append(nodeButton(index));
            list.append(item);
        });
        byId('flow').append(list);
        return;
    }
    state.view.steps.forEach((step, index) => {
        byId('flow').append(nodeButton(index));
        if (step.branch) {
            const exit = document.createElement('div');
            exit.className = 'exit';
            exit.textContent = step.branch;
            byId('flow').append(exit);
        }
        if (state.view.signature && index + 1 < state.view.steps.length) {
            const edge = document.createElement('div');
            edge.className = 'edge';
            edge.textContent = step.branch ? 'Нет ↓' : '↓';
            byId('flow').append(edge);
        }
    });
}

function renderProperties() {
    if (!state) return;
    const status = state.edited || state.error ? 'stale' : byId('demo-status').value;
    byId('demo-status').disabled = Boolean(state.edited || state.error);
    byId('freshness').textContent = state.error
        ? 'Привязка к коду недоступна: демонстрационные результаты нельзя считать актуальными.'
        : state.edited
            ? 'Код изменялся или содержит несохранённые правки: деморезультаты устарели, описания требуют ревью. Пересчёт строк не подтверждает смысл описаний.'
            : 'Только демонстрация оформления. Отчёт верификатора отсутствует, версия проверенного кода не задана.';
    byId('properties').replaceChildren();
    for (const [key, title] of [['pre', 'Предусловия'], ['post', 'Постусловия'], ['invariant', 'Инварианты']]) {
        if (!state.view[key]?.trim()) continue;
        const article = document.createElement('article');
        article.className = 'property';
        const heading = document.createElement('h3');
        heading.textContent = title;
        const badge = document.createElement('span');
        badge.className = 'badge ' + status;
        badge.textContent = 'ДЕМО · ' + statusLabels[status];
        const text = document.createElement('p');
        text.textContent = state.view[key];
        article.append(heading, badge, text);
        byId('properties').append(article);
    }
}

function render() {
    if (!state) return;
    const prototype = byId('prototype-mode').checked;
    document.body.classList.toggle('prototype', prototype);
    const hasProperties = ['pre', 'post', 'invariant'].some(key => state.view[key]?.trim());
    byId('contracts').hidden = prototype || !hasProperties;
    byId('prototype-notice').hidden = !prototype;
    byId('inspector').hidden = !prototype;
    byId('properties').parentElement.hidden = !hasProperties;
    for (const key of ['pre', 'post', 'invariant']) {
        byId(key).hidden = byId(key).previousElementSibling.hidden = !state.view[key]?.trim();
    }
    byId('flow').replaceChildren();
    byId('flow-title').textContent = state.view.signature ? 'Укрупнённая схема geometry' : 'Независимые операции';
    byId('representation-note').textContent = 'Старый встроенный пример: условия внутри блоков ещё не развёрнуты в полный граф. Для нового формата используйте команду «Анализ агента: Открыть JSON рядом с кодом».';
    if (!state.error) flowView();
    renderProperties();
    updateSelection(state.fromEditor);
}

byId('views').addEventListener('change', event => vscode.postMessage({type: 'select', index: Number(event.target.value)}));
byId('prototype-mode').addEventListener('change', () => { send('clear'); render(); });
byId('demo-status').addEventListener('change', renderProperties);
window.addEventListener('message', event => {
    if (event.data?.type !== 'state') return;
    state = event.data;
    activeIndex = state.activeStep;
    byId('views').replaceChildren(...state.names.map((name, index) => {
        const option = document.createElement('option');
        option.textContent = name;
        option.value = index;
        return option;
    }));
    byId('views').value = String(state.selected);
    for (const key of ['name', 'pre', 'post', 'invariant']) byId(key).textContent = state.view[key];
    byId('file').textContent = 'raytracing/geometry/src/' + state.view.file + '.cpp';
    byId('error').textContent = state.error;
    byId('status').textContent = state.error ? 'Исправьте файл или выберите другой раздел'
        : state.fromEditor ? 'Код → схема: ' + (activeIndex === null ? 'нет однозначного блока для выделения' : 'выбран связанный блок')
        : 'Привязки обновлены по текущему файлу, включая несохранённые изменения';
    render();
});

vscode.postMessage({type: 'ready'});
