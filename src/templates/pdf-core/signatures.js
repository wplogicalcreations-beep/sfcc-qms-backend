const { escapeHtml } = require('./utils');

function renderSignatureBlock(labels = ['SUBMITTED BY / CONTRACTOR', 'REVIEWED BY / CONSULTANT', 'APPROVED BY / CLIENT']) {
  const normalized = Array.isArray(labels) && labels.length ? labels.slice(0, 4) : ['SUBMITTED BY / CONTRACTOR', 'REVIEWED BY / CONSULTANT', 'APPROVED BY / CLIENT'];
  const colCount = Math.min(4, Math.max(2, normalized.length));
  return `<div class="section">SIGNATURES & AUTHORIZATION</div><div class="signature-grid cols-${colCount}">${normalized.map((label) => `<div class="signature-cell"><div class="signature-label">${escapeHtml(label)}</div><div class="signature-fields"><div class="signature-row"><span class="field-label">Name & Title</span><span class="field-line"></span></div><div class="signature-row"><span class="field-label">Signature</span><span class="field-line"></span></div><div class="signature-row"><span class="field-label">Date</span><span class="field-line"></span></div><div class="signature-row"><span class="field-label">Stamp / Seal</span><span class="field-line"></span></div></div></div>`).join('')}</div>`;
}

module.exports = { renderSignatureBlock };
