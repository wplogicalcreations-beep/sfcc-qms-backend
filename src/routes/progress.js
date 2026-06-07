const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/schema');
const { createNotification } = require('../services/notificationService');
const { requireAuth, requireProjectAccess, requireProjectPermission, requireProjectMembershipByProjectId, requireProjectAccessByRecord, normalizeRole } = require('../middleware/auth');
const { createUploader, handleUploadError, sanitizeOriginalFilename } = require('../middleware/uploadSecurity');

const router = express.Router();
const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';
const upload = createUploader({ type: 'progressPhotos', destinationDir: path.join(UPLOADS_DIR, 'progress') });

const REPORT_TYPES = new Set(['daily', 'weekly']);
const WORKFLOW_STATUSES = new Set(['draft', 'issued', 'closed']);
const LINKABLE_DOC_TYPES = new Set(['MS', 'DS', 'RFI', 'IR', 'SI', 'TR', 'NCR', 'VO', 'HC', 'Handover Certificate']);
const INTERNAL_ROLES = new Set(['system_admin', 'project_manager', 'pmo', 'qa_qc_engineer', 'project_engineer', 'site_engineer', 'viewer']);

function normalizeReportType(value) {
  const v = String(value || '').toLowerCase().includes('week') ? 'weekly' : 'daily';
  return REPORT_TYPES.has(v) ? v : 'daily';
}

function normalizeWorkflowStatus(value) {
  const v = String(value || 'draft').toLowerCase();
  return WORKFLOW_STATUSES.has(v) ? v : 'draft';
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function textOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function safeJson(value) {
  return JSON.stringify(value && typeof value === 'object' ? value : {});
}

function displayStatus(status) {
  const s = normalizeWorkflowStatus(status);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getProject(db, projectId) {
  return db.prepare('SELECT id, code, name FROM projects WHERE id=?').get(projectId);
}

function maxExistingSequence(db, projectId, reportType) {
  const token = reportType === 'weekly' ? 'WPR' : 'DPR';
  const rows = db.prepare('SELECT report_no, ref FROM progress_reports WHERE project_id=? AND report_type=?').all(projectId, reportType);
  return rows.reduce((max, row) => {
    const raw = String(row.report_no || row.ref || '');
    const match = raw.match(new RegExp(`${token}-(\\d+)$`, 'i'));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

function nextReportNo(db, project, reportType) {
  const docType = reportType === 'weekly' ? 'PROGRESS_WPR' : 'PROGRESS_DPR';
  const token = reportType === 'weekly' ? 'WPR' : 'DPR';
  const counter = db.prepare(`
    INSERT INTO numbering_counters (id, project_id, doc_type, discipline_code, current_val, created_at, updated_at)
    VALUES (?, ?, ?, 'GEN', 1, datetime('now'), datetime('now'))
    ON CONFLICT(project_id, doc_type, discipline_code)
    DO UPDATE SET current_val = numbering_counters.current_val + 1, updated_at = datetime('now')
    RETURNING current_val
  `).get(uuidv4(), project.id, docType);
  let next = Number(counter?.current_val || 1);
  const existingMax = maxExistingSequence(db, project.id, reportType);
  if (next <= existingMax) {
    next = existingMax + 1;
    db.prepare('UPDATE numbering_counters SET current_val=?, updated_at=datetime(\'now\') WHERE project_id=? AND doc_type=? AND discipline_code=\'GEN\'')
      .run(next, project.id, docType);
  }
  return `${project.code || 'PRJ'}-${token}-${String(next).padStart(3, '0')}`;
}

function mapReport(row) {
  if (!row) return null;
  const fields = parseJson(row.fields_json, {});
  return {
    ...row,
    report_no: row.report_no || row.ref,
    ref: row.ref || row.report_no,
    report_type: normalizeReportType(row.report_type),
    workflow_status: normalizeWorkflowStatus(row.workflow_status || row.status),
    status: displayStatus(row.workflow_status || row.status),
    fields,
    linked_qms_count: Number(row.linked_qms_count || 0),
    linked_schedule_count: Number(row.linked_schedule_count || 0),
  };
}

function baseReportQuery(whereSql) {
  return `
    SELECT pr.*,
      p.name AS project_name,
      p.code AS project_code,
      COALESCE(u.name, u.email, pr.prepared_by) AS prepared_by_name,
      (SELECT COUNT(*) FROM progress_report_documents prd WHERE prd.report_id=pr.id) AS linked_qms_count,
      (SELECT COUNT(*) FROM progress_report_schedule_items prs WHERE prs.report_id=pr.id) AS linked_schedule_count
    FROM progress_reports pr
    LEFT JOIN projects p ON p.id=pr.project_id
    LEFT JOIN users u ON u.id=pr.prepared_by OR u.id=pr.created_by
    ${whereSql}
  `;
}

function linkedDocuments(db, reportId) {
  return db.prepare(`
    SELECT d.id, d.ref, d.type, d.title, d.revision, d.workflow_status, d.approval_status, d.evidence_status, prd.created_at AS linked_at
    FROM progress_report_documents prd
    JOIN documents d ON d.id=prd.document_id
    WHERE prd.report_id=?
    ORDER BY d.type, d.ref
  `).all(reportId);
}

function linkedInspections(db, report) {
  const fields = parseJson(report.fields_json, {});
  const selectedIds = Array.isArray(fields.selected_inspection_ids) ? [...new Set(fields.selected_inspection_ids.filter(Boolean))] : [];
  let rows = [];
  if (fields.inspection_selection_locked && selectedIds.length === 0) return rows;
  if (selectedIds.length) {
    const placeholders = selectedIds.map(() => '?').join(',');
    rows = db.prepare(`
      SELECT id, ref, title, discipline, area, workflow_status, approval_status, evidence_status, issue_date AS requested_date, due_date, closed_date, notes AS remarks, updated_at, created_at
      FROM documents
      WHERE project_id=? AND type='IR' AND id IN (${placeholders})
      ORDER BY COALESCE(issue_date, updated_at, created_at) ASC, ref ASC
    `).all(report.project_id, ...selectedIds);
  } else {
    const start = report.report_type === 'weekly' ? report.week_start : report.report_date;
    const end = report.report_type === 'weekly' ? report.week_end : report.report_date;
    if (start && end) {
      rows = db.prepare(`
        SELECT id, ref, title, discipline, area, workflow_status, approval_status, evidence_status, issue_date AS requested_date, due_date, closed_date, notes AS remarks, updated_at, created_at
        FROM documents
        WHERE project_id=? AND type='IR' AND date(COALESCE(issue_date, updated_at, created_at)) BETWEEN date(?) AND date(?)
        ORDER BY COALESCE(issue_date, updated_at, created_at) ASC, ref ASC
      `).all(report.project_id, start, end);
    }
  }
  return rows;
}

function photoViewUrl(reportId, photoId) {
  return `/api/progress/${reportId}/photos/${photoId}/view`;
}

function mapPhoto(row) {
  return {
    ...row,
    view_url: photoViewUrl(row.report_id, row.id),
    file_url: photoViewUrl(row.report_id, row.id),
  };
}

function linkedPhotos(db, reportId) {
  return db.prepare('SELECT * FROM progress_photos WHERE report_id=? ORDER BY COALESCE(taken_at, uploaded_at, created_at) ASC').all(reportId).map(mapPhoto);
}

function linkedScheduleItems(db, reportId) {
  return db.prepare(`
    SELECT prs.id AS link_id, prs.manual_reference, sa.id, sa.activity_id, sa.activity_name, sa.progress_percent AS actual_progress,
      NULL AS planned_progress, NULL AS variance, sa.status, sa.planned_start, sa.planned_finish, prs.created_at AS linked_at
    FROM progress_report_schedule_items prs
    LEFT JOIN schedule_activities sa ON sa.id=prs.schedule_item_id
    WHERE prs.report_id=?
    ORDER BY prs.created_at ASC
  `).all(reportId).map((row) => {
    const planned = row.planned_progress === null || row.planned_progress === undefined ? null : Number(row.planned_progress);
    const actual = row.actual_progress === null || row.actual_progress === undefined ? null : Number(row.actual_progress);
    return { ...row, variance: planned === null || actual === null ? null : actual - planned };
  });
}

function getReportWithLinks(db, id) {
  const report = mapReport(db.prepare(baseReportQuery('WHERE pr.id=?')).get(id));
  if (!report) return null;
  return { ...report, linked_documents: linkedDocuments(db, id), linked_schedule_items: linkedScheduleItems(db, id), inspections: linkedInspections(db, report), photos: linkedPhotos(db, id) };
}

function getInternalRecipients(db, projectId) {
  const rows = db.prepare(`
    SELECT DISTINCT u.id, u.role
    FROM users u
    LEFT JOIN project_memberships pm ON pm.user_id=u.id AND pm.project_id=? AND pm.is_active=1
    WHERE u.is_active=1
      AND (pm.user_id IS NOT NULL OR LOWER(CASE WHEN u.role='document_controller' THEN 'pmo' WHEN u.role='engineer' THEN 'project_engineer' WHEN u.role='hse_officer' THEN 'site_engineer' WHEN u.role='approver' THEN 'qa_qc_engineer' ELSE u.role END) IN ('system_admin','project_manager','pmo','qa_qc_engineer','project_engineer','site_engineer'))
  `).all(projectId);
  return [...new Set(rows
    .filter((u) => INTERNAL_ROLES.has(normalizeRole(u.role)))
    .map((u) => u.id)
    .filter(Boolean))];
}

function progressNotificationTitle(report, status) {
  const prefix = report.report_type === 'weekly' ? 'Weekly' : 'Daily';
  if (status === 'draft') return `${prefix} Progress Report Draft Created`;
  if (status === 'issued') return `${prefix} Progress Report Issued`;
  if (status === 'closed') return `${prefix} Progress Report Closed`;
  return `${prefix} Progress Report Updated`;
}

function createProgressNotification(db, report, status) {
  const normalizedStatus = normalizeWorkflowStatus(status);
  const title = progressNotificationTitle(report, normalizedStatus);
  const message = `${report.report_no || report.ref} for ${report.project_name || report.project_code || 'the project'} is ${displayStatus(normalizedStatus)}.`;
  const severity = normalizedStatus === 'closed' ? 'success' : normalizedStatus === 'issued' ? 'info' : 'warning';
  getInternalRecipients(db, report.project_id).forEach((recipient_user_id) => {
    createNotification(db, {
      project_id: report.project_id,
      recipient_user_id,
      source_type: 'progress_report',
      source_id: report.id,
      title,
      message,
      severity,
      action_url: `/projects/${report.project_id}/progress`,
    });
  });
}

function notifyCreated(db, report) {
  createProgressNotification(db, report, normalizeWorkflowStatus(report.workflow_status));
}

function notifyStatusChange(db, report, previousStatus) {
  const status = normalizeWorkflowStatus(report.workflow_status);
  if (!['issued', 'closed'].includes(status) || status === normalizeWorkflowStatus(previousStatus)) return;
  createProgressNotification(db, report, status);
}

function replaceLinks(db, reportId, projectId, documentIds = [], scheduleItemIds = [], manualRefs = []) {
  db.prepare('DELETE FROM progress_report_documents WHERE report_id=?').run(reportId);
  [...new Set((documentIds || []).filter(Boolean))].forEach((documentId) => {
    const doc = db.prepare('SELECT id, type FROM documents WHERE id=? AND project_id=?').get(documentId, projectId);
    if (doc && LINKABLE_DOC_TYPES.has(doc.type)) {
      db.prepare('INSERT OR IGNORE INTO progress_report_documents (id, report_id, document_id) VALUES (?,?,?)').run(uuidv4(), reportId, documentId);
    }
  });

  db.prepare('DELETE FROM progress_report_schedule_items WHERE report_id=?').run(reportId);
  [...new Set((scheduleItemIds || []).filter(Boolean))].forEach((scheduleItemId) => {
    const item = db.prepare('SELECT id FROM schedule_activities WHERE id=? AND project_id=?').get(scheduleItemId, projectId);
    if (item) db.prepare('INSERT OR IGNORE INTO progress_report_schedule_items (id, report_id, schedule_item_id) VALUES (?,?,?)').run(uuidv4(), reportId, scheduleItemId);
  });
  (manualRefs || []).map(textOrNull).filter(Boolean).forEach((manualRef) => {
    db.prepare('INSERT INTO progress_report_schedule_items (id, report_id, manual_reference) VALUES (?,?,?)').run(uuidv4(), reportId, manualRef);
  });
}

function reportPayload(body, fallback = {}) {
  const reportType = normalizeReportType(body.report_type ?? fallback.report_type);
  const planned = numberOrNull(body.planned_progress ?? fallback.planned_progress);
  const actual = numberOrNull(body.actual_progress ?? fallback.actual_progress);
  const variance = numberOrNull(body.variance) ?? (planned !== null && actual !== null ? actual - planned : null);
  return {
    report_type: reportType,
    report_date: textOrNull(body.report_date ?? fallback.report_date),
    week_start: textOrNull(body.week_start ?? fallback.week_start),
    week_end: textOrNull(body.week_end ?? fallback.week_end),
    week_number: textOrNull(body.week_number ?? fallback.week_number),
    prepared_by: textOrNull(body.prepared_by ?? fallback.prepared_by),
    workflow_status: normalizeWorkflowStatus(body.workflow_status ?? body.status ?? fallback.workflow_status ?? fallback.status),
    overall_pct: numberOrNull(body.overall_pct ?? fallback.overall_pct),
    planned_progress: planned,
    actual_progress: actual,
    variance,
    schedule_status: textOrNull(body.schedule_status ?? fallback.schedule_status),
    risk_status: textOrNull(body.risk_status ?? fallback.risk_status),
    general_remarks: textOrNull(body.general_remarks ?? fallback.general_remarks),
    fields_json: safeJson(body.fields ?? parseJson(fallback.fields_json, {})),
    manual_schedule_remarks: textOrNull(body.manual_schedule_remarks ?? fallback.manual_schedule_remarks),
  };
}

router.get('/options', requireAuth, requireProjectPermission('progress:read'), requireProjectAccess, (req, res) => {
  const db = getDb();
  const { project_id } = req.query;
  const documents = db.prepare(`
    SELECT id, ref, type, title, revision, workflow_status, approval_status, evidence_status
    FROM documents
    WHERE project_id=? AND type IN ('MS','DS','RFI','IR','SI','TR','NCR','VO','HC','Handover Certificate')
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 500
  `).all(project_id);
  const inspections = db.prepare(`
    SELECT id, ref, title, discipline, area, workflow_status, approval_status, evidence_status, issue_date AS requested_date, due_date, closed_date, notes AS remarks, updated_at, created_at
    FROM documents
    WHERE project_id=? AND type='IR'
    ORDER BY COALESCE(issue_date, updated_at, created_at) DESC, ref DESC
    LIMIT 500
  `).all(project_id);
  const disciplineRows = db.prepare(`
    SELECT discipline AS value FROM documents WHERE project_id=? AND TRIM(COALESCE(discipline,''))<>''
    UNION
    SELECT discipline AS value FROM handover_items WHERE project_id=? AND TRIM(COALESCE(discipline,''))<>''
    ORDER BY value
  `).all(project_id, project_id);
  const disciplines = disciplineRows.map((row) => row.value);
  const schedule = db.prepare(`
    SELECT id, activity_id, activity_name, progress_percent, status, planned_start, planned_finish
    FROM schedule_activities
    WHERE project_id=?
    ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END, sort_order ASC, planned_start ASC
    LIMIT 500
  `).all(project_id);
  res.json({ documents, schedule, inspections, disciplines });
});

router.get('/', requireAuth, requireProjectPermission('progress:read'), requireProjectAccess, (req, res) => {
  const db = getDb();
  const { project_id, report_type, q, status } = req.query;
  const where = ['pr.project_id=?'];
  const params = [project_id];
  if (report_type) { where.push('pr.report_type=?'); params.push(normalizeReportType(report_type)); }
  if (status) { where.push('LOWER(COALESCE(pr.workflow_status, pr.status))=?'); params.push(normalizeWorkflowStatus(status)); }
  if (q) {
    where.push('(pr.report_no LIKE ? OR pr.ref LIKE ? OR p.name LIKE ? OR pr.prepared_by LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const reports = db.prepare(`${baseReportQuery(`WHERE ${where.join(' AND ')}`)} ORDER BY datetime(pr.updated_at) DESC, pr.report_date DESC`).all(...params).map(mapReport);
  res.json(reports);
});

router.post('/', requireAuth, requireProjectAccess, requireProjectPermission('progress:create'), (req, res) => {
  const db = getDb();
  const { project_id } = req.body;
  if (!project_id) return res.status(400).json({ error: 'project_id required' });
  const project = getProject(db, project_id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    const id = uuidv4();
    const payload = reportPayload({ ...req.body, prepared_by: req.body.prepared_by || req.user.id });
    if (payload.report_type === 'daily' && !payload.report_date) throw new Error('Report date is required for Daily Progress Reports');
    if (payload.report_type === 'weekly' && (!payload.week_start || !payload.week_end)) throw new Error('Week start and week end are required for Weekly Progress Reports');
    const reportNo = req.body.report_no ? textOrNull(req.body.report_no) : nextReportNo(db, project, payload.report_type);
    db.prepare(`
      INSERT INTO progress_reports (id, project_id, ref, report_no, report_type, report_date, week_start, week_end, week_number, period_from, period_to,
        prepared_by, workflow_status, status, overall_pct, planned_progress, actual_progress, variance, schedule_status, risk_status,
        general_remarks, fields_json, manual_schedule_remarks, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
    `).run(id, project_id, reportNo, reportNo, payload.report_type, payload.report_date, payload.week_start, payload.week_end, payload.week_number,
      payload.report_type === 'daily' ? payload.report_date : payload.week_start, payload.report_type === 'daily' ? payload.report_date : payload.week_end,
      payload.prepared_by, payload.workflow_status, displayStatus(payload.workflow_status), payload.overall_pct, payload.planned_progress, payload.actual_progress,
      payload.variance, payload.schedule_status, payload.risk_status, payload.general_remarks, payload.fields_json, payload.manual_schedule_remarks, req.user.id);
    replaceLinks(db, id, project_id, req.body.document_ids, req.body.schedule_item_ids, req.body.manual_schedule_references);
    if (payload.overall_pct !== null) db.prepare('UPDATE projects SET progress=?, updated_at=? WHERE id=?').run(payload.overall_pct, new Date().toISOString(), project_id);
    const saved = getReportWithLinks(db, id);
    notifyCreated(db, saved);
    db.exec('COMMIT');
    res.status(201).json(saved);
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: e.message });
  }
});

router.get('/:id', requireAuth, requireProjectPermission('progress:read'), (req, res) => {
  const db = getDb();
  const access = requireProjectAccessByRecord(req, res, 'SELECT project_id FROM progress_reports WHERE id=?', [req.params.id]);
  if (!access) return;
  const report = getReportWithLinks(db, req.params.id);
  if (!report) return res.status(404).json({ error: 'Progress report not found' });
  res.json(report);
});

router.patch('/:id', requireAuth, requireProjectPermission('progress:update'), (req, res) => {
  const db = getDb();
  const existing = requireProjectAccessByRecord(req, res, 'SELECT * FROM progress_reports WHERE id=?', [req.params.id]);
  if (!existing) return;
  const payload = reportPayload(req.body, existing);
  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.prepare(`
      UPDATE progress_reports SET report_date=?, week_start=?, week_end=?, week_number=?, period_from=?, period_to=?, prepared_by=?,
        workflow_status=?, status=?, overall_pct=?, planned_progress=?, actual_progress=?, variance=?, schedule_status=?, risk_status=?,
        general_remarks=?, fields_json=?, manual_schedule_remarks=?, updated_at=datetime('now')
      WHERE id=?
    `).run(payload.report_date, payload.week_start, payload.week_end, payload.week_number,
      payload.report_type === 'daily' ? payload.report_date : payload.week_start, payload.report_type === 'daily' ? payload.report_date : payload.week_end,
      payload.prepared_by, payload.workflow_status, displayStatus(payload.workflow_status), payload.overall_pct, payload.planned_progress, payload.actual_progress,
      payload.variance, payload.schedule_status, payload.risk_status, payload.general_remarks, payload.fields_json, payload.manual_schedule_remarks, req.params.id);
    replaceLinks(db, req.params.id, existing.project_id, req.body.document_ids, req.body.schedule_item_ids, req.body.manual_schedule_references);
    if (payload.overall_pct !== null) db.prepare('UPDATE projects SET progress=?, updated_at=? WHERE id=?').run(payload.overall_pct, new Date().toISOString(), existing.project_id);
    const saved = getReportWithLinks(db, req.params.id);
    notifyStatusChange(db, saved, existing.workflow_status || existing.status);
    db.exec('COMMIT');
    res.json(saved);
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: e.message });
  }
});

router.post('/:id/photos', requireAuth, requireProjectPermission('progress:update'), (req, res, next) => upload.array('photos', 20)(req, res, next), handleUploadError, (req, res) => {
  try {
    const db = getDb();
    const report = requireProjectAccessByRecord(req, res, 'SELECT project_id FROM progress_reports WHERE id=?', [req.params.id]);
    if (!report) return;
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Missing file' });
    const arrayBody = (key) => Array.isArray(req.body[key]) ? req.body[key] : [req.body[key] || ''];
    const captionArr = arrayBody('captions');
    const areaArr = arrayBody('area_locations');
    const disciplineArr = arrayBody('disciplines');
    const takenArr = arrayBody('taken_ats');
    const remarksArr = arrayBody('remarks');
    const saved = [];
    req.files.forEach((file, i) => {
      const id = uuidv4();
      db.prepare(`INSERT INTO progress_photos (id,report_id,project_id,caption,area_location,discipline,taken_at,remarks,stored_name,original_name,mime_type,file_size,uploaded_by,created_at,uploaded_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`).run(
        id, req.params.id, report.project_id, captionArr[i] || '', areaArr[i] || '', disciplineArr[i] || '', takenArr[i] || null, remarksArr[i] || '', file.filename, sanitizeOriginalFilename(file.originalname), file.mimetype, file.size, req.user.id
      );
      saved.push(mapPhoto({ id, report_id: req.params.id, project_id: report.project_id, original_name: sanitizeOriginalFilename(file.originalname), stored_name: file.filename, caption: captionArr[i] || '', area_location: areaArr[i] || '', discipline: disciplineArr[i] || '', taken_at: takenArr[i] || '', remarks: remarksArr[i] || '', mime_type: file.mimetype, file_size: file.size }));
    });
    res.status(201).json(saved);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


router.patch('/:id/photos/:photoId', requireAuth, requireProjectPermission('progress:update'), (req, res) => {
  const db = getDb();
  const photo = db.prepare('SELECT p.*, r.project_id FROM progress_photos p JOIN progress_reports r ON r.id=p.report_id WHERE p.id=? AND p.report_id=?').get(req.params.photoId, req.params.id);
  if (!photo) return res.status(404).json({ error: 'Not found' });
  if (!requireProjectMembershipByProjectId(req, res, photo.project_id)) return;
  const next = {
    caption: textOrNull(req.body.caption) || '',
    area_location: textOrNull(req.body.area_location) || '',
    discipline: textOrNull(req.body.discipline) || '',
    taken_at: textOrNull(req.body.taken_at),
    remarks: textOrNull(req.body.remarks) || '',
  };
  db.prepare(`UPDATE progress_photos SET caption=?, area_location=?, discipline=?, taken_at=?, remarks=? WHERE id=? AND report_id=?`)
    .run(next.caption, next.area_location, next.discipline, next.taken_at, next.remarks, req.params.photoId, req.params.id);
  res.json(mapPhoto({ ...photo, ...next }));
});

router.delete('/:id/photos/:photoId', requireAuth, requireProjectPermission('progress:update'), (req, res) => {
  const db = getDb();
  const photo = db.prepare('SELECT p.*, r.project_id FROM progress_photos p JOIN progress_reports r ON r.id=p.report_id WHERE p.id=? AND p.report_id=?').get(req.params.photoId, req.params.id);
  if (!photo) return res.status(404).json({ error: 'Not found' });
  if (!requireProjectMembershipByProjectId(req, res, photo.project_id)) return;
  db.prepare('DELETE FROM progress_photos WHERE id=? AND report_id=?').run(req.params.photoId, req.params.id);
  const safeName = path.basename(photo.stored_name || '');
  const filePath = path.resolve(UPLOADS_DIR, 'progress', safeName);
  if (safeName && filePath.startsWith(path.resolve(UPLOADS_DIR, 'progress')) && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ ok: true });
});

router.get('/:id/photos/:photoId/view', requireAuth, requireProjectPermission('progress:read'), (req, res) => {
  const db = getDb();
  const photo = db.prepare('SELECT p.*, r.project_id FROM progress_photos p JOIN progress_reports r ON r.id=p.report_id WHERE p.id=? AND p.report_id=?').get(req.params.photoId, req.params.id);
  if (!photo) return res.status(404).json({ error: 'Not found' });
  if (!requireProjectMembershipByProjectId(req, res, photo.project_id)) return;
  const safeName = path.basename(photo.stored_name);
  const filePath = path.resolve(UPLOADS_DIR, 'progress', safeName);
  if (!filePath.startsWith(path.resolve(UPLOADS_DIR, 'progress'))) return res.status(400).json({ error: 'Invalid file path' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(filePath);
});

module.exports = router;
