const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { requireAuth, requireProjectAccess, requireProjectPermission, requireProjectAccessByRecord } = require('../middleware/auth');

const router = express.Router();
const ALLOWED_PRIORITY = ['Low', 'Medium', 'High', 'Critical'];
const ALLOWED_STATUS = ['Open', 'In Progress', 'Waiting', 'Completed', 'Cancelled'];

router.get('/', requireAuth, requireProjectAccess, requireProjectPermission('project:read'), (req, res) => {
  const db = getDb();
  const projectId = req.query.project_id;
  if (!projectId) return res.status(400).json({ error: 'project_id required' });
  const rows = db.prepare('SELECT * FROM project_followups WHERE project_id=? ORDER BY datetime(created_at) DESC').all(projectId);
  res.json(rows);
});

router.post('/', requireAuth, requireProjectAccess, requireProjectPermission('project:update'), (req, res) => {
  const db = getDb();
  const id = uuidv4();
  const { project_id, title, description, action_required, comment, responsible_person, due_date, priority, status } = req.body;
  if (!project_id || !title) return res.status(400).json({ error: 'project_id and title are required' });
  const usePriority = ALLOWED_PRIORITY.includes(priority) ? priority : 'Medium';
  const useStatus = ALLOWED_STATUS.includes(status) ? status : 'Open';
  const completedAt = useStatus === 'Completed' ? new Date().toISOString() : null;
  db.prepare(`INSERT INTO project_followups (id, project_id, title, description, action_required, comment, responsible_person, due_date, priority, status, completed_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`).run(
    id, project_id, title, description || '', action_required || '', comment || '', responsible_person || '', due_date || null, usePriority, useStatus, completedAt, req.user.id,
  );
  res.status(201).json(db.prepare('SELECT * FROM project_followups WHERE id=?').get(id));
});

router.patch('/:id', requireAuth, requireProjectPermission('project:update'), (req, res) => {
  const db = getDb();
  const row = requireProjectAccessByRecord(req, res, 'SELECT * FROM project_followups WHERE id=?', [req.params.id]);
  if (!row) return;

  const fields = ['title', 'description', 'action_required', 'comment', 'responsible_person', 'due_date', 'priority', 'status'];
  const updates = [];
  const vals = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      if (f === 'priority' && !ALLOWED_PRIORITY.includes(req.body[f])) continue;
      if (f === 'status' && !ALLOWED_STATUS.includes(req.body[f])) continue;
      updates.push(`${f}=?`);
      vals.push(req.body[f]);
    }
  }

  const targetStatus = req.body.status !== undefined ? req.body.status : row.status;
  updates.push('completed_at=?');
  vals.push(targetStatus === 'Completed' ? (row.completed_at || new Date().toISOString()) : null);
  updates.push('updated_at=?');
  vals.push(new Date().toISOString());

  vals.push(req.params.id);
  db.prepare(`UPDATE project_followups SET ${updates.join(', ')} WHERE id=?`).run(...vals);
  res.json(db.prepare('SELECT * FROM project_followups WHERE id=?').get(req.params.id));
});

router.delete('/:id', requireAuth, requireProjectPermission('project:update'), (req, res) => {
  const db = getDb();
  const row = requireProjectAccessByRecord(req, res, 'SELECT project_id FROM project_followups WHERE id=?', [req.params.id]);
  if (!row) return;
  db.prepare('DELETE FROM project_followups WHERE id=?').run(req.params.id);
  res.json({ message: 'Deleted' });
});

module.exports = router;
