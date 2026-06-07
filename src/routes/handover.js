const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { requireAuth, requireProjectAccess, requireProjectPermission, ROLES, requireProjectMembershipByProjectId } = require('../middleware/auth');
const { createUploader, handleUploadError, sanitizeOriginalFilename } = require('../middleware/uploadSecurity');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';
const upload = createUploader({ type: 'handover', destinationDir: UPLOADS_DIR });

const CLOSEOUT_DISCIPLINES = [
  { key: 'arch', label: 'Architectural' },
  { key: 'civil', label: 'Civil & Structural' },
  { key: 'mech', label: 'Mechanical (HVAC)' },
  { key: 'elec', label: 'Electrical' },
  { key: 'plumbing', label: 'Plumbing & Drainage' },
  { key: 'ff', label: 'Fire Fighting' },
  { key: 'elv', label: 'Extra Low Voltage (ELV)' },
  { key: 'landscape', label: 'Landscape' },
];

const CLOSEOUT_REQUIREMENTS = [
  { package_name: 'As-Built Drawings', description: 'Final discipline as-built drawings and marked-up records.' },
  { package_name: 'Approved Material Submittals', description: 'Approved material submittals and technical data sheets.' },
  { package_name: 'Approved Shop Drawings', description: 'Approved shop drawings and installation details.' },
  { package_name: 'Inspection Records', description: 'Inspection requests, checklists, and acceptance records.' },
  { package_name: 'Testing & Commissioning Records', description: 'Testing, balancing, commissioning, and verification records.', appliesTo: ['mech', 'elec', 'plumbing', 'ff', 'elv'] },
  { package_name: 'Operation & Maintenance Manual', description: 'Operation and maintenance manuals for maintainable systems.', appliesTo: ['mech', 'elec', 'plumbing', 'ff', 'elv', 'landscape'] },
  { package_name: 'Warranty Certificates', description: 'Warranty certificates and supplier guarantees.' },
  { package_name: 'Final Evidence / Photos', description: 'Final evidence photographs and closeout confirmation records.' },
];

function seedDefaultCloseoutItems(db, projectId) {
  const project = db.prepare('SELECT id FROM projects WHERE id=?').get(projectId);
  if (!project) return { inserted: 0, projectFound: false };

  const now = new Date().toISOString();
  let inserted = 0;
  const existsStmt = db.prepare('SELECT id FROM handover_items WHERE project_id=? AND discipline=? AND package_name=? LIMIT 1');
  const insertStmt = db.prepare(`INSERT INTO handover_items (id, project_id, discipline, package_name, package, description, required, status, category, is_applicable, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'standard', ?, ?, ?)`);
  const updateLegacyStmt = db.prepare(`
    UPDATE handover_items
    SET category='legacy_seed', is_applicable=0, status='not_applicable', updated_at=?
    WHERE project_id=?
      AND (discipline IS NULL OR TRIM(discipline)='')
      AND (category IS NULL OR TRIM(category)='' OR category='standard')
  `);

  for (const discipline of CLOSEOUT_DISCIPLINES) {
    for (const requirement of CLOSEOUT_REQUIREMENTS) {
      const applicable = !requirement.appliesTo || requirement.appliesTo.includes(discipline.key) ? 1 : 0;
      if (!existsStmt.get(projectId, discipline.key, requirement.package_name)) {
        insertStmt.run(
          uuidv4(),
          projectId,
          discipline.key,
          requirement.package_name,
          requirement.package_name,
          `${discipline.label} - ${requirement.description}`,
          applicable ? 'pending' : 'not_applicable',
          applicable,
          now,
          now,
        );
        inserted += 1;
      }
    }
  }

  updateLegacyStmt.run(now, projectId);

  return { inserted, projectFound: true };
}

function sendAttachmentForItem(req, res, item, attachmentId, mode = 'view') {
  const db = getDb();
  const att = db.prepare('SELECT * FROM attachments WHERE id=? AND project_id=?').get(attachmentId, item.project_id);
  if (!att) return res.status(404).json({ error: 'Attachment not found' });
  const safeName = path.basename(att.stored_name);
  const filePath = path.resolve(UPLOADS_DIR, safeName);
  if (!filePath.startsWith(path.resolve(UPLOADS_DIR))) return res.status(400).json({ error: 'Invalid file path' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Disposition', `${mode === 'download' ? 'attachment' : 'inline'}; filename="${att.original_name}"`);
  res.setHeader('Content-Type', att.file_type || 'application/octet-stream');
  return res.sendFile(filePath);
}

router.get('/', requireAuth, requireProjectAccess, requireProjectPermission('handover:read'), (req, res) => {
  const { project_id: projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'project_id required' });
  const db = getDb();
  const seedResult = seedDefaultCloseoutItems(db, projectId);
  if (!seedResult.projectFound) return res.status(404).json({ error: 'Project not found' });
  const rows = db.prepare('SELECT * FROM handover_items WHERE project_id=? ORDER BY discipline, package_name').all(projectId);
  res.json(rows);
});


router.post('/initialize', requireAuth, requireProjectAccess, requireProjectPermission('handover:update'), (req, res) => {
  const { project_id: projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: 'project_id required' });
  const db = getDb();
  const seedResult = seedDefaultCloseoutItems(db, projectId);
  if (!seedResult.projectFound) return res.status(404).json({ error: 'Project not found' });
  const rows = db.prepare('SELECT * FROM handover_items WHERE project_id=? ORDER BY discipline, package_name').all(projectId);
  res.json({ inserted: seedResult.inserted, items: rows });
});

router.post('/', requireAuth, requireProjectAccess, requireProjectPermission('handover:update'), (req, res) => {
  const db = getDb();
  const allowed = ['project_id', 'discipline', 'package_name', 'status', 'uploaded_by', 'upload_date', 'approved_by', 'approved_date', 'remarks', 'attachment_id', 'is_applicable', 'category', 'certificate_issued', 'certificate_approved', 'certificate_uploaded', 'certificate_upload_date', 'certificate_remarks', 'certificate_attachment_id', 'po_number', 'contract_number', 'actual_completion_date', 'certificate_issue_date', 'project_name', 'project_code', 'site_location', 'client_name', 'consultant_name', 'contractor_name', 'contract_value', 'project_start_date', 'target_completion_date', 'certificate_body_text', 'certificate_title', 'snag_item_no', 'area_location', 'priority', 'responsible_owner', 'target_date', 'evidence_reference', 'scope_completed_summary', 'outstanding_items', 'snag_status_summary', 'handover_status', 'prepared_by', 'internally_approved_by', 'signed_evidence_reference'];
  const payload = Object.fromEntries(allowed.map((field) => [field, req.body[field]]));
  if (!payload.project_id || !payload.discipline || !payload.package_name) return res.status(400).json({ error: 'project_id, discipline and package_name are required' });

  const id = uuidv4();
  const now = new Date().toISOString();
  const columns = ['id', ...allowed, 'package', 'description', 'required', 'created_at', 'updated_at'];
  const values = columns.map((column) => {
    if (column === 'id') return id;
    if (column === 'package') return payload.package_name;
    if (column === 'description') return req.body.description || payload.remarks || payload.package_name;
    if (column === 'required') return 1;
    if (column === 'created_at' || column === 'updated_at') return now;
    if (column === 'status') return payload.status || (payload.category === 'snag_item' ? 'Open' : 'pending');
    if (column === 'uploaded_by' || column === 'approved_by' || column === 'remarks' || column === 'certificate_remarks') return payload[column] || '';
    if (column === 'is_applicable') return payload.is_applicable ?? 1;
    if (column === 'category') return payload.category || 'standard';
    if (column === 'certificate_issued' || column === 'certificate_uploaded') return payload[column] ?? 0;
    if (column === 'certificate_approved') return payload.certificate_approved || 'Not Approved';
    return payload[column] ?? null;
  });

  db.prepare(`INSERT INTO handover_items (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...values);

  res.status(201).json(db.prepare('SELECT * FROM handover_items WHERE id=?').get(id));
});

router.patch('/:id', requireAuth, requireProjectPermission('handover:update'), (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM handover_items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  if (req.user.role !== ROLES.SYSTEM_ADMIN) {
    const member = db.prepare('SELECT 1 FROM project_memberships WHERE user_id=? AND project_id=? AND is_active=1').get(req.user.id, item.project_id);
    if (!member) return res.status(403).json({ error: 'No access to this project' });
  }

  const allowed = ['discipline', 'package_name', 'status', 'uploaded_by', 'upload_date', 'approved_by', 'approved_date', 'remarks', 'attachment_id', 'is_applicable', 'category', 'certificate_issued', 'certificate_approved', 'certificate_uploaded', 'certificate_upload_date', 'certificate_remarks', 'certificate_attachment_id', 'po_number', 'contract_number', 'actual_completion_date', 'certificate_issue_date', 'project_name', 'project_code', 'site_location', 'client_name', 'consultant_name', 'contractor_name', 'contract_value', 'project_start_date', 'target_completion_date', 'certificate_body_text', 'certificate_title', 'description', 'snag_item_no', 'area_location', 'priority', 'responsible_owner', 'target_date', 'evidence_reference', 'scope_completed_summary', 'outstanding_items', 'snag_status_summary', 'handover_status', 'prepared_by', 'internally_approved_by', 'signed_evidence_reference'];
  const updates = [];
  const values = [];
  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      updates.push(`${field}=?`);
      values.push(req.body[field]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  updates.push('updated_at=?');
  values.push(new Date().toISOString());
  values.push(req.params.id);

  db.prepare(`UPDATE handover_items SET ${updates.join(', ')} WHERE id=?`).run(...values);
  res.json(db.prepare('SELECT * FROM handover_items WHERE id=?').get(req.params.id));
});

router.delete('/:id', requireAuth, requireProjectPermission('handover:update'), (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT project_id FROM handover_items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  if (req.user.role !== ROLES.SYSTEM_ADMIN) {
    const member = db.prepare('SELECT 1 FROM project_memberships WHERE user_id=? AND project_id=? AND is_active=1').get(req.user.id, item.project_id);
    if (!member) return res.status(403).json({ error: 'No access to this project' });
  }

  db.prepare('DELETE FROM handover_items WHERE id=?').run(req.params.id);
  res.json({ message: 'Deleted' });
});


router.post('/:id/upload', requireAuth, requireProjectPermission('handover:update'), (req, res, next) => upload.single('file')(req, res, next), handleUploadError, (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM handover_items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!requireProjectMembershipByProjectId(req, res, item.project_id)) return;
  if (!req.file) return res.status(400).json({ error: 'Missing file' });
  const attId = uuidv4();
  db.prepare('INSERT INTO attachments (id,doc_id,project_id,original_name,stored_name,file_type,file_size,uploaded_by) VALUES (?,?,?,?,?,?,?,?)').run(
    attId, null, item.project_id, sanitizeOriginalFilename(req.file.originalname), req.file.filename, req.file.mimetype, req.file.size, req.user.id
  );
  const now = new Date().toISOString();
  const isCert = (item.category || '') === 'certificate' || item.package_name === 'Project Completion Certificate';
  db.prepare(`UPDATE handover_items SET attachment_id=?, uploaded_by=?, upload_date=?, certificate_attachment_id=CASE WHEN ? THEN ? ELSE certificate_attachment_id END, certificate_uploaded=CASE WHEN ? THEN 1 ELSE certificate_uploaded END, certificate_upload_date=CASE WHEN ? THEN ? ELSE certificate_upload_date END, updated_at=? WHERE id=?`)
    .run(attId, req.user.name || req.user.email || 'User', now, isCert ? 1 : 0, attId, isCert ? 1 : 0, isCert ? 1 : 0, now, now, item.id);
  res.status(201).json({ attachment_id: attId, upload_date: now });
});

router.get('/:id/attachments/:attachmentId', requireAuth, requireProjectPermission('handover:read'), (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM handover_items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!requireProjectMembershipByProjectId(req, res, item.project_id)) return;
  return sendAttachmentForItem(req, res, item, req.params.attachmentId, req.query.mode === 'download' ? 'download' : 'view');
});

router.get('/:id/file/view', requireAuth, requireProjectPermission('handover:read'), (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM handover_items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!requireProjectMembershipByProjectId(req, res, item.project_id)) return;
  const attachmentId = item.certificate_attachment_id || item.attachment_id;
  if (!attachmentId) return res.status(404).json({ error: 'Attachment not found' });
  return sendAttachmentForItem(req, res, item, attachmentId, 'view');
});

router.get('/:id/file/download', requireAuth, requireProjectPermission('handover:read'), (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM handover_items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!requireProjectMembershipByProjectId(req, res, item.project_id)) return;
  const attachmentId = item.certificate_attachment_id || item.attachment_id;
  if (!attachmentId) return res.status(404).json({ error: 'Attachment not found' });
  return sendAttachmentForItem(req, res, item, attachmentId, 'download');
});

module.exports = router;
