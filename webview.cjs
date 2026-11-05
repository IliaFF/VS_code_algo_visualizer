'use strict';

const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {randomBytes} = require('node:crypto');

function webviewHtml(prototypeEnabled = false) {
    const nonce = randomBytes(16).toString('hex');
    const style = readFileSync(join(__dirname, 'webview.css'), 'utf8');
    const script = readFileSync(join(__dirname, 'webview.js'), 'utf8');
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
<title>Geometry — схема</title><style nonce="${nonce}">${style}</style></head>
<body><header><p class="eyebrow">Код · Структура · Свойства</p><h1>Geometry</h1>
<label class="prototype-toggle"${prototypeEnabled ? '' : ' hidden'}><input id="prototype-mode" type="checkbox"> Geometry: демонстрационные статусы свойств</label></header>
<label for="views">Алгоритм или класс</label>
<select id="views"></select><p id="file"></p>
<p class="hint">Блок → код: наведение или Tab подсвечивает строки, клик открывает их. Код → блок: поставьте курсор или выделите строки внутри одного блока. Фокус остаётся в редакторе.</p>
<p id="error" role="alert"></p><p id="status" role="status" aria-live="polite">Открытие файла…</p>
<h2 id="name"></h2><section id="contracts" aria-label="Контракты">
<h3>Предпосылки</h3><p id="pre"></p><h3>Постусловия</h3><p id="post"></p>
<h3>Инварианты</h3><p id="invariant"></p></section>
<div id="prototype-notice" class="notice" hidden><strong>ВИЗУАЛЬНЫЙ ПРОТОТИП · НЕ РЕЗУЛЬТАТ ВЕРИФИКАЦИИ</strong>
<p>Все статусы ниже демонстрационные. Верификаторы и ИИ не запускались. Описания подготовлены вручную для geometry.</p>
<label for="demo-status">Показать демосостояние проверки</label><select id="demo-status">
<option value="unchecked">Не проверено</option><option value="proved">Доказано — ДЕМО</option>
<option value="refuted">Опровергнуто — ДЕМО</option><option value="unknown">Неизвестно — ДЕМО</option><option value="stale">Устарело — ДЕМО</option></select>
<p id="freshness"></p></div>
<main id="workspace"><div><h2 id="flow-title">Блок-схема</h2><p id="representation-note" class="hint"></p><div id="flow"></div></div>
<aside id="inspector" hidden aria-label="Связанный код и свойства"><section><h2>Выбранный участок</h2><p id="selection-detail" role="status" aria-live="polite"></p></section>
<section><h2>Свойства раздела</h2><p class="hint">Область действия — вся функция или класс, не только выбранный блок. Источник: ручное описание geometry.</p><div id="properties"></div></section></aside></main>
<details><summary>Ограничения</summary>
<p>Схемы описывают текущее решение geometry, это не анализатор произвольного C++. Перенос строк и изменение якорей могут потребовать обновления описаний. При отсутствии однозначной привязки подсветка отключается</p>
<p>Контракты написаны вручную. Если изменить смысл C++ и сохранить якоря, пояснения автоматически не обновятся</p>
<p>kEps = 1e-9; t ≥ kEps. Для треугольника тот же допуск используется для det и весов. Почти параллельные лучи и очень маленькие треугольники могут отсекаться, точки чуть вне границы — приниматься</p>
<p>Численные равенства понимаются с погрешностью double. Предполагаются конечные входы без переполнения и существенной потери точности, корректные индексы, размеры матриц и физические параметры. Почти вырожденные фигуры требуют отдельного численного анализа</p>
<p>Геометрия — O(1) времени и памяти. Матрицы m×n — O(mn) памяти, сложение и транспонирование — O(mn) времени, умножение (m×k)(k×n) — O(mkn). Ссылки на элементы Matrix инвалидируются при замене буфера; перемещённой-из Matrix перед вычислениями нужно присвоить новое значение</p>
</details><script nonce="${nonce}">${script}</script></body></html>`;
}

function analysisHtml() {
    const nonce = randomBytes(16).toString('hex');
    const css = readFileSync(join(__dirname, 'webview.css'), 'utf8');
    const script = readFileSync(join(__dirname, 'analysis-webview.js'), 'utf8');
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src 'none'">
<style nonce="${nonce}">${css}</style></head><body class="analysis">
<header><h1 id="analysis-title">Анализ агента</h1><p>Выборочное описание проекта · объяснения агента, не доказательство</p>
<nav aria-label="Навигация"><button id="back" type="button">Назад</button><button id="overview" type="button">Обзор проекта</button><button id="reload" type="button">Перезагрузить анализ</button></nav></header>
<p id="load-error" role="alert"></p><p id="action-error" role="alert"></p><p id="analysis-status" role="status" aria-live="polite"></p>
<div class="analysis-workspace"><section id="analysis-detail" aria-label="Подробности выбранного участка" hidden></section><main id="analysis-content"></main></div>
<script nonce="${nonce}">${script}</script></body></html>`;
}

module.exports = {webviewHtml, analysisHtml};
