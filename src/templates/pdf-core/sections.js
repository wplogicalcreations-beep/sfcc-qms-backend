const { escapeHtml, safeValue } = require('./utils');

function renderSectionHeader(title) {
  return `<div class="section">${escapeHtml(safeValue(title, 'SECTION'))}</div>`;
}

function renderKeyValueTable(rows = []) {
  return `<table>${rows.map((r = {}) => `<tr><td class="lbl" style="width:${r.width || '22%'};">${escapeHtml(r.label || '')}</td><td>${escapeHtml(safeValue(r.value))}</td></tr>`).join('')}</table>`;
}

function renderCompactTable(headHtml, bodyHtml) {
  return `<table><tr>${headHtml}</tr>${bodyHtml}</table>`;
}

module.exports = { renderSectionHeader, renderKeyValueTable, renderCompactTable };
