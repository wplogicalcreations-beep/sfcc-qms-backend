const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { requireAuth, requireProjectAccess, requireProjectPermission, requireProjectMembershipByProjectId, requireProjectAccessByRecord, ROLES, canPerform, getPermissionValue } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');
const { createUploader, handleUploadError, sanitizeOriginalFilename } = require('../middleware/uploadSecurity');
const { createForProjectMembers } = require('../services/notificationService');

const router = express.Router();

const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';
const upload = createUploader({ type: 'documents', destinationDir: UPLOADS_DIR });

const VALID_WF = ['Draft', 'Ready for Issue', 'Issued', 'Under Review', 'Response Received', 'Closed', 'Superseded', 'Cancelled'];
const VALID_AP = ['Not Submitted', 'Submitted', 'Approved', 'Approved as Noted', 'Revise and Resubmit', 'Rejected'];
const VALID_EV = ['No Evidence', 'Pending Upload', 'Uploaded', 'Verified'];
const FINAL_WORKFLOW = new Set(['Closed', 'Superseded', 'Cancelled']);
const FINAL_APPROVAL = new Set(['Approved', 'Approved as Noted']);
const REVISION_PATTERN = /^R(\d+)$/i;
const MAX_REFERENCE_ALLOCATION_ATTEMPTS = 50;

const DOC_TYPE_CODES = { MS:'MS', DS:'DS', RFI:'RFI', IR:'IR', NCR:'NCR', TR:'TR', SI:'SI', VO:'VO' };

const DOC_TYPE_ALIASES = {
  'MATERIAL SUBMITTAL': 'MS',
  'DRAWING SUBMITTAL': 'DS',
  'REQUEST FOR INFORMATION': 'RFI',
  'INSPECTION REQUEST': 'IR',
  'NON CONFORMANCE REPORT': 'NCR',
  'NON-CONFORMANCE REPORT': 'NCR',
  TRANSMITTAL: 'TR',
  'SITE INSTRUCTION': 'SI',
  'VARIATION ORDER': 'VO',
};

function normalizeDocType(raw = '') {
  const cleaned = String(raw || '').trim().toUpperCase();
  if (!cleaned) return 'GEN';
  return DOC_TYPE_CODES[cleaned] || DOC_TYPE_ALIASES[cleaned] || cleaned.replace(/[^A-Z0-9]/g, '') || 'GEN';
}

function resolveDisciplineCode({ disciplineCode, discipline }) {
  const normalizedCode = normalizeDisciplineCode(disciplineCode);
  if (normalizedCode !== 'GEN') return normalizedCode;
  return normalizeDisciplineCode(discipline || disciplineCode || 'GEN');
}

function normalizeDisciplineCode(raw='') {
  const v = String(raw || '').trim().toUpperCase();
  if (v.includes('HVAC') || v === 'MECHANICAL') return 'HVAC';
  if (v === 'MEP') return 'MEP';
  if (v.includes('ELECTR')) return 'ELEC';
  if (v.includes('CIVIL') || v.includes('STRUCT')) return 'CIV';
  if (v.includes('ARCH')) return 'ARCH';
  if (v.includes('PLUMB') || v.includes('DRAIN')) return 'PLB';
  if (v.includes('FIRE')) return 'FF';
  if (v.includes('ELV')) return 'ELV';
  if (v.includes('LAND')) return 'LAND';
  return 'GEN';
}

const WORKFLOW_TRANSITIONS = {
  Draft: ['Ready for Issue', 'Cancelled'],
  'Ready for Issue': ['Issued', 'Cancelled'],
  Issued: ['Under Review', 'Response Received', 'Cancelled'],
  'Under Review': ['Response Received', 'Revise and Resubmit', 'Cancelled'],
  'Response Received': ['Closed', 'Ready for Issue', 'Superseded', 'Cancelled'],
  Closed: [],
  Superseded: [],
  Cancelled: [],
};

function insertHistory(db, { docId, userId, action, oldValue = null, newValue = null }) {
  db.prepare(`
    INSERT INTO doc_history (id,doc_id,action,old_value,new_value,performed_by,user_id,performed_at,timestamp)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(uuidv4(), docId, action, oldValue, newValue, userId, userId, new Date().toISOString(), new Date().toISOString());
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractDocumentSequence(ref, { projectCode, docTypeCode, disciplineCode }) {
  const pattern = new RegExp(`^${escapeRegExp(projectCode)}-${escapeRegExp(docTypeCode)}-${escapeRegExp(disciplineCode)}-(\\d+)-R\\d+$`, 'i');
  const match = String(ref || '').trim().match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function maxExistingDocumentSequence(db, { projectId, projectCode, docType, docTypeCode, disciplineCode }) {
  const normalizedType = normalizeDocType(docType);
  const rows = db.prepare('SELECT ref, type FROM documents WHERE project_id=?').all(projectId);
  let max = 0;

  for (const row of rows) {
    if (normalizeDocType(row.type) !== normalizedType) continue;
    const seq = extractDocumentSequence(row.ref, { projectCode, docTypeCode, disciplineCode });
    if (seq !== null && seq > max) max = seq;
  }

  return max;
}

function alignNumberingCounter(db, { projectId, docType, disciplineCode, maxExisting }) {
  const normalizedType = normalizeDocType(docType);
  const resolvedDisciplineCode = resolveDisciplineCode({ disciplineCode, discipline: disciplineCode });
  const safeMax = Math.max(0, Number(maxExisting || 0));

  db.prepare(`
    INSERT INTO numbering_counters (id, project_id, doc_type, discipline_code, current_val, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(project_id, doc_type, discipline_code)
    DO UPDATE SET
      current_val = CASE
        WHEN numbering_counters.current_val < excluded.current_val THEN excluded.current_val
        ELSE numbering_counters.current_val
      END,
      updated_at = datetime('now')
  `).run(uuidv4(), projectId, normalizedType, resolvedDisciplineCode, safeMax);
}

function getNextSequence(db, { projectId, docType, disciplineCode, minCurrentVal = 0 }) {
  const normalizedType = normalizeDocType(docType);
  const resolvedDisciplineCode = resolveDisciplineCode({ disciplineCode, discipline: disciplineCode });
  alignNumberingCounter(db, { projectId, docType: normalizedType, disciplineCode: resolvedDisciplineCode, maxExisting: minCurrentVal });

  const row = db.prepare(`
    UPDATE numbering_counters
    SET current_val = current_val + 1, updated_at = datetime('now')
    WHERE project_id=? AND doc_type=? AND discipline_code=?
    RETURNING current_val
  `).get(projectId, normalizedType, resolvedDisciplineCode);

  return Number(row?.current_val || 0);
}

function documentReferenceExists(db, { projectId, type, ref }) {
  const row = db.prepare('SELECT id FROM documents WHERE project_id=? AND type=? AND ref=? LIMIT 1').get(projectId, type, ref);
  return Boolean(row);
}

function allocateUniqueDocumentReference(db, { projectId, projectCode, type, disciplineCode }) {
  const normalizedType = normalizeDocType(type);
  const docTypeCode = DOC_TYPE_CODES[normalizedType] || normalizedType;
  const resolvedDisciplineCode = resolveDisciplineCode({ disciplineCode, discipline: disciplineCode });
  let maxExisting = maxExistingDocumentSequence(db, {
    projectId,
    projectCode,
    docType: normalizedType,
    docTypeCode,
    disciplineCode: resolvedDisciplineCode,
  });

  for (let attempt = 1; attempt <= MAX_REFERENCE_ALLOCATION_ATTEMPTS; attempt += 1) {
    const nextSeq = getNextSequence(db, {
      projectId,
      docType: normalizedType,
      disciplineCode: resolvedDisciplineCode,
      minCurrentVal: maxExisting,
    });
    const seq = String(nextSeq).padStart(3, '0');
    const ref = `${projectCode}-${docTypeCode}-${resolvedDisciplineCode}-${seq}-R0`;

    if (!documentReferenceExists(db, { projectId, type: normalizedType, ref })) {
      return { ref, normalizedType, disciplineCode: resolvedDisciplineCode, sequence: nextSeq, attempts: attempt };
    }

    if (nextSeq > maxExisting) maxExisting = nextSeq;
  }

  const error = new Error('Unable to allocate unique document reference. Please contact System Admin.');
  error.code = 'DOCUMENT_REFERENCE_ALLOCATION_FAILED';
  throw error;
}

function parseRevision(value) {
  const match = String(value || '').trim().match(REVISION_PATTERN);
  return match ? Number(match[1]) : null;
}

function hasEvidenceAttachment(db, docId) {
  const row = db.prepare('SELECT COUNT(*) as c FROM attachments WHERE doc_id=?').get(docId);
  return Number(row?.c || 0) > 0;
}

// GET /api/documents?project_id=&type=&workflow_status=&approval_status=&discipline=&q=&page=&pageSize=
router.get('/', requireAuth, requireProjectPermission('documents:read'), (req, res) => {
  const db = getDb();
  const { project_id, type, workflow_status, approval_status, evidence_status, discipline, q, page = 1, pageSize = 100 } = req.query;

  let where = [];
  let params = [];

  if (project_id) { where.push('project_id=?'); params.push(project_id); }
  if (type) { where.push('type=?'); params.push(type); }
  if (workflow_status) { where.push('workflow_status=?'); params.push(workflow_status); }
  if (approval_status) { where.push('approval_status=?'); params.push(approval_status); }
  if (evidence_status) { where.push('evidence_status=?'); params.push(evidence_status); }
  if (discipline) { where.push('discipline=?'); params.push(discipline); }
  if (q) {
    where.push('(title LIKE ? OR ref LIKE ? OR area LIKE ? OR supplier LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const offset = (page - 1) * pageSize;

  if (getPermissionValue(req.user.role, 'projects.view') !== 'All Projects') {
    const memberships = db.prepare('SELECT project_id FROM project_memberships WHERE user_id=? AND is_active=1').all(req.user.id).map((m) => m.project_id);
    if (project_id && !memberships.includes(project_id)) return res.status(403).json({ error: 'No access to this project' });
    if (!project_id) {
      if (memberships.length === 0) return res.json({ total: 0, page: Number(page), pageSize: Number(pageSize), data: [] });
      where.push(`project_id IN (${memberships.map(() => '?').join(',')})`);
      params.push(...memberships);
    }
  }

  const finalWhereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as c FROM documents ${finalWhereStr}`).get(...params).c;
  const docs = db.prepare(`SELECT documents.*, (SELECT COUNT(*) FROM attachments WHERE attachments.doc_id=documents.id) AS attachment_count FROM documents ${finalWhereStr} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, Number(pageSize), Number(offset));

  res.json({ total, page: Number(page), pageSize: Number(pageSize), data: docs });
});

// POST /api/documents
router.post('/', requireAuth, requireProjectAccess, requireProjectPermission('documents:create'), (req, res) => {
  try {
    const db = getDb();
    const { project_id, type, discipline, discipline_code, title, description, supplier, area, severity, commercial_value, due_date, notes, form_data } = req.body;

    if (!project_id || !type || !title) return res.status(400).json({ error: 'project_id, type, title required' });

    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    let created;
    try {
      const discCode = resolveDisciplineCode({ disciplineCode: discipline_code, discipline });
      const project = db.prepare('SELECT code FROM projects WHERE id=?').get(project_id);
      if (!project) throw new Error('Project not found');
      const { ref, normalizedType } = allocateUniqueDocumentReference(db, {
        projectId: project_id,
        projectCode: project.code,
        type,
        disciplineCode: discCode,
      });

      const id = uuidv4();
      db.prepare(`
        INSERT INTO documents (id,project_id,ref,type,discipline,title,description,supplier,area,severity,commercial_value,revision,issue_date,due_date,notes,form_data,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(id, project_id, ref, normalizedType, discipline||'', title, description||'', supplier||'', area||'', severity||'', commercial_value||0, 'R0', new Date().toISOString().split('T')[0], due_date||null, notes||'', form_data||null, req.user.id);
      insertHistory(db, { docId: id, userId: req.user.id, action: 'created', newValue: JSON.stringify({ ref, workflow_status: 'Draft', approval_status: 'Not Submitted' }) });

      db.exec('COMMIT;');
      created = id;
    } catch (txnErr) {
      db.exec('ROLLBACK;');
      throw txnErr;
    }

    const createdDoc = db.prepare('SELECT * FROM documents WHERE id=?').get(created);
    const projectMeta = db.prepare('SELECT name, code FROM projects WHERE id=?').get(createdDoc.project_id);
    createForProjectMembers(db, {
      project_id: createdDoc.project_id,
      exclude_user_id: req.user.id,
      source_type: 'workflow',
      source_id: createdDoc.id,
      title: 'Document Created',
      message: `${createdDoc.ref} has been created for project ${projectMeta?.name || projectMeta?.code || createdDoc.project_id}.`,
      severity: 'info',
      due_date: createdDoc.due_date || null,
      action_url: `/project/${createdDoc.project_id}/documents`
    });
    res.status(201).json(createdDoc);
  } catch (e) {
    if (e.code === 'DOCUMENT_REFERENCE_ALLOCATION_FAILED') return res.status(409).json({ error: e.message });
    if (/UNIQUE constraint failed: documents\.(?:project_id|type|ref)|UNIQUE constraint failed: documents\.ref/i.test(String(e.message || ''))) {
      return res.status(409).json({ error: 'Document reference conflict detected. The system will retry or please save again. If the issue continues, contact System Admin.' });
    }
    const counterErr = String(e.message || '').includes('numbering_counters') || String(e.message || '').includes('UNIQUE constraint failed: numbering_counters');
    if (counterErr) return res.status(500).json({ error: 'Document numbering counter failed. Please contact administrator to run counter migration fix.' });
    res.status(500).json({ error: e.message });
  }
});

// GET /api/documents/:id
router.get('/:id', requireAuth, requireProjectPermission('documents:read'), (req, res) => {
  const db = getDb();
  const doc = requireProjectAccessByRecord(req, res, 'SELECT * FROM documents WHERE id=?', [req.params.id]);
  if (!doc) return;
  const history = db.prepare('SELECT dh.*, u.name as user_name FROM doc_history dh LEFT JOIN users u ON u.id=dh.performed_by WHERE dh.doc_id=? ORDER BY dh.performed_at DESC').all(req.params.id);
  const attachments = db.prepare('SELECT id,original_name,file_type,file_size,uploaded_at FROM attachments WHERE doc_id=?').all(req.params.id);
  res.json({ ...doc, history, attachments });
});

// PATCH /api/documents/:id
router.patch('/:id', requireAuth, requireProjectPermission('documents:update'), (req, res) => {
  try {
    const db = getDb();
    const doc = requireProjectAccessByRecord(req, res, 'SELECT * FROM documents WHERE id=?', [req.params.id]);
    if (!doc) return;

    const allowed = ['title', 'description', 'discipline', 'supplier', 'area', 'severity', 'commercial_value', 'due_date', 'notes', 'workflow_status', 'approval_status', 'evidence_status', 'form_data'];
    const updates = [];
    const vals = [];
    const historyActions = [];
    const isAdmin = req.user.role === ROLES.SYSTEM_ADMIN;

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        // Validate status fields
        if (key === 'workflow_status' && !VALID_WF.includes(req.body[key])) continue;
        if (key === 'approval_status' && !VALID_AP.includes(req.body[key])) continue;
        if (key === 'evidence_status' && !VALID_EV.includes(req.body[key])) continue;
        if (key === 'approval_status' && ['Approved', 'Approved as Noted', 'Revise and Resubmit', 'Rejected'].includes(req.body[key]) && !canPerform(req.user, 'evidence.verify')) {
          return res.status(403).json({ error: 'Missing permission: evidence.verify' });
        }
        if (key === 'workflow_status') {
          const next = req.body[key];
          if (next === 'Closed' && !canPerform(req.user, 'documents.close')) {
            return res.status(403).json({ error: 'Missing permission: documents.close' });
          }
          if (next === 'Issued' && !canPerform(req.user, 'documents.issue')) {
            return res.status(403).json({ error: 'Missing permission: documents.issue' });
          }
          const allowedNext = WORKFLOW_TRANSITIONS[doc.workflow_status] || [];
          if (next !== doc.workflow_status && !allowedNext.includes(next) && !isAdmin) {
            return res.status(400).json({ error: `Invalid workflow transition: ${doc.workflow_status} -> ${next}` });
          }
        }

        if (doc[key] !== req.body[key]) {
          historyActions.push({ key, from: doc[key], to: req.body[key] });
        }
        updates.push(`${key}=?`);
        vals.push(req.body[key]);
      }
    }

    if (req.body.revision !== undefined && String(req.body.revision || '').trim() !== '') {
      const currentRevision = parseRevision(doc.revision || 'R0');
      const requestedRevision = parseRevision(req.body.revision);
      if (requestedRevision === null) return res.status(400).json({ error: 'Invalid revision format. Expected R<number>.' });
      if (currentRevision === null) return res.status(400).json({ error: 'Current record has invalid revision format; contact administrator.' });
      if (requestedRevision !== currentRevision + 1) {
        if (!isAdmin) return res.status(400).json({ error: `Revision must increment sequentially from R${currentRevision} to R${currentRevision + 1}.` });
      }
      if (!isAdmin && req.body.controlled_revision !== true) return res.status(400).json({ error: 'Revision changes require controlled revision action.' });
      if (requestedRevision !== currentRevision) {
        updates.push('revision=?');
        vals.push(`R${requestedRevision}`);
        historyActions.push({ key: 'revision', from: doc.revision, to: `R${requestedRevision}` });
      }
    }

    const newWorkflow = req.body.workflow_status || doc.workflow_status;
    const newApproval = req.body.approval_status || doc.approval_status;
    if (FINAL_WORKFLOW.has(newWorkflow) || FINAL_APPROVAL.has(newApproval)) {
      updates.push('closed_date=?');
      vals.push(new Date().toISOString().split('T')[0]);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields' });
    updates.push('updated_at=?');
    vals.push(new Date().toISOString());
    vals.push(req.params.id);

    db.prepare(`UPDATE documents SET ${updates.join(',')} WHERE id=?`).run(...vals);

    historyActions.forEach(({ key, from, to }) => {
      const actionMap = { workflow_status: 'workflow status changed', approval_status: 'approval status changed', revision: 'revision changed', evidence_status: 'evidence status changed' };
      insertHistory(db, { docId: req.params.id, userId: req.user.id, action: actionMap[key] || `${key} updated`, oldValue: String(from ?? ''), newValue: String(to ?? '') });
      if (key === 'workflow_status' && FINAL_WORKFLOW.has(to)) insertHistory(db, { docId: req.params.id, userId: req.user.id, action: to === 'Closed' ? 'document closed' : 'document superseded/cancelled', oldValue: String(from ?? ''), newValue: String(to) });
    });

    const projectUrl = `/project/${doc.project_id}/documents`;
    if (historyActions.some((h) => h.key === 'workflow_status' && h.to === 'Issued')) {
      createForProjectMembers(db, {
        project_id: doc.project_id,
        source_type: 'workflow',
        source_id: req.params.id,
        title: 'Document Issued',
        message: `${doc.ref} has been issued/generated and is ready for external submission.`,
        severity: 'info',
        due_date: req.body.due_date || doc.due_date || null,
        action_url: projectUrl
      });
      if (!hasEvidenceAttachment(db, req.params.id)) {
        createForProjectMembers(db, {
          project_id: doc.project_id,
          exclude_user_id: req.user.id,
          source_type: 'workflow',
          source_id: req.params.id,
          title: 'Missing Evidence Reminder',
          message: `${doc.ref} is issued but no external evidence file is uploaded yet.`,
          severity: 'warning',
          due_date: req.body.due_date || doc.due_date || null,
          action_url: projectUrl
        });
      }
    }
    const workflowChange = historyActions.find((h) => h.key === 'workflow_status');
    if (workflowChange?.to === 'Closed') {
      createForProjectMembers(db, {
        project_id: doc.project_id,
        source_type: 'workflow',
        source_id: req.params.id,
        title: 'Document Closed',
        message: `${doc.ref} has been closed.`,
        severity: 'success',
        due_date: req.body.due_date || doc.due_date || null,
        action_url: projectUrl
      });
      if (!hasEvidenceAttachment(db, req.params.id)) {
        createForProjectMembers(db, {
          project_id: doc.project_id,
          exclude_user_id: req.user.id,
          source_type: 'workflow',
          source_id: req.params.id,
          title: 'Missing Evidence Reminder',
          message: `${doc.ref} was closed without an uploaded external evidence file.`,
          severity: 'warning',
          due_date: req.body.due_date || doc.due_date || null,
          action_url: projectUrl
        });
      }
    }
    const approvalChange = historyActions.find((h) => h.key === 'approval_status');
    if (approvalChange) {
      const map = {
        Submitted: { title: 'Submitted for Review', severity: 'warning' },
        Approved: { title: 'Document Approved', severity: 'success' },
        'Approved as Noted': { title: 'Document Approved as Noted', severity: 'success' },
        Rejected: { title: 'Document Rejected', severity: 'critical' },
        'Revise and Resubmit': { title: 'Resubmission Required', severity: 'warning' },
      };
      const rule = map[approvalChange.to];
      if (rule) {
        createForProjectMembers(db, {
          project_id: doc.project_id,
          source_type: 'workflow',
          source_id: req.params.id,
          title: rule.title,
          message: `${doc.ref} ${doc.title} status changed to ${approvalChange.to}.`,
          severity: rule.severity,
          due_date: req.body.due_date || doc.due_date || null,
          action_url: projectUrl
        });
      }
      createForProjectMembers(db, {
        project_id: doc.project_id,
        source_type: 'workflow',
        source_id: req.params.id,
        title: 'Approval Status Updated',
        message: `${doc.ref} approval status updated to ${approvalChange.to}.`,
        severity: rule?.severity || 'info',
        due_date: req.body.due_date || doc.due_date || null,
        action_url: projectUrl
      });
      if (!hasEvidenceAttachment(db, req.params.id) && ['Approved', 'Approved as Noted', 'Revise and Resubmit', 'Rejected'].includes(approvalChange.to)) {
        createForProjectMembers(db, {
          project_id: doc.project_id,
          exclude_user_id: req.user.id,
          source_type: 'workflow',
          source_id: req.params.id,
          title: 'Missing Evidence Reminder',
          message: `${doc.ref} status is ${approvalChange.to} but no external evidence file is attached.`,
          severity: 'warning',
          due_date: req.body.due_date || doc.due_date || null,
          action_url: projectUrl
        });
      }
    }

    const updatedDoc = db.prepare('SELECT * FROM documents WHERE id=?').get(req.params.id);
    const history = db.prepare('SELECT dh.*, u.name as user_name FROM doc_history dh LEFT JOIN users u ON u.id=dh.performed_by WHERE dh.doc_id=? ORDER BY dh.performed_at DESC').all(req.params.id);
    const attachments = db.prepare('SELECT id,original_name,file_type,file_size,uploaded_at FROM attachments WHERE doc_id=?').all(req.params.id);
    res.json({ ...updatedDoc, history, attachments });
  } catch (e) {
    const counterErr = String(e.message || '').includes('numbering_counters') || String(e.message || '').includes('UNIQUE constraint failed: numbering_counters');
    if (counterErr) return res.status(500).json({ error: 'Document numbering counter failed. Please contact administrator to run counter migration fix.' });
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/documents/:id (admin only)
router.delete('/:id', requireAuth, requireProjectPermission('documents:delete'), (req, res) => {
  const db = getDb();
  const doc = requireProjectAccessByRecord(req, res, 'SELECT project_id FROM documents WHERE id=?', [req.params.id]);
  if (!doc) return;
  db.prepare('DELETE FROM documents WHERE id=?').run(req.params.id);
  res.json({ message: 'Deleted' });
});

// POST /api/documents/:id/attachments
router.post('/:id/attachments', requireAuth, requireProjectPermission('evidence.upload'), (req, res, next) => upload.single('file')(req, res, next), handleUploadError, (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Missing file' });
    const db = getDb();
    const doc = requireProjectAccessByRecord(req, res, 'SELECT project_id FROM documents WHERE id=?', [req.params.id]);
    if (!doc) return;

    const id = uuidv4();
    db.prepare('INSERT INTO attachments (id,doc_id,project_id,original_name,stored_name,file_type,file_size,uploaded_by) VALUES (?,?,?,?,?,?,?,?)').run(
      id, req.params.id, doc.project_id,
      sanitizeOriginalFilename(req.file.originalname), req.file.filename,
      req.file.mimetype, req.file.size, req.user.id
    );
    insertHistory(db, { docId: req.params.id, userId: req.user.id, action: 'evidence uploaded', newValue: req.file.originalname });
    const fullDoc = db.prepare('SELECT ref FROM documents WHERE id=?').get(req.params.id);
    createForProjectMembers(db, {
      project_id: doc.project_id,
      source_type: 'workflow',
      source_id: req.params.id,
      title: 'Evidence Uploaded',
      message: `Evidence was uploaded for ${fullDoc?.ref || 'document'}.`,
      severity: 'info',
      action_url: `/project/${doc.project_id}/documents`
    });
    res.status(201).json({ id, original_name: req.file.originalname, file_size: req.file.size });
  } catch (e) {
    const counterErr = String(e.message || '').includes('numbering_counters') || String(e.message || '').includes('UNIQUE constraint failed: numbering_counters');
    if (counterErr) return res.status(500).json({ error: 'Document numbering counter failed. Please contact administrator to run counter migration fix.' });
    res.status(500).json({ error: e.message });
  }
});

// GET /api/documents/:id/attachments/:aid/download
router.get('/:id/attachments/:aid/download', requireAuth, requireProjectPermission('documents:read'), (req, res) => {
  const db = getDb();
  const att = db.prepare('SELECT * FROM attachments WHERE id=? AND doc_id=?').get(req.params.aid, req.params.id);
  if (!att) return res.status(404).json({ error: 'Not found' });
  if (!requireProjectMembershipByProjectId(req, res, att.project_id)) return;
  const safeName = path.basename(att.stored_name);
  const filePath = path.resolve(UPLOADS_DIR, safeName);
  if (!filePath.startsWith(path.resolve(UPLOADS_DIR))) return res.status(400).json({ error: 'Invalid file path' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  insertHistory(db, { docId: req.params.id, userId: req.user.id, action: 'attachment downloaded', newValue: att.original_name });
  res.download(filePath, att.original_name);
});

module.exports = router;
