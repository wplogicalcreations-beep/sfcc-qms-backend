const { escapeHtml } = require('./utils');

function renderWritingLines(text = '', lineCount = 4, minHeightMm = 6, padding = '2px 1px') {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean).slice(0, lineCount);
  const style = `min-height:${minHeightMm}mm;border-bottom:1px solid #777;padding:${padding};`;
  return lines.map((line) => `<div style="${style}">${escapeHtml(line)}</div>`).join('')
    + Array.from({ length: Math.max(0, lineCount - lines.length) }).map(() => `<div style="min-height:${minHeightMm}mm;border-bottom:1px solid #777;"></div>`).join('');
}

module.exports = { renderWritingLines };
