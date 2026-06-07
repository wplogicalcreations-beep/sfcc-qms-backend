const { getDb } = require('../db/schema');
const { buildTransmittalVisualTemplate } = require('../templates/controlledTransmittalTemplate');

function escapeHtml(v=''){return String(v).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function stripScripts(input=''){return String(input).replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi,'');}

function resolvePlaceholders(template, context) {
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = key.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), context);
    if (key === 'form.transmitted_docs') return value || '';
    return value === undefined || value === null || value === '' ? '—' : escapeHtml(value);
  });
}

function normalizeDocumentType(rawType = '') {
  const value = String(rawType || '').trim().toUpperCase();
  const byLabel = {
    'MATERIAL SUBMITTAL': 'MS',
    MS: 'MS',
    'DRAWING SUBMITTAL': 'DS',
    DS: 'DS',
    TRANSMITTAL: 'TR',
    TR: 'TR',
    'REQUEST FOR INFORMATION': 'RFI',
    RFI: 'RFI',
    'INSPECTION REQUEST': 'IR',
    IR: 'IR',
    'NON-CONFORMANCE REPORT': 'NCR',
    NCR: 'NCR',
    'SITE INSTRUCTION': 'SI',
    SI: 'SI',
    'VARIATION ORDER': 'VO',
    VO: 'VO',
  };
  return byLabel[value] || value;
}

function getDocumentTypeAliases(rawType = '') {
  const normalized = normalizeDocumentType(rawType);
  const labels = {
    MS: 'Material Submittal',
    DS: 'Drawing Submittal',
    TR: 'Transmittal',
    RFI: 'Request for Information',
    IR: 'Inspection Request',
    NCR: 'Non-Conformance Report',
    SI: 'Site Instruction',
    VO: 'Variation Order',
  };
  const aliases = [normalized];
  if (labels[normalized]) aliases.push(labels[normalized]);
  return Array.from(new Set(aliases));
}

function getActiveApprovedTemplate(documentType) {
  const db = getDb();
  const aliases = getDocumentTypeAliases(documentType);
  const placeholders = aliases.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM qms_form_templates WHERE document_type IN (${placeholders}) AND status='Approved' AND is_active=1 ORDER BY datetime(updated_at) DESC, id DESC LIMIT 1`).get(...aliases);
}

function parseJsonSafely(raw, fallback = {}) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function renderTemplateRecord(templateRecord, context) {
  const placeholders = parseJsonSafely(templateRecord.placeholders_json, {});
  const isVisualTransmittal = templateRecord.document_type === 'Transmittal' && placeholders.layout_version === 'TR_VISUAL_V1';

  if (isVisualTransmittal) {
    const visual = buildTransmittalVisualTemplate(context, placeholders);
    return `<!doctype html><html><head><meta charset="utf-8" /><style>${visual.css}</style></head><body>${visual.html}</body></html>`;
  }

  const html = stripScripts(resolvePlaceholders(templateRecord.html_template, context));
  const css = stripScripts(templateRecord.css_template || '');
  return `<!doctype html><html><head><meta charset="utf-8" /><style>${css}</style></head><body>${html}</body></html>`;
}

module.exports = { resolvePlaceholders, getActiveApprovedTemplate, renderTemplateRecord, normalizeDocumentType, getDocumentTypeAliases };
