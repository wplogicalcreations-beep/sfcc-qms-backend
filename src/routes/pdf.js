const express = require('express');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/schema');
const { requireAuth, requireProjectPermission, requireProjectMembershipByProjectId } = require('../middleware/auth');
const { generatePdfBuffer } = require('../services/pdfService');
const { getActiveApprovedTemplate, renderTemplateRecord, normalizeDocumentType } = require('../services/qmsTemplateEngine');
const {
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
} = require('../templates/qmsPdfTemplates');
const {
  renderScheduleGanttPdf,
  renderScheduleTablePdf,
} = require('../templates/schedulePdfTemplates');
const { renderHandoverCompletionCertificatePdf } = require('../templates/handoverPdfTemplates');

const router = express.Router();


const DOCUMENT_PDF_RENDERERS = {
  MS: { slug: 'material-submittal', renderer: renderMaterialSubmittalPdf, defaultName: 'material-submittal' },
  DS: { slug: 'drawing-submittal', renderer: renderDrawingSubmittalPdf, defaultName: 'drawing-submittal' },
  RFI: { slug: 'rfi', renderer: renderRfiPdf, defaultName: 'rfi' },
  IR: { slug: 'inspection-request', renderer: renderInspectionRequestPdf, defaultName: 'inspection-request' },
  NCR: { slug: 'ncr', renderer: renderNcrPdf, defaultName: 'ncr' },
  TR: { slug: 'transmittal', renderer: renderTransmittalPdf, defaultName: 'transmittal' },
  SI: { slug: 'site-instruction', renderer: renderSiteInstructionPdf, defaultName: 'site-instruction' },
  VO: { slug: 'variation-order', renderer: renderVariationOrderPdf, defaultName: 'variation-order' },
  RISK: { slug: 'risk-register', renderer: renderRiskRegisterPdf, defaultName: 'risk-register' },
  PROGRESS: { slug: 'progress-report', renderer: renderProgressReportPdf, defaultName: 'progress-report' },
  HANDOVER: { slug: 'handover-report', renderer: renderHandoverReportPdf, defaultName: 'handover-report' },
  COMPLETION: { slug: 'completion-certificate', renderer: renderHandoverCompletionCertificatePdf, defaultName: 'completion-certificate' },
};


function getDefaultSfccLogoDataUrl() {
  const logoCandidates = [
    'frontend/public/silver-foundation-logo.png',
    'frontend/public/sfcc-logo.png',
    'backend/public/silver-foundation-logo.png',
    'backend/public/sfcc-logo.png',
    'public/silver-foundation-logo.png',
    'public/sfcc-logo.png',
  ];

  for (const relativePath of logoCandidates) {
    const absolutePath = path.resolve(process.cwd(), relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    try {
      return toDataUrl(absolutePath, 'image/png');
    } catch (error) {
      console.warn(`[PDF] Default SFCC logo read failed | message=${error.message}`);
    }
  }

  return '';
}

function getProjectLogoDataUrls(projectId) {
  const db = getDb();
  const result = { sfcc: null, client: null, consultant: null, pmc: null };
  const rows = db.prepare('SELECT * FROM project_logos WHERE project_id=? AND active=1').all(projectId);
  for (const row of rows) {
    if (!(row.logo_type in result)) continue;
    const dataUrl = toDataUrl(row.file_path, row.mime_type);
    if (!dataUrl) {
      console.warn(`[PDF] Project logo missing/unreadable | projectId=${projectId} | logoType=${row.logo_type}`);
      continue;
    }
    result[row.logo_type] = dataUrl;
  }
  console.log(`[PDF] PDF logos loaded: sfcc=${!!result.sfcc} client=${!!result.client} consultant=${!!result.consultant} pmc=${!!result.pmc} | projectId=${projectId}`);
  return result;
}

function getProjectStakeholders(project) {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM project_stakeholders WHERE project_id=? AND active=1 ORDER BY role, is_default_for_role DESC, created_at').all(project?.id || '');
  const pick = (role) => {
    const roleRows = rows.filter((s) => s.role === role);
    if (!roleRows.length) return null;
    return roleRows.find((s) => Number(s.is_default_for_role) === 1) || roleRows[0];
  };
  const defaultsFound = {
    client: !!rows.find((s) => s.role === 'Client / Employer' && Number(s.is_default_for_role) === 1),
    consultant: !!rows.find((s) => s.role === 'Consultant / Engineer' && Number(s.is_default_for_role) === 1),
    pmc: !!rows.find((s) => s.role === 'PMC' && Number(s.is_default_for_role) === 1),
    contractor: !!rows.find((s) => ['Main Contractor', 'Contractor'].includes(s.role) && Number(s.is_default_for_role) === 1),
  };
  console.log(`[PDF] stakeholder defaults found: client=${defaultsFound.client} consultant=${defaultsFound.consultant} pmc=${defaultsFound.pmc} contractor=${defaultsFound.contractor} | projectId=${project?.id || 'unknown'}`);
  return {
    rows,
    client_employer: pick('Client / Employer') || null,
    consultant_engineer: pick('Consultant / Engineer') || null,
    pmc: pick('PMC') || null,
    main_contractor: pick('Main Contractor') || null,
    contractor: pick('Contractor') || null,
  };
}

function getDocumentBundle(id) {
  const db = getDb();
  const document = db.prepare('SELECT * FROM documents WHERE id=?').get(id);
  if (!document) return null;
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(document.project_id);
  const attachments = db.prepare('SELECT id, original_name, file_type, file_size, uploaded_at FROM attachments WHERE doc_id=?').all(id);
  const project_logos = getProjectLogoDataUrls(project?.id);
  if (!project_logos.sfcc) project_logos.sfcc = getDefaultSfccLogoDataUrl() || null;
  const project_stakeholders = getProjectStakeholders(project);
  const resolvedParties = resolveControlledHeaderParties(project, project_logos, project_stakeholders);
  const byKey = Object.fromEntries(resolvedParties.map((party) => [party.key, party]));
  const decision = (key, always = false) => {
    const party = byKey[key];
    return {
      include: always ? true : !!party,
      reason: always ? 'always' : (party?.source || 'excluded'),
    };
  };
  const stakeholderDebugRows = (project_stakeholders?.rows || []).map((row) => ({
    id: row?.id,
    role: row?.role,
    normalizedRole: row?.role ? normalizeStakeholderRole(row.role) : null,
    company_name: row?.company_name,
    is_default_for_role: row?.is_default_for_role,
    active: row?.active,
  }));
  const logsAttachedPerParty = Object.fromEntries(resolvedParties.map((party) => [party.key, !!party.logoDataUrl]));
  console.log('CONTROLLED HEADER DEBUG START');
  console.log(JSON.stringify({
    project: {
      id: project?.id,
      code: project?.code,
      name: project?.name,
      client: project?.client,
      client_name: project?.client_name,
      consultant: project?.consultant,
      pmc: project?.pmc,
      main_contractor: project?.main_contractor,
    },
    rawActiveStakeholders: stakeholderDebugRows,
    rawLogoAvailability: {
      sfcc: !!project_logos?.sfcc,
      client: !!project_logos?.client,
      consultant: !!project_logos?.consultant,
      pmc: !!project_logos?.pmc,
    },
    resolverDecision: {
      client: decision('client'),
      contractor: decision('sfcc', true),
      consultant: decision('consultant'),
      pmc: decision('pmc'),
    },
    finalOutput: {
      headerParties: resolvedParties.map((party) => party.key),
      columnCount: resolvedParties.length,
      logosAttachedPerParty: logsAttachedPerParty,
    },
  }, null, 2));
  console.log('CONTROLLED HEADER DEBUG END');
  return { document, project, attachments, logoDataUri: project_logos.sfcc || null, project_logos, project_stakeholders };
}
const toDisplay = (v) => (v === undefined || v === null || String(v).trim() === '' ? 'Not Set' : v);

function sanitizeFilenamePart(value, fallback = 'NA') {
  const normalized = String(value || fallback)
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  return normalized || fallback;
}

function buildPdfFilename(document) {
  const ref = sanitizeFilenamePart(document.ref, 'document');
  const type = sanitizeFilenamePart(document.type, 'DOC');
  const revision = sanitizeFilenamePart(document.revision || 'R0', 'R0');
  return `${ref}-${type}-${revision}.pdf`;
}

async function sendPdf(req, res, expectedType, renderer, defaultName) {
  const mode = req.query.mode === 'download' ? 'download' : 'view';
  console.log(`[PDF] Route hit | docId=${req.params.id} | expectedType=${expectedType || 'auto'} | mode=${mode}`);
  const data = getDocumentBundle(req.params.id);
  if (!data) return res.status(404).json({ error: 'Document not found' });
  if (!requireProjectMembershipByProjectId(req, res, data.document.project_id)) return;
  if (expectedType && data.document.type !== expectedType) return res.status(400).json({ error: 'unsupported document type' });

  try {
    const densityByType = { MS: 'balancedOnePage', IR: 'balancedOnePage', RFI: 'balancedOnePage', COMPLETION: 'normal/fullPageFill' };
    const normalizedType = normalizeDocumentType(data.document.type);
    const sectionEstimate = { MS: 6, IR: 7, RFI: 5 }[normalizedType] || 4;
    console.log(`[PDF] Render config | documentType=${normalizedType} | densityMode=${densityByType[normalizedType] || 'normal'} | sections≈${sectionEstimate} | renderer=${renderer.name || 'anonymous'}`);
    const html = renderer(data);
    const pdfBuffer = await generatePdfBuffer(html);
    const hasBuffer = Buffer.isBuffer(pdfBuffer);
    const bufferLength = hasBuffer ? pdfBuffer.length : 0;
    const firstTenBytes = hasBuffer ? pdfBuffer.subarray(0, 10).toString('utf8') : '';
    const startsWithPdf = hasBuffer && bufferLength >= 4 && pdfBuffer.subarray(0, 4).toString('utf8') === '%PDF';

    console.log(`[PDF] Generated | docId=${req.params.id} | documentType=${data.document.type} | mode=${mode} | pdfBufferLength=${bufferLength} | first10Bytes=${JSON.stringify(firstTenBytes)} | startsWithPDF=${startsWithPdf}`);

    if (!hasBuffer || bufferLength <= 0 || !startsWithPdf) {
      console.error(`[PDF] Invalid buffer | docId=${req.params.id} | documentType=${data.document.type} | mode=${mode}`);
      return res.status(500).json({ error: 'PDF generation failed. Invalid PDF buffer.' });
    }

    const filename = buildPdfFilename(data.document) || `${defaultName}.pdf`;
    const disposition = mode === 'download' ? 'attachment' : 'inline';

    res.status(200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(bufferLength));
    return res.end(pdfBuffer);
  } catch (error) {
    console.error(`[PDF] Generation error | docId=${req.params.id} | documentType=${expectedType || 'auto'} | mode=${mode} | message=${error.message}`);
    return res.status(500).json({ error: 'PDF generation failed. Please check backend logs.' });
  }
}

router.get('/documents/:id', requireAuth, requireProjectPermission('documents:read'), async (req, res) => {
  const data = getDocumentBundle(req.params.id);
  if (!data) return res.status(404).json({ error: 'Document not found' });
  if (!requireProjectMembershipByProjectId(req, res, data.document.project_id)) return;
  const config = DOCUMENT_PDF_RENDERERS[normalizeDocumentType(data.document.type)];
  if (!config) return res.status(400).json({ error: 'PDF template not available for this document type.' });



  const rawDocumentType = data.document.type;
  const normalizedDocumentType = normalizeDocumentType(rawDocumentType);
  let fallbackUsed = false;

  if (['MS', 'TR'].includes(normalizedDocumentType)) {
    const approvedTemplate = getActiveApprovedTemplate(normalizedDocumentType);
    if (approvedTemplate) {
      try {
        if (normalizedDocumentType === 'MS') {
          const formData = data.document.form_data ? JSON.parse(data.document.form_data) : {};
          const materialItems = Array.isArray(formData.material_items)
            ? formData.material_items
            : (Array.isArray(formData.items) ? formData.items : (Array.isArray(formData.materials) ? formData.materials : (Array.isArray(formData.rows) ? formData.rows : [])));
          const padded = [...materialItems]; while (padded.length < 10) padded.push({});
          const material_rows = padded.slice(0, 10).map((row, idx) => `<tr><td>${idx + 1}</td><td>${row.catalogue_no || row.submittal_no || ''}</td><td>${row.revision || ''}</td><td>${row.material_description || row.description || ''}</td><td>${row.manufacturer_supplier || row.manufacturer || row.supplier_manufacturer || ''}</td><td>${row.country_of_origin || row.origin || ''}</td><td>${row.code || row.code_model || ''}</td><td>${row.remarks || ''}</td></tr>`).join('');

          const html = renderTemplateRecord(approvedTemplate, {
            project: {
              name: toDisplay(data.project?.name),
              code: toDisplay(data.project?.code),
              contract_no: toDisplay(data.project?.contract_no),
              client: toDisplay(data.project?.client),
              consultant: toDisplay(data.project?.consultant),
              main_contractor: 'Silver Foundation Contracting Company',
              location: toDisplay(data.project?.location),
              pmc: toDisplay(data.project?.pmc),
            },
            document: {
              reference_no: data.document.ref || '—',
              revision: data.document.revision || 'R0',
              discipline: data.document.discipline || '—',
              date_issued: formData.date || formData.submittal_date || data.document.issue_date || data.document.created_at || '—',
              response_due: data.document.due_date || '—',
              area_zone: data.document.area || '—',
              workflow_status: data.document.workflow_status || '—',
              approval_status: data.document.approval_status || '—',
            },
            form: {
              ...formData,
              specification_ref: formData.specification_ref || formData.spec_reference || '—',
              package_ref: formData.package_ref || formData.package_reference || '—',
              material_items: materialItems,
              material_rows,
              submittal_type: formData.submittal_type || '—',
              date: formData.date || '—',
              contractor_notes: formData.contractor_notes || '—',
            },
          });
          const pdfBuffer = await generatePdfBuffer(html, { format: 'A4', printBackground: true, preferCSSPageSize: true });
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `${req.query.mode === 'download' ? 'attachment' : 'inline'}; filename="${buildPdfFilename(data.document)}"`);
          res.setHeader('Cache-Control', 'no-store');
          return res.end(pdfBuffer);
        }

        if (normalizedDocumentType === 'TR') {
          const db = getDb();
          const formData = data.document.form_data ? JSON.parse(data.document.form_data) : {};
          const stakeholders = db.prepare('SELECT * FROM project_stakeholders WHERE project_id=? AND active=1 ORDER BY role, is_default_for_role DESC, created_at').all(data.project?.id || '');
          const pickDefault = (role) => stakeholders.find((s) => s.role === role && Number(s.is_default_for_role) === 1) || stakeholders.find((s) => s.role === role) || null;
          const recipient = stakeholders.find((s) => s.id === formData.recipient_stakeholder_id) || pickDefault('Recipient');
          const client = pickDefault('Client / Employer');
          const consultant = pickDefault('Consultant / Engineer');
          const trRows = Array.isArray(formData.transmitted_docs) ? formData.transmitted_docs : (formData.trItems || []);
          const transmitted_docs = trRows.map((row, idx) => `<tr><td>${idx + 1}</td><td>${row.docNo || row.reference || '—'}</td><td>${row.rev || '—'}</td><td>${row.title || row.description || '—'}</td><td>${row.copies || '—'}</td><td>${row.remarks || '—'}</td></tr>`).join('');
          const html = renderTemplateRecord(approvedTemplate, {
            project: {
              name: toDisplay(data.project?.name),
              code: toDisplay(data.project?.code),
              client: client?.company_name || data.project?.client || '—',
              consultant: consultant?.company_name || data.project?.consultant || '—',
              main_contractor: 'Silver Foundation Contracting Company',
              location: toDisplay(data.project?.location),
              contract_no: toDisplay(data.project?.contract_no),
              pmc: toDisplay(data.project?.pmc),
              contract_value: toDisplay(data.project?.contract_value),
              start_date: toDisplay(data.project?.start_date),
              target_completion_date: toDisplay(data.project?.target_completion_date || data.project?.end_date),
            },
            document: {
              reference_no: data.document.ref,
              revision: data.document.revision,
              discipline: data.document.discipline,
              area_zone: data.document.area,
              date_issued: data.document.issue_date,
              response_due: data.document.due_date,
              workflow_status: data.document.workflow_status,
              approval_status: data.document.approval_status,
            },
            form: { ...formData, transmitted_docs, from_company: formData.from_company || 'Silver Foundation Contracting Company', to_company: formData.to_company || recipient?.company_name || '—', attention: formData.attention || recipient?.contact_person || '—', received_by: formData.received_by || `${recipient?.company_name || '—'} / ${recipient?.contact_person || '—'}` },
          });
          const pdfBuffer = await generatePdfBuffer(html, { format: 'A4', printBackground: true, preferCSSPageSize: true });
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `${req.query.mode === 'download' ? 'attachment' : 'inline'}; filename="${buildPdfFilename(data.document)}"`);
          res.setHeader('Cache-Control', 'no-store');
          return res.end(pdfBuffer);
        }
      } catch (error) {
        fallbackUsed = true;
        if (normalizedDocumentType === 'MS') {
          console.warn(`MS DB template not used; fallback reason: ${error.message}`);
        }
        console.warn(`[PDF] DB template render failed for ${normalizedDocumentType}, using fallback renderer | docId=${req.params.id} | message=${error.message}`);
      }
    } else {
      fallbackUsed = true;
      if (normalizedDocumentType === 'MS') {
        console.warn('MS DB template not used; fallback reason: Approved active MS template not found');
      }
    }

    console.log(`[PDF] PDF document type raw: ${rawDocumentType} | PDF document type normalized: ${normalizedDocumentType} | DB template found: ${Boolean(approvedTemplate)} | template_key: ${approvedTemplate?.template_key || 'N/A'} | fallback used: ${fallbackUsed}`);
  }


  return sendPdf(req, res, data.document.type, config.renderer, config.defaultName);
});

Object.entries(DOCUMENT_PDF_RENDERERS).forEach(([type, config]) => {
  router.get(`/documents/:id/${config.slug}`, requireAuth, requireProjectPermission('documents:read'), async (req, res) => sendPdf(req, res, type, config.renderer, config.defaultName));
});

router.get('/schedule/:projectId/gantt', requireAuth, requireProjectPermission('project:read'), async (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!requireProjectMembershipByProjectId(req, res, project.id)) return;

  const activities = db.prepare(`
    SELECT * FROM schedule_activities
    WHERE project_id=?
    ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END, sort_order ASC, planned_start ASC, created_at ASC
  `).all(project.id);

  try {
    const html = renderScheduleGanttPdf({ project, activities });
    const pdfBuffer = await generatePdfBuffer(html, {
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '6mm', right: '6mm', bottom: '6mm', left: '6mm' },
    });
    const filename = `programme-schedule-gantt-${sanitizeFilenamePart(project.code || project.name || project.id, 'project')}.pdf`;
    res.status(200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(pdfBuffer.length));
    console.log(`[PDF] Handover certificate generated | projectId=${project.id} | certificateId=${certificate.id || 'unknown'} | bytes=${pdfBuffer.length}`);
    return res.end(pdfBuffer);
  } catch (error) {
    console.error(`[PDF] Schedule Gantt generation error | projectId=${project.id} | message=${error.message}`);
    return res.status(500).json({ error: 'Schedule Gantt PDF generation failed. Please try again.' });
  }
});

router.get('/schedule/:projectId/table', requireAuth, requireProjectPermission('project:read'), async (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!requireProjectMembershipByProjectId(req, res, project.id)) return;

  const activities = db.prepare(`
    SELECT * FROM schedule_activities
    WHERE project_id=?
    ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END, sort_order ASC, planned_start ASC, created_at ASC
  `).all(project.id);

  try {
    const html = renderScheduleTablePdf({ project, activities });
    const pdfBuffer = await generatePdfBuffer(html, {
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '6mm', right: '6mm', bottom: '6mm', left: '6mm' },
    });
    const filename = `programme-schedule-table-${sanitizeFilenamePart(project.code || project.name || project.id, 'project')}.pdf`;
    res.status(200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(pdfBuffer.length));
    console.log(`[PDF] Handover certificate generated | projectId=${project.id} | certificateId=${certificate.id || 'unknown'} | bytes=${pdfBuffer.length}`);
    return res.end(pdfBuffer);
  } catch (error) {
    console.error(`[PDF] Schedule Table generation error | projectId=${project.id} | message=${error.message}`);
    return res.status(500).json({ error: 'Schedule Table PDF generation failed. Please try again.' });
  }
});


router.get('/handover/:projectId/completion-certificate', requireAuth, requireProjectPermission('handover:read'), async (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!requireProjectMembershipByProjectId(req, res, project.id)) return;
  const certificate = db.prepare(`SELECT * FROM handover_items WHERE project_id=? AND (category='certificate' OR package_name='Project Completion Certificate') LIMIT 1`).get(project.id);
  if (!certificate) return res.status(404).json({ error: 'Certificate record not found' });
  try {
    const project_logos = getProjectLogoDataUrls(project.id);
    if (!project_logos.sfcc) project_logos.sfcc = getDefaultSfccLogoDataUrl() || null;
    const project_stakeholders = getProjectStakeholders(project);
    const headerParties = resolveControlledHeaderParties(project, project_logos, project_stakeholders);
    const html = renderHandoverCompletionCertificatePdf({
      project,
      certificate: { ...certificate, logo_data_url: project_logos.sfcc || '' },
      headerParties,
    });
    const pdfBuffer = await generatePdfBuffer(html, { format: 'A4', printBackground: true, preferCSSPageSize: true });
    const filename = `handover-certificate-${sanitizeFilenamePart(project.code || project.name || project.id, 'project')}.pdf`;
    const disposition = req.query.mode === 'download' ? 'attachment' : 'inline';
    res.status(200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(pdfBuffer.length));
    console.log(`[PDF] Handover certificate generated | projectId=${project.id} | certificateId=${certificate.id || 'unknown'} | bytes=${pdfBuffer.length}`);
    return res.end(pdfBuffer);
  } catch (error) {
    console.error(`[PDF] Handover certificate generation error | projectId=${project.id} | certificateId=${certificate.id || 'unknown'} | message=${error.message}`);
    if (error?.stack) console.error(error.stack);
    return res.status(500).json({ error: 'Handover certificate PDF generation failed.' });
  }
});

module.exports = router;
function toDataUrl(filePath, mimeType) {
  if (!filePath) return null;
  const normalized = path.resolve(String(filePath));
  if (!fs.existsSync(normalized)) return null;
  const allowedMimes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const resolvedMime = String(mimeType || '').toLowerCase();
  if (!allowedMimes.has(resolvedMime)) return null;
  try {
    const imageBuffer = fs.readFileSync(normalized);
    return `data:${resolvedMime};base64,${imageBuffer.toString('base64')}`;
  } catch (error) {
    console.warn(`[PDF] logo file unreadable | message=${error.message}`);
    return null;
  }
}
