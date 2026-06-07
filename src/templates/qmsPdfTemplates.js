const { renderLayoutCss } = require('./pdf-core/layout');
const { renderControlledHeader, resolveControlledHeaderParties, normalizeStakeholderRole } = require('./pdf-core/header');
const { renderSignatureBlock } = require('./pdf-core/signatures');
const { renderWritingLines } = require('./pdf-core/writingLines');
const { renderPdfFooter } = require('./pdf-core/footer');
const { renderStatusOptions } = require('./pdf-core/statusBlocks');
const { escapeHtml, safeValue: coreSafeValue, safeDate, valueOrBlank } = require('./pdf-core/utils');

function parseFormData(formData) {
  if (!formData) return {};
  if (typeof formData === 'object') return formData;
  try { return JSON.parse(formData); } catch { return {}; }
}

function formatDate(value) {
  return safeDate(value, valueOrDash(value));
}

function valueOrDash(value) {
  const text = String(value ?? '').trim();
  return text || '—';
}

function attachmentNames(attachments = []) {
  if (!Array.isArray(attachments) || !attachments.length) return '—';
  return attachments.map((a) => a.original_name).filter(Boolean).join(', ') || '—';
}

function padRows(rows = [], minRows, factory) {
  const out = [...rows];
  while (out.length < minRows) out.push(factory());
  return out;
}

function projectInfo(document, project) {
  const formData = parseFormData(document?.form_data);
  return {
    projectName: valueOrDash(project?.name),
    projectNo: valueOrDash(project?.code),
    contractNo: valueOrDash(document?.contract_no || project?.contract_no),
    client: valueOrDash(project?.client),
    contractor: 'Silver Foundation Contracting Company',
    consultant: valueOrDash(project?.consultant),
    location: valueOrDash(project?.location || document?.location || document?.area),
    dateIssued: formatDate(formData?.date || formData?.submittal_date || document?.issue_date || document?.created_at),
    discipline: valueOrDash(document?.discipline),
    pmc: valueOrDash(project?.pmc),
    responseDue: formatDate(document?.due_date),
    area: valueOrDash(document?.area),
  };
}

function row(label, value, w = '22%') { return `<tr><td class="lbl" style="width:${w};">${escapeHtml(label)}</td><td>${escapeHtml(valueOrDash(value))}</td></tr>`; }

function sharedCss(density = 'normal') {
  const base = renderLayoutCss(density);
  return `${base}
  .title{background:#14305c;color:#fff;font-size:12px;font-weight:700;text-align:center;padding:5px;border:1px solid #222;border-top:none;letter-spacing:.2px;}
  .meta-label{font-weight:700;background:#eff4fb;}
  .fill{min-height:24mm;} .fill-lg{min-height:34mm;} .fill-xl{min-height:46mm;}
  .density-normal{--section-margin-top:4px;--row-pad-y:3px;--row-pad-x:4px;--section-pad-y:4px;--section-pad-x:6px;--writing-line-mm:6;--signature-min-h:38mm;--signature-row-min-h:7.5mm;--header-party-min-h:22mm;--copy-margin-top:4px;--footer-font:7.5px;}
  .density-compact{--section-margin-top:3px;--row-pad-y:2px;--row-pad-x:3px;--section-pad-y:3px;--section-pad-x:5px;--writing-line-mm:5.2;--signature-min-h:32mm;--signature-row-min-h:6.3mm;--header-party-min-h:20mm;--copy-margin-top:3px;--footer-font:7px;}
  .density-balanced{--section-margin-top:3.8px;--row-pad-y:2.8px;--row-pad-x:3.8px;--section-pad-y:3.8px;--section-pad-x:5.8px;--writing-line-mm:6.1;--signature-min-h:36mm;--signature-row-min-h:7.3mm;--header-party-min-h:21.5mm;--copy-margin-top:3px;--footer-font:7.3px;}
  .density-compact-readable{--section-margin-top:3.2px;--row-pad-y:2.45px;--row-pad-x:3.5px;--section-pad-y:3.4px;--section-pad-x:5.4px;--writing-line-mm:5.7;--signature-min-h:34mm;--signature-row-min-h:6.9mm;--header-party-min-h:20.8mm;--copy-margin-top:3px;--footer-font:7.2px;}
  .density-certificate-balanced{--section-margin-top:4.2px;--row-pad-y:3.1px;--row-pad-x:4.2px;--section-pad-y:4px;--section-pad-x:6px;--writing-line-mm:6.3;--signature-min-h:40mm;--signature-row-min-h:7.8mm;--header-party-min-h:22mm;--copy-margin-top:3px;--footer-font:7.4px;}
  .density-ultra{--section-margin-top:2px;--row-pad-y:1.6px;--row-pad-x:3px;--section-pad-y:2.2px;--section-pad-x:4px;--writing-line-mm:4.7;--signature-min-h:28mm;--signature-row-min-h:5.5mm;--header-party-min-h:18mm;--copy-margin-top:2px;--footer-font:6.8px;}
  .section{margin-top:var(--section-margin-top);background:#243f69;color:#fff;font-size:9px;font-weight:700;padding:var(--section-pad-y) var(--section-pad-x);border:1px solid #222;border-bottom:none;}
  .qms-a4-page td,.qms-a4-page th{padding:var(--row-pad-y) var(--row-pad-x);}
  .copy{margin-top:var(--copy-margin-top);font-size:var(--footer-font);border-top:1px solid #222;padding-top:2px;text-align:center;}
  .qms-form-body{flex:1;display:flex;flex-direction:column;min-height:0;}
  .qms-form-content{display:flex;flex-direction:column;flex:1;min-height:0;}
  .qms-form-content > .section:first-child{margin-top:2px;}
  .qms-form-content .section-spacer{height:2px;}
  .qms-form-content .ms-items-table tr td{min-height:14px;}
  .qms-form-content .ir-details-table tr td{min-height:15px;}
  .qms-form-content .ms-items-table tr td,.qms-form-content .ms-items-table tr th,.qms-form-content .ir-details-table tr td,.qms-form-content .ir-details-table tr th{font-size:7.2px;}

  .signature-grid{display:grid;gap:4px;margin-top:0;border:1px solid #222;border-top:none;}
  .signature-grid.cols-2{grid-template-columns:repeat(2,minmax(0,1fr));}
  .signature-grid.cols-3{grid-template-columns:repeat(3,minmax(0,1fr));}
  .signature-grid.cols-4{grid-template-columns:repeat(4,minmax(0,1fr));}
  .signature-cell{border-right:1px solid #c7cfde;padding:0;background:#fff;min-height:var(--signature-min-h);}
  .signature-cell:last-child{border-right:none;}
  .signature-label{font-size:8px;font-weight:700;background:#eaf1fb;color:#1c355f;padding:4px 6px;border-bottom:1px solid #c7cfde;letter-spacing:.2px;min-height:8mm;display:flex;align-items:center;}
  .signature-fields{padding:6px 6px 5px;}
  .signature-row{display:flex;align-items:center;gap:4px;min-height:var(--signature-row-min-h);}
  .signature-row .field-label{font-weight:700;color:#20395f;min-width:15mm;font-size:7.6px;}
  .signature-row .field-line{flex:1;border-bottom:1px solid #6f7f99;height:4.8mm;}
  .header-grid{display:grid;width:100%;border:1px solid #222;border-bottom:none;}
  .header-grid.cols-1{grid-template-columns:repeat(1,minmax(0,1fr));}
  .header-grid.cols-2{grid-template-columns:repeat(2,minmax(0,1fr));}
  .header-grid.cols-3{grid-template-columns:repeat(3,minmax(0,1fr));}
  .header-grid.cols-4{grid-template-columns:repeat(4,minmax(0,1fr));}
  .header-party{min-height:var(--header-party-min-h);border-right:1px solid #222;padding:1.6mm;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;text-align:center;}
  .header-party:last-child{border-right:none;}
  .header-party-role{font-size:7px;font-weight:700;color:#1f2f53;margin-bottom:1mm;letter-spacing:.2px;}
  .header-party-logo{height:18mm;display:flex;align-items:center;justify-content:center;width:100%;}
  .header-party-name{font-size:8px;font-weight:700;color:#2c3a55;}
  .sfcc-brand{height:18mm;display:flex;align-items:center;justify-content:center;width:100%;overflow:hidden;}
  .sfcc-brand img,.logo-img{max-width:45mm;max-height:18mm;object-fit:contain;display:block;margin:auto;}
  .logo-only{display:flex;align-items:center;justify-content:center;}
  .header-meta-strip{border:1px solid #222;border-top:none;border-bottom:none;background:#f4f8ec;padding:2px 6px;font-size:7px;color:#1f2f53;text-align:center;min-height:5.5mm;display:flex;align-items:center;justify-content:center;line-height:1.2;}
  .header-meta-strip.empty{background:#fff;min-height:2.4mm;padding:0;}

  .form-layout-transmittal .tr-comments-lines .writing-lines{min-height:22mm;}
  .form-layout-transmittal .tr-response-lines .writing-lines{min-height:22mm;}
  .form-layout-transmittal .tr-signature .signature-cell{min-height:37mm;}
  .form-layout-transmittal .tr-signature .signature-label{min-height:7.8mm;}
  .form-layout-transmittal .tr-docs td{min-height:5.6mm;}

  .form-layout-site-instruction .si-description-lines .writing-lines{min-height:22mm;}
  .form-layout-site-instruction .si-action-lines .writing-lines{min-height:22mm;}
  .form-layout-site-instruction .si-ack-lines .writing-lines{min-height:18mm;}
  .form-layout-site-instruction .si-signature .signature-cell{min-height:35mm;}
  .form-layout-site-instruction .si-signature .signature-label{min-height:7.6mm;}`;
}

function normalizeStakeholderRoleLegacy(role = '') {
  const normalized = String(role || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const clientRoles = new Set(['client_employer', 'client', 'employer']);
  const consultantRoles = new Set(['consultant_engineer', 'consultant', 'engineer']);
  const pmcRoles = new Set(['pmc', 'project_management_consultant', 'project_manager_pmc']);
  const contractorRoles = new Set(['contractor', 'main_contractor', 'sfcc', 'silver_foundation']);

  if (clientRoles.has(normalized)) return 'client';
  if (consultantRoles.has(normalized)) return 'consultant';
  if (pmcRoles.has(normalized)) return 'pmc';
  if (contractorRoles.has(normalized)) return 'contractor';

  if (normalized.includes('client') && normalized.includes('employer')) return 'client';
  if (normalized.includes('consultant') && normalized.includes('engineer')) return 'consultant';
  if (normalized.includes('project_management') && normalized.includes('consultant')) return 'pmc';
  if (normalized.includes('pmc')) return 'pmc';
  if (normalized.includes('contractor') || normalized.includes('silver_foundation') || normalized.includes('sfcc')) return 'contractor';

  return null;
}

function isMissingPartyValue(value) {
  if (value === null || value === undefined) return true;
  const normalized = String(value).trim().toLowerCase();
  return !normalized || new Set(['-', '—', 'na', 'n/a', 'not set', 'none', 'null', 'undefined']).has(normalized);
}

function isActiveStakeholder(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'active'].includes(normalized)) return true;
  if (['0', 'false', 'inactive'].includes(normalized)) return false;
  return false;
}

function resolveControlledHeaderPartiesLegacy(project = {}, projectLogos = {}, projectStakeholders = {}) {
  const stakeholderRows = Array.isArray(projectStakeholders?.rows)
    ? projectStakeholders.rows
    : (Array.isArray(projectStakeholders) ? projectStakeholders : []);
  const activeStakeholders = stakeholderRows.filter((s) => isActiveStakeholder(s?.active));

  const byRole = { client: [], consultant: [], pmc: [], contractor: [] };
  activeStakeholders.forEach((row) => {
    const key = normalizeStakeholderRole(row?.role);
    if (key && byRole[key]) byRole[key].push(row);
  });

  const pickStakeholder = (key) => {
    const rows = [...(byRole[key] || [])].sort((a, b) => {
      const defaultDelta = Number(b?.is_default_for_role || 0) - Number(a?.is_default_for_role || 0);
      if (defaultDelta !== 0) return defaultDelta;
      return String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
    });
    return rows[0] || null;
  };

  const clientStakeholder = pickStakeholder('client');
  const consultantStakeholder = pickStakeholder('consultant');
  const pmcStakeholder = pickStakeholder('pmc');
  const contractorStakeholder = pickStakeholder('contractor');

  const projectClient = !isMissingPartyValue(project?.client) ? String(project.client).trim() : (!isMissingPartyValue(project?.client_name) ? String(project.client_name).trim() : '');
  const projectConsultant = !isMissingPartyValue(project?.consultant) ? String(project.consultant).trim() : '';
  const projectPmc = !isMissingPartyValue(project?.pmc) ? String(project.pmc).trim() : '';
  const projectIdentity = !isMissingPartyValue(project?.name) || !isMissingPartyValue(project?.code) || !!projectClient;

  const hasClientStakeholder = !!clientStakeholder;
  const hasConsultantStakeholder = !!consultantStakeholder;
  const hasPmcStakeholder = !!pmcStakeholder;

  const showClient = hasClientStakeholder || !!projectClient || (!!projectLogos?.client && projectIdentity);
  const showConsultant = hasConsultantStakeholder || !!projectConsultant;
  const showPmc = hasPmcStakeholder || !!projectPmc;

  const parties = [];
  if (showClient) {
    parties.push({
      key: 'client', roleLabel: 'CLIENT / EMPLOYER', external: true,
      companyName: String(clientStakeholder?.company_name || projectClient || 'Client / Employer').trim(),
      logoDataUrl: projectLogos?.client || '',
      source: hasClientStakeholder ? 'active-stakeholder' : (projectClient ? 'project-client' : 'client-logo-with-project-identity'),
    });
  }

  parties.push({
    key: 'sfcc', roleLabel: 'CONTRACTOR', external: false,
    companyName: String(contractorStakeholder?.company_name || project?.main_contractor || 'SILVER FOUNDATION CONTRACTING COMPANY').trim() || 'SILVER FOUNDATION CONTRACTING COMPANY',
    subtitle: 'Engineering & Construction - Quality Management System',
    logoDataUrl: projectLogos?.sfcc || '', source: 'always',
  });

  if (showConsultant) {
    parties.push({
      key: 'consultant', roleLabel: 'CONSULTANT / ENGINEER', external: true,
      companyName: String(consultantStakeholder?.company_name || projectConsultant || 'Consultant / Engineer').trim(),
      logoDataUrl: projectLogos?.consultant || '',
      source: hasConsultantStakeholder ? 'active-stakeholder' : 'project-consultant',
    });
  }

  if (showPmc) {
    parties.push({
      key: 'pmc', roleLabel: 'PMC', external: true,
      companyName: String(pmcStakeholder?.company_name || projectPmc || 'PMC').trim(),
      logoDataUrl: projectLogos?.pmc || '',
      source: hasPmcStakeholder ? 'active-stakeholder' : 'project-pmc',
    });
  }

  return parties;
}

function renderControlledFormHeader({ title, logos = {}, stakeholders = {}, options = {}, project = {} }) {
  return renderControlledHeader({ title, logos, stakeholders, options, project });
}

function renderControlledFormHeaderLegacy({ title, logos = {}, stakeholders = {}, options = {}, project = {} }) {
  const parties = resolveControlledHeaderPartiesLegacy(project, logos, stakeholders);
  const colClass = `cols-${Math.min(4, Math.max(1, parties.length))}`;
  const metadataText = options.metadataText || '';
  const sfccIdentity = ['SILVER FOUNDATION CONTRACTING COMPANY', 'Engineering & Construction - Quality Management System'].join(' | ');
  const metadataLine = [metadataText, sfccIdentity].filter(Boolean).join(' | ');
  const renderParty = (party) => {
    if (!party.external) {
      return `<div class="header-party"><div class="header-party-role">${escapeHtml(party.roleLabel)}</div>${party.logoDataUrl ? `<div class="sfcc-brand"><img src="${party.logoDataUrl}" alt="SFCC logo"/></div>` : `<div class="header-party-name">${escapeHtml(valueOrDash(party.companyName))}</div>`}</div>`;
    }
    return `<div class="header-party"><div class="header-party-role">${escapeHtml(party.roleLabel)}</div>${party.logoDataUrl ? `<div class="header-party-logo logo-only"><img class="logo-img" src="${party.logoDataUrl}" alt="${escapeHtml(party.roleLabel)} logo"/></div>` : `<div class="header-party-name">${escapeHtml(valueOrDash(party.companyName))}</div>`}</div>`;
  };
  return `<div class="header-grid ${colClass}">${parties.map(renderParty).join('')}</div><div class="header-meta-strip ${metadataLine ? '' : 'empty'}">${escapeHtml(metadataLine)}</div><div class="title">${escapeHtml(title)}</div>`;
}

function renderProjectInfoTable(info, extraRows = '') {
  return `<table>
  <tr><td class="meta-label">Project Name</td><td>${escapeHtml(info.projectName)}</td><td class="meta-label">Project No.</td><td>${escapeHtml(info.projectNo)}</td></tr>
  <tr><td class="meta-label">Contract No.</td><td>${escapeHtml(info.contractNo)}</td><td class="meta-label">Client / Employer</td><td>${escapeHtml(info.client)}</td></tr>
  <tr><td class="meta-label">Main Contractor</td><td>${escapeHtml(info.contractor)}</td><td class="meta-label">Consultant</td><td>${escapeHtml(info.consultant)}</td></tr>
  <tr><td class="meta-label">Location / Site</td><td>${escapeHtml(info.location)}</td><td class="meta-label">Date Issued</td><td>${escapeHtml(info.dateIssued)}</td></tr>
  ${extraRows}
  <tr><td class="meta-label">Discipline</td><td>${escapeHtml(info.discipline)}</td><td class="meta-label">PMC</td><td>${escapeHtml(info.pmc)}</td></tr>
  <tr><td class="meta-label">Response Due</td><td>${escapeHtml(info.responseDue)}</td><td class="meta-label">Area / Zone</td><td>${escapeHtml(info.area)}</td></tr>
  </table>`;
}

function renderSignatureBlockLegacy(labels = ['SUBMITTED BY / CONTRACTOR', 'REVIEWED BY / CONSULTANT', 'APPROVED BY / CLIENT']) {
  const normalized = Array.isArray(labels) && labels.length ? labels.slice(0, 4) : ['SUBMITTED BY / CONTRACTOR', 'REVIEWED BY / CONSULTANT', 'APPROVED BY / CLIENT'];
  const colCount = Math.min(4, Math.max(2, normalized.length));
  return `<div class="section">SIGNATURES & AUTHORIZATION</div><div class="signature-grid cols-${colCount}">${normalized.map((label) => `<div class="signature-cell"><div class="signature-label">${escapeHtml(label)}</div><div class="signature-fields"><div class="signature-row"><span class="field-label">Name & Title</span><span class="field-line"></span></div><div class="signature-row"><span class="field-label">Signature</span><span class="field-line"></span></div><div class="signature-row"><span class="field-label">Date</span><span class="field-line"></span></div><div class="signature-row"><span class="field-label">Stamp / Seal</span><span class="field-line"></span></div></div></div>`).join('')}</div>`;
}

function renderCopyFooter() { return renderPdfFooter(); }

function wrapTemplate({ document, project, logoDataUri, title, bodyHtml, extraProjectRows = '', project_logos = {}, project_stakeholders = {}, includePmcInHeader = false, metadataText = '', density = 'normal', fullPageFill = false, formLayoutClass = '' }) {
  const info = projectInfo(document, project);
  const logos = { sfcc: project_logos.sfcc || logoDataUri, client: project_logos.client, consultant: project_logos.consultant, pmc: project_logos.pmc };
  const densityClass = density === 'compact'
    ? 'density-compact'
    : (density === 'ultraCompact'
      ? 'density-ultra'
      : (density === 'balancedOnePage'
        ? 'density-balanced'
        : (density === 'compactReadableProfile'
          ? 'density-compact-readable'
          : (density === 'certificateBalancedProfile' ? 'density-certificate-balanced' : 'density-normal'))));
  return `<!doctype html><html><head><meta charset="utf-8"><style>${sharedCss(density)}</style></head><body><div class="page"><div class="qms-a4-page ${densityClass} ${fullPageFill ? 'full-page-fill' : ''} ${formLayoutClass}">${renderControlledFormHeader({ title, logos, stakeholders: project_stakeholders, project, options: { requirePmc: includePmcInHeader, projectStakeholders: project_stakeholders.rows || [] , metadataText }, metadataText })}${renderProjectInfoTable(info, extraProjectRows)}<div class="qms-form-body"><div class="qms-form-content">${bodyHtml}</div><div class="spacer"></div>${renderCopyFooter()}</div></div></div></body></html>`;
}


function safeValue(value, fallback = '—') {
  return coreSafeValue(value, fallback);
}

function normalizeDocumentType(type = '') {
  const t = String(type || '').trim().toUpperCase();
  const alias = {
    'MATERIAL SUBMITTAL':'MS','MATERIAL_SUBMITTAL':'MS',
    'DRAWING SUBMITTAL':'DS','DRAWING_SUBMITTAL':'DS',
    'REQUEST FOR INFORMATION':'RFI','INSPECTION REQUEST':'IR',
    'NON-CONFORMANCE REPORT':'NCR','NON CONFORMANCE REPORT':'NCR',
    'TRANSMITTAL':'TR','SITE INSTRUCTION':'SI','VARIATION ORDER':'VO',
    'RISK REGISTER':'RISK','PROGRESS REPORT':'PROGRESS','HANDOVER REPORT':'HANDOVER',
    'HANDOVER / CLOSEOUT REPORT':'HANDOVER','COMPLETION CERTIFICATE':'COMPLETION','FINAL COMPLETION CERTIFICATE':'COMPLETION'
  };
  return alias[t] || t;
}

function normalizeDiscipline(value='') {
  const v = String(value || '').trim().toUpperCase();
  if (!v) return 'GEN';
  const map = {ARCHITECTURAL:'ARCH',ARCH:'ARCH',CIVIL:'CIV',ELECTRICAL:'ELEC',MECHANICAL:'MEP',GENERAL:'GEN'};
  return map[v] || v.replace(/[^A-Z0-9]/g,'').slice(0,6) || 'GEN';
}

function renderApprovalCodes() {
  return `<table style="margin-top:0;"><tr><td style="padding:6px;background:#fffdf6;"><div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;font-weight:700;"><div style="border:1px solid #d2c18f;background:#fff6db;padding:6px;"><strong>A</strong> — Approved As Submitted</div><div style="border:1px solid #d2c18f;background:#fff6db;padding:6px;"><strong>B</strong> — Approved As Noted</div><div style="border:1px solid #d2c18f;background:#fff6db;padding:6px;"><strong>C</strong> — Not Approved / Resubmit</div><div style="border:1px solid #d2c18f;background:#fff6db;padding:6px;"><strong>D</strong> — Disapproved</div><div style="border:1px solid #d2c18f;background:#fff6db;padding:6px;"><strong>E</strong> — For Information Only</div></div></td></tr></table>`;
}

function renderOutcomeOptions(options = [], selected = '') {
  return renderStatusOptions(options, selected);
}

function renderOutcomeOptionsLegacy(options = []) {
  return `<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;">${options.map((option = {}) => `<div style="border:1px solid ${option.borderColor || '#cbd5e1'};background:${option.backgroundColor || '#f8fafc'};padding:6px;border-radius:4px;"><div style="display:flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;border:1px solid #334155;background:#fff;display:inline-block;flex:0 0 auto;"></span><span style="font-weight:700;font-size:10px;line-height:1.2;">${escapeHtml(option.label || '')}</span></div></div>`).join('')}</div>`;
}

function renderMaterialSubmittalPdf(data) { const { document } = data; const f = parseFormData(document.form_data);
  const itemsRaw = Array.isArray(f.material_items) ? f.material_items : (Array.isArray(f.items) ? f.items : []);
  const items = padRows(itemsRaw.map((it = {}) => ({
    catalogue_no: it.catalogue_no || it.submittal_no,
    revision: it.revision,
    material_description: it.material_description || it.description,
    manufacturer_supplier: it.manufacturer_supplier || it.manufacturer || it.supplier_manufacturer,
    country_of_origin: it.country_of_origin || it.origin,
    code: it.code || it.code_model,
    remarks: it.remarks,
  })), 10, () => ({}));
  const bodyHtml = `<div class="section">SECTION 1: SUBMITTAL INFORMATION</div><table>${row('Submittal Type', f.submittal_type)}${row('Specification Ref.', f.specification_ref || f.specification_reference || f.spec_reference)}${row('Package Ref.', f.package_ref || f.package_reference)}</table>
  <div class="section">SECTION 2: MATERIAL SUBMITTAL ITEMS</div><table class="ms-items-table"><tr><th style="width:6%;text-align:center;">No.</th><th style="width:15%;text-align:center;">Catalogue No.</th><th>Material Description / Specification</th><th style="width:15%;text-align:center;">Manufacturer / Supplier</th><th style="width:12%;text-align:center;">Country of Origin</th><th style="width:8%;text-align:center;">Rev.</th><th style="width:10%;text-align:center;">Code</th><th style="width:14%;">Remarks</th></tr>${items.map((it, i) => `<tr><td style="text-align:center;">${i + 1}</td><td style="text-align:center;">${escapeHtml(valueOrBlank(it.catalogue_no))}</td><td>${escapeHtml(valueOrBlank(it.material_description))}</td><td style="text-align:center;">${escapeHtml(valueOrBlank(it.manufacturer_supplier))}</td><td style="text-align:center;">${escapeHtml(valueOrBlank(it.country_of_origin))}</td><td style="text-align:center;">${escapeHtml(valueOrBlank(it.revision))}</td><td style="text-align:center;">${escapeHtml(valueOrBlank(it.code))}</td><td>${escapeHtml(valueOrBlank(it.remarks))}</td></tr>`).join('')}</table>
  <div class="section" style="background:#14305c;font-weight:800;">SECTION 3: APPROVAL CODES REFERENCE</div><table style="margin-top:0;"><tr><td style="padding:6px;background:#fffdf6;"><div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;font-weight:700;"><div style="border:1px solid #d2c18f;background:#fff6db;padding:6px;"><strong>A</strong> — Approved As Submitted</div><div style="border:1px solid #d2c18f;background:#fff6db;padding:6px;"><strong>B</strong> — Approved As Noted</div><div style="border:1px solid #d2c18f;background:#fff6db;padding:6px;"><strong>C</strong> — Not Approved / Resubmit</div><div style="border:1px solid #d2c18f;background:#fff6db;padding:6px;"><strong>D</strong> — Disapproved</div><div style="border:1px solid #d2c18f;background:#fff6db;padding:6px;"><strong>E</strong> — For Information Only</div></div></td></tr></table>
  <div class="section">CLIENT / CONSULTANT REVIEW COMMENTS</div><table><tr><td>${renderWritingLines(f.review_comments || f.reviewComments || f.comments || '', 4, 5.6)}</td></tr></table>
  <div class="section">CONTRACTOR NOTES / REMARKS</div><table><tr><td>${renderWritingLines(f.contractor_notes || f.contractorNotes || document.notes || '', 3, 5.6)}</td></tr></table>${renderSignatureBlock(['SUBMITTED BY / CONTRACTOR', 'REVIEWED BY / CONSULTANT', 'APPROVED BY / CLIENT'])}`;
  return wrapTemplate({ ...data, title: 'MATERIAL SUBMITTAL', density: 'compactReadableProfile', includePmcInHeader: true, metadataText: 'Form No.: SFCC-QMS-MS-001 | Revision: R0 | ISO 9001 Controlled Form', bodyHtml, extraProjectRows: `<tr><td class="meta-label">Material Reference No. / Document Ref.</td><td>${escapeHtml(valueOrDash(document?.ref || document?.reference_no))}</td><td class="meta-label">Revision</td><td>${escapeHtml(valueOrDash(document?.revision || 'R0'))}</td></tr>` }); }
function renderDrawingSubmittalPdf(data) { const { document } = data; const f = parseFormData(document.form_data); const drawingRows = Array.isArray(f.drawing_register) ? f.drawing_register : (Array.isArray(f.dsItems) ? f.dsItems : []); const rows = padRows(drawingRows, 10, () => ({}));
  const bodyHtml = `<div class="section">SECTION 1: SUBMITTAL INFORMATION</div><table>${row('Package Reference', document.ref)}${row('Submission Purpose', f.purpose)}${row('Discipline', document.discipline)}${row('Status', document.workflow_status || document.approval_status)}</table>
  <div class="section">SECTION 2: DRAWING REGISTER</div><table><tr><th style="width:6%;">#</th><th style="width:24%;">Drawing No.</th><th style="width:10%;">Rev</th><th>Title</th><th style="width:10%;">Scale</th><th style="width:10%;">Code</th></tr>${rows.map((it, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(valueOrDash(it.drawing_number || it.dwgNo || it.drawingNo))}</td><td>${escapeHtml(valueOrDash(it.revision || it.rev))}</td><td>${escapeHtml(valueOrDash(it.title || it.description))}</td><td>${escapeHtml(valueOrDash(it.scale))}</td><td>${escapeHtml(valueOrDash(it.approval_code || it.code || it.approvalCode))}</td></tr>`).join('')}</table>
  <div class="section">SECTION 3: APPROVAL CODES REFERENCE</div>${renderApprovalCodes()}
  <div class="section">CLIENT / CONSULTANT REVIEW COMMENTS</div><table><tr><td>${renderWritingLines(f.review_comments || f.reviewComments || f.comments || '', 5)}</td></tr></table>
  <div class="section">CONTRACTOR NOTES / REMARKS</div><table><tr><td>${renderWritingLines(f.contractor_notes || f.contractorNotes || document.notes || '', 4)}</td></tr></table>${renderSignatureBlock(['SUBMITTED BY / CONTRACTOR', 'REVIEWED BY / CONSULTANT', 'APPROVED BY / CLIENT'])}`;
  return wrapTemplate({ ...data, title: 'DRAWING SUBMITTAL', density: 'compactReadableProfile', includePmcInHeader: true, metadataText: 'Form No.: SFCC-QMS-DS-001 | Revision: R0 | ISO 9001 Controlled Form', bodyHtml, extraProjectRows: `<tr><td class="meta-label">Drawing Submittal Ref. / Document Ref.</td><td>${escapeHtml(valueOrDash(document?.ref || document?.reference_no))}</td><td class="meta-label">Revision</td><td>${escapeHtml(valueOrDash(document?.revision || 'R0'))}</td></tr>` }); }
function renderRfiPdf(data) { const { document, attachments } = data; const f = parseFormData(document.form_data);
  const informationRequested = valueOrBlank(f.information_requested || f.requested_information || f.question || f.clarification || document.description);
  const proposedSolution = valueOrBlank(f.proposed_solution || f.contractor_recommendation);
  const consultantResponse = valueOrBlank(f.consultant_response || f.response_clarification || f.response || f.consultantResponse);
  const attachmentReferences = valueOrBlank(f.attachment_references || f.attachments || attachmentNames(attachments));
  const drawingRef = valueOrBlank(f.drawing_ref || f.drawing_reference);
  const specificationRef = valueOrBlank(f.specification_ref || f.specification_reference || f.spec_reference);

  const bodyHtml = `<div class="section">SECTION 1: RFI DETAILS</div><table>${row('RFI Reference', document.ref)}${row('Subject', f.subject || document.title)}${row('Discipline', document.discipline)}${row('Required Response Date', f.response_required_by || f.requiredResponseDate || document.due_date)}${row('Priority', f.priority)}${row('RFI Category', f.rfi_category)}${row('Area / Zone', f.area_zone || document.area)}${row('Drawing Ref.', drawingRef)}${row('Specification Ref.', specificationRef)}${row('Contract Clause / Standard', f.contract_clause)}</table>
  <div class="section">SECTION 2: INFORMATION REQUESTED</div><table><tr><td>${renderWritingLines([informationRequested, proposedSolution].filter(Boolean).join('\n'), 4, 5.8)}</td></tr></table>
  <div class="section">SECTION 3: ATTACHMENTS</div><table><tr><td>${renderWritingLines(attachmentReferences === '—' ? '' : attachmentReferences, 3, 5.7)}</td></tr></table>
  <div class="section">SECTION 4: RESPONSE / CLARIFICATION FOR CONSULTANT USE</div><table><tr><td>${renderWritingLines(consultantResponse, 4, 5.8)}</td></tr></table>${renderSignatureBlock(['SUBMITTED BY / CONTRACTOR', 'REVIEWED BY / CONSULTANT', 'AUTHORIZED BY / CLIENT'])}`;
  return wrapTemplate({ ...data, title: 'REQUEST FOR INFORMATION', density: 'compactReadableProfile', bodyHtml }); }
function renderInspectionRequestPdf(data) { const { document, attachments } = data; const f = parseFormData(document.form_data);
  const inspectionType = f.inspection_type || f.inspectionType;
  const requestedDate = f.requested_inspection_date || f.date_of_inspection || f.requestedDate;
  const requestedTime = f.requested_time || f.requestedInspectionTime || '';
  const requestedDateTime = [requestedDate, requestedTime].filter(Boolean).join(' / ') || f.requestedInspectionDateTime;
  const drawingRef = f.drawing_ref || f.drawing_reference;
  const methodStatementRef = f.method_statement_ref || f.method_statement_reference;
  const testPackageRef = f.test_package_ref || f.test_package_reference || f.testPackage || f.checklist;
  const inspectionDescription = f.inspection_description || f.workDescription || document.description || '';
  const readinessConfirmation = f.ready_for_inspection || f.readinessConfirmation || f.readiness;
  const remarks = f.client_contractor_remarks || f.client_consultant_remarks || f.contractor_remarks || f.remarks || f.inspection_remarks || f.consultantComments || document.notes || '';
  const selectedOutcome = f.inspection_outcome || f.outcome || f.result || document.workflow_status || '';
  const actionFollowUp = f.action_follow_up || f.follow_up_action || f.followUpAction || '';
  const actionRequiredBy = f.action_required_by || '';
  const outcomeOptions = [
    { label: 'Approved', backgroundColor: '#e7f8ee', borderColor: '#6cbf88' },
    { label: 'Approved as Noted', backgroundColor: '#fff7dc', borderColor: '#d9b75b' },
    { label: 'Rejected', backgroundColor: '#fee9e9', borderColor: '#d27d7d' },
    { label: 'Rectify & Resubmit / Re-inspection Required', backgroundColor: '#ffefdf', borderColor: '#e29a4d' },
  ];
  const bodyHtml = `<div class="section">SECTION 1: INSPECTION REQUEST DETAILS</div><table class="ir-details-table">${row('IR Reference', document.ref)}${row('Inspection Type', inspectionType)}${row('Requested Date / Time', requestedDateTime)}${row('Location / Area', f.location || f.area_zone || document.area)}${row('Drawing Reference', drawingRef)}</table>
  <div class="section">SECTION 2: INSPECTION DESCRIPTION</div><table><tr><td>${renderWritingLines(inspectionDescription, 3, 5.8)}</td></tr></table>
  <div class="section">SECTION 3: TEST PACKAGE & ATTACHMENTS</div><table>${row('Checklist / Test Package', testPackageRef)}${row('Method Statement Reference', methodStatementRef)}${row('Attachments', attachmentNames(attachments))}</table>
  <div class="section">SECTION 4: READINESS CONFIRMATION</div><table>${row('Readiness Confirmation', readinessConfirmation)}</table>
  <div class="section">SECTION 5: CLIENT & CONTRACTOR REMARKS</div><table><tr><td>${renderWritingLines(remarks, 3, 5.8)}</td></tr></table>
  <div class="section">SECTION 6: INSPECTION STATUS / OUTCOME</div><table><tr><td style="padding:9px;background:#f8fafc;border:1px solid #cbd5e1;">${renderOutcomeOptions(outcomeOptions, selectedOutcome)}<div style="margin-top:8px;font-size:9px;font-weight:700;">Selected Outcome: ${escapeHtml(safeValue(selectedOutcome, 'Not indicated'))}</div></td></tr><tr><td style="padding:7px 8px;"><div style="font-weight:700;margin-bottom:4px;">Action / Follow-up</div>${renderWritingLines(actionFollowUp, 2, 5.8)}</td></tr>${actionRequiredBy ? `<tr><td style="padding:7px 8px;"><strong>Action Required By / Responsible:</strong> ${escapeHtml(actionRequiredBy)}</td></tr>` : ''}</table>${renderSignatureBlock(['CONTRACTOR QC / INSPECTOR', 'CONSULTANT / RESIDENT ENGINEER', 'CLIENT REPRESENTATIVE'])}`;
  return wrapTemplate({ ...data, title: 'INSPECTION REQUEST', density: 'compactReadableProfile', bodyHtml }); }
function renderNcrPdf(data) { const { document } = data; const f = parseFormData(document.form_data);
  const bodyHtml = `<div class="section">PART 1: NON-CONFORMITY IDENTIFICATION</div><table>${row('NCR Reference', document.ref)}${row('Area / Location', f.location || document.area)}${row('Severity', f.severity || document.severity)}${row('Description of Non-Conformity & Action Required', f.nonConformanceDescription || document.description)}</table>
  <div class="section">PART 2: CONTRACTOR RESPONSE & CORRECTIVE ACTION PLAN</div><table>${row('Root Cause Category', f.rootCauseCategory || f.rootCause)}<tr><td class="lbl" style="width:22%;">Proposed Corrective Action</td><td class="fill-xl">${escapeHtml(valueOrDash(f.correctiveAction))}</td></tr></table>
  <div class="section">PART 3: VERIFICATION & CLOSURE</div><table>${row('Action Taken', f.actionTaken)}${row('Completion Date', f.completionDate)}${row('Closure Date', f.closureDate)}${row('Closure Verification', f.closureVerification)}</table>${renderSignatureBlock(['PROJECT MANAGER / QC ENGINEER','CONTRACTOR REPRESENTATIVE','CLIENT / CONSULTANT REPRESENTATIVE'])}`;
  return wrapTemplate({ ...data, title: 'NON-CONFORMANCE REPORT', bodyHtml }); }
function renderTransmittalPdf(data) {
  const { document } = data;
  const f = parseFormData(document.form_data);
  const docs = padRows(f.documents || f.transmittedDocuments || [], 8, () => ({})).slice(0, 8);
  const bodyHtml = `<div class="section">SECTION 1 — TRANSMITTAL DETAILS</div><table>${row('Urgency', f.urgency || f.priority)}${row('Purpose', f.purpose || f.purposeOfIssue)}${row('From Company', f.fromCompany || f.from)}${row('To Company', f.toCompany || f.to)}${row('Attention', f.attention)}${row('Remarks', f.remarks || document.notes)}</table>
  <div class="section">SECTION 2 — TRANSMITTED DOCUMENTS</div><table class="tr-docs"><tr><th style="width:6%;">No.</th><th style="width:24%;">Document No. / Reference</th><th style="width:8%;">Rev.</th><th>Title / Description</th><th style="width:10%;">Copies</th><th style="width:18%;">Remarks</th></tr>
  ${docs.map((it, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(valueOrDash(it.ref || it.documentNo || it.reference || (i === 0 ? document.ref : '')))}</td><td>${escapeHtml(valueOrDash(it.revision || it.rev || document.revision || 'R0'))}</td><td>${escapeHtml(valueOrDash(it.title || it.description || (i === 0 ? f.documentList : '')))}</td><td>${escapeHtml(valueOrDash(it.copies || it.quantity || f.quantity))}</td><td>${escapeHtml(valueOrDash(it.remarks || it.note))}</td></tr>`).join('')}</table>
  <div class="section">SECTION 3 — RECIPIENT REMARKS / COMMENTS</div><table class="tr-comments-lines"><tr><td>${renderWritingLines(f.recipientRemarks || f.remarks || document.notes || '', 4, 5.5)}</td></tr></table>
  <div class="section">SECTION 4 — CONTRACTOR RESPONSE</div><table class="tr-response-lines"><tr><td>${renderWritingLines(f.contractorResponse || '', 4, 5.5)}</td></tr></table><div class="tr-signature">${renderSignatureBlock(['TRANSMITTED BY / CONTRACTOR', 'RECEIVED BY / RECIPIENT', 'AUTHORIZED BY'])}</div>`;
  return wrapTemplate({ ...data, title: 'TRANSMITTAL', metadataText: 'Form No.: SFCC-QMS-TR-001 | Revision: R0 | ISO 9001 Controlled Form', bodyHtml, includePmcInHeader: true, density: 'balancedOnePage', formLayoutClass: 'form-layout-transmittal' });
}

function renderSiteInstructionPdf(data) { const { document } = data; const f = parseFormData(document.form_data);
  const bodyHtml = `<div class="section">SECTION 1: INSTRUCTION DETAILS</div><table>${row('SI Reference', document.ref)}${row('Instruction Date', f.instructionDate || document.issue_date)}${row('Issued By', f.issuedBy)}${row('Issued To', f.issuedTo)}</table>
  <div class="section">SECTION 2: SITE INSTRUCTION DESCRIPTION</div><table class="si-description-lines"><tr><td>${renderWritingLines(f.instructionDescription || document.description || '', 4, 5.5)}</td></tr></table>
  <div class="section">SECTION 3: REQUIRED ACTION / RESPONSE</div><table class="si-action-lines"><tr><td>${renderWritingLines(f.requiredAction || f.responseRequired || '', 4, 5.5)}</td></tr></table>
  <div class="section">SECTION 4: ACKNOWLEDGEMENT / CONTRACTOR RESPONSE</div><table class="si-ack-lines"><tr><td>${renderWritingLines(f.contractorResponse || f.acknowledgement || '', 3, 5.5)}</td></tr></table><div class="si-signature">${renderSignatureBlock(['ISSUED BY', 'RECEIVED BY', 'CONTRACTOR REPRESENTATIVE', 'CONSULTANT / CLIENT APPROVAL'])}</div>`;
  return wrapTemplate({ ...data, title: 'SITE INSTRUCTION', density: 'balancedOnePage', bodyHtml, formLayoutClass: 'form-layout-site-instruction' }); }
function renderVariationOrderPdf(data) { const { document } = data; const f = parseFormData(document.form_data); const items = padRows(f.items || [], 7, () => ({}));
  const bodyHtml = `<div class="section">SECTION 1: VARIATION DETAILS</div><table>${row('Variation Reference', document.ref)}${row('Variation Title', f.subject || document.title)}${row('Status', document.workflow_status || document.approval_status)}${row('Location / Area', f.location || document.area)}</table>
  <div class="section">SECTION 2: VARIATION DESCRIPTION</div><table><tr><td class="fill-lg">${escapeHtml(valueOrDash(f.description || document.description))}</td></tr></table>
  <div class="section">SECTION 3: REASON FOR CHANGE / JUSTIFICATION</div><table><tr><td class="fill">${escapeHtml(valueOrDash(f.reason || f.justification))}</td></tr></table>
  <div class="section">SECTION 4: VARIATION ITEMS BREAKDOWN</div><table><tr><th style="width:6%;">#</th><th>Description</th><th style="width:14%;">Qty</th><th style="width:20%;">Amount</th></tr>${items.map((it, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(valueOrDash(it.description || it.item))}</td><td>${escapeHtml(valueOrDash(it.qty || it.quantity))}</td><td>${escapeHtml(valueOrDash(it.amount || it.total))}</td></tr>`).join('')}<tr><td colspan="3" style="text-align:right;font-weight:700;">TOTAL VARIATION AMOUNT</td><td style="font-weight:700;">${escapeHtml(valueOrDash(f.totalAmount || document.amount))}</td></tr></table>${renderSignatureBlock(['PREPARED BY / CONTRACTOR', 'REVIEWED BY / CONSULTANT', 'APPROVED BY / CLIENT'])}`;
  return wrapTemplate({ ...data, title: 'VARIATION ORDER', bodyHtml }); }


function renderRiskRegisterPdf(data){ const {project, document}=data; const dbRows = (parseFormData(document?.form_data).rows)||[]; const rows = padRows(dbRows,8,()=>({})); const total=rows.filter(r=>Object.keys(r).length).length; const high=rows.filter(r=>String(r.risk_rating||r.severity||'').toLowerCase().includes('high')).length; const open=rows.filter(r=>['open','in progress'].includes(String(r.status||'open').toLowerCase())).length; const closed=rows.filter(r=>String(r.status||'').toLowerCase()==='closed').length; const bodyHtml=`<div class="section">RISK SUMMARY</div><table><tr><td>Total Risks</td><td>${total}</td><td>High Risks</td><td>${high}</td><td>Open Risks</td><td>${open}</td><td>Closed Risks</td><td>${closed}</td></tr></table><div class="section">RISK REGISTER</div><table><tr><th>Risk ID</th><th>Category</th><th>Description</th><th>Cause</th><th>Impact</th><th>Probability</th><th>Severity</th><th>Risk Rating</th><th>Mitigation Action</th><th>Owner</th><th>Due Date</th><th>Status</th></tr>${rows.map(r=>`<tr><td>${escapeHtml(valueOrBlank(r.risk_id))}</td><td>${escapeHtml(valueOrBlank(r.category))}</td><td>${escapeHtml(valueOrBlank(r.description))}</td><td>${escapeHtml(valueOrBlank(r.cause))}</td><td>${escapeHtml(valueOrBlank(r.impact))}</td><td>${escapeHtml(valueOrBlank(r.probability))}</td><td>${escapeHtml(valueOrBlank(r.severity))}</td><td>${escapeHtml(valueOrBlank(r.risk_rating))}</td><td>${escapeHtml(valueOrBlank(r.mitigation_action))}</td><td>${escapeHtml(valueOrBlank(r.owner))}</td><td>${escapeHtml(valueOrBlank(r.due_date))}</td><td>${escapeHtml(valueOrBlank(r.status))}</td></tr>`).join('')}</table>`; return wrapTemplate({...data,title:'RISK REGISTER',metadataText:'Form No.: SFCC-QMS-RISK-001 | Revision: R0 | ISO 9001 Controlled Form',bodyHtml}); }
function renderProgressReportPdf(data){ const {document}=data; const f=parseFormData(document?.form_data); const bodyHtml=`<div class="section">PROJECT SUMMARY</div><table>${row('Reporting Period',`${safeValue(f.period_from,'')} to ${safeValue(f.period_to,'')}`)}${row('Overall Progress %',f.overall_pct)}${row('Planned vs Actual',f.planned_vs_actual)}</table><div class="section">KEY COMPLETED WORKS</div><table><tr><td class="fill">${escapeHtml(safeValue(f.key_completed_works,''))}</td></tr></table><div class="section">WORKS IN PROGRESS</div><table><tr><td class="fill">${escapeHtml(safeValue(f.works_in_progress,''))}</td></tr></table><div class="section">UPCOMING WORKS / ISSUES / RISKS</div><table><tr><td class="fill">${escapeHtml(safeValue(f.upcoming_works,''))}</td></tr><tr><td class="fill">${escapeHtml(safeValue(f.delays_issues,''))}</td></tr><tr><td class="fill">${escapeHtml(safeValue(f.risks_mitigation,''))}</td></tr></table>`; return wrapTemplate({...data,title:'PROGRESS REPORT',metadataText:'Form No.: SFCC-QMS-PRG-001 | Revision: R0 | ISO 9001 Controlled Form',bodyHtml}); }
function renderHandoverReportPdf(data){ const {document}=data; const f=parseFormData(document?.form_data); const bodyHtml=`<div class="section">HANDOVER STATUS SUMMARY</div><table>${row('Discipline Closeout Status',f.discipline_closeout_status)}${row('Document Closeout Checklist',f.document_closeout_checklist)}${row('Pending Items',f.pending_items)}</table><div class="section">SNAG / PUNCH LIST SUMMARY</div><table><tr><td class="fill">${escapeHtml(safeValue(f.snag_punch_summary,''))}</td></tr></table><div class="section">FINAL COMMENTS</div><table><tr><td class="fill">${escapeHtml(safeValue(f.final_comments,''))}</td></tr></table>`; return wrapTemplate({...data,title:'HANDOVER / CLOSEOUT REPORT',metadataText:'Form No.: SFCC-QMS-HND-001 | Revision: R0 | ISO 9001 Controlled Form',bodyHtml}); }

module.exports = {
  renderMaterialSubmittalPdf,
  renderDrawingSubmittalPdf,
  renderRfiPdf,
  renderInspectionRequestPdf,
  renderNcrPdf,
  renderTransmittalPdf,
  renderSiteInstructionPdf,
  renderVariationOrderPdf,
  renderRiskRegisterPdf,
  renderProgressReportPdf,
  renderHandoverReportPdf,
  resolveControlledHeaderParties,
  normalizeStakeholderRole,
  renderProjectInfoTable,
  renderApprovalCodes,
  renderSignatureBlock,
  renderWritingLines,
  renderCopyFooter,
  safeValue,
  normalizeDocumentType,
  normalizeDiscipline,
  renderOutcomeOptions,
};
