const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { requireAuth, requireProjectAccess, requireProjectPermission, requireProjectAccessByRecord } = require('../middleware/auth');

const router = express.Router();

// GET /api/safety?project_id=&type=&status=
router.get('/', requireAuth, requireProjectPermission('safety:read'), requireProjectAccess, (req, res) => {
  const db = getDb();
  const { project_id, type, status } = req.query;
  let where = [];
  let params = [];
  if (project_id) { where.push('project_id=?'); params.push(project_id); }
  if (type) { where.push('type=?'); params.push(type); }
  if (status) { where.push('status=?'); params.push(status); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  res.json(db.prepare(`SELECT * FROM safety_records ${whereStr} ORDER BY created_at DESC`).all(...params));
});

// POST /api/safety
router.post('/', requireAuth, requireProjectAccess, requireProjectPermission('safety:create'), (req, res) => {
  try {
    const db = getDb();
    const { project_id, type, subtype, title, area, responsible, valid_from, valid_to, notes } = req.body;
    if (!project_id || !type || !title) return res.status(400).json({ error: 'project_id, type, title required' });

    // Auto-generate ref
    const count = db.prepare('SELECT COUNT(*) as c FROM safety_records WHERE project_id=? AND type=?').get(project_id, type).c;
    const project = db.prepare('SELECT code FROM projects WHERE id=?').get(project_id);
    const ref = `${project.code}-${type.replace(/\s+/g,'').slice(0,3).toUpperCase()}-${String(count + 1).padStart(3,'0')}`;

    const id = uuidv4();
    db.prepare('INSERT INTO safety_records (id,project_id,ref,type,subtype,title,area,responsible,valid_from,valid_to,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, project_id, ref, type, subtype||'', title, area||'', responsible||'', valid_from||null, valid_to||null, notes||'', req.user.id);
    res.status(201).json(db.prepare('SELECT * FROM safety_records WHERE id=?').get(id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/safety/:id
router.patch('/:id', requireAuth, requireProjectPermission('safety:update'), (req, res) => {
  const db = getDb();
  const safety = requireProjectAccessByRecord(req, res, 'SELECT project_id FROM safety_records WHERE id=?', [req.params.id]);
  if (!safety) return;
  const { title, area, responsible, status, valid_from, valid_to, notes } = req.body;
  db.prepare('UPDATE safety_records SET title=?,area=?,responsible=?,status=?,valid_from=?,valid_to=?,notes=?,updated_at=? WHERE id=?').run(title||'', area||'', responsible||'', status||'Active', valid_from||null, valid_to||null, notes||'', new Date().toISOString(), req.params.id);
  res.json(db.prepare('SELECT * FROM safety_records WHERE id=?').get(req.params.id));
});

// DELETE /api/safety/:id
router.delete('/:id', requireAuth, requireProjectPermission('safety:delete'), (req, res) => {
  const db = getDb();
  const safety = requireProjectAccessByRecord(req, res, 'SELECT project_id FROM safety_records WHERE id=?', [req.params.id]);
  if (!safety) return;
  db.prepare('DELETE FROM safety_records WHERE id=?').run(req.params.id);
  res.json({ message: 'Deleted' });
});

module.exports = router;
