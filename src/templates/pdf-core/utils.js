function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeValue(value, fallback = '—') {
  const t = String(value ?? '').trim();
  return t || fallback;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function safeDate(value, fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? safeValue(value, fallback) : date.toISOString().slice(0, 10);
}

function valueOrBlank(value) { return String(value ?? '').trim(); }

module.exports = { escapeHtml, safeValue, safeArray, normalizeText, safeDate, valueOrBlank };
