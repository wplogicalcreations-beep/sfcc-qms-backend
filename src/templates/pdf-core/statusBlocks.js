const { escapeHtml } = require('./utils');

function renderStatusOptions(options = [], selected = '') {
  const selectedNorm = String(selected || '').toLowerCase();
  return `<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;">${options.map((option = {}) => {
    const active = String(option.label || '').toLowerCase() === selectedNorm;
    return `<div style="border:1px solid ${option.borderColor || '#cbd5e1'};background:${option.backgroundColor || '#f8fafc'};padding:6px;border-radius:4px;"><div style="display:flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;border:1px solid #334155;background:${active ? '#334155' : '#fff'};display:inline-block;flex:0 0 auto;"></span><span style="font-weight:700;font-size:10px;line-height:1.2;">${escapeHtml(option.label || '')}</span></div></div>`;
  }).join('')}</div>`;
}

module.exports = { renderStatusOptions };
