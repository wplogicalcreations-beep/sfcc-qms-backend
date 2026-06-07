const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { requireAuth, requireProjectAccess, requireProjectPermission, requireProjectAccessByRecord } = require('../middleware/auth');

const router = express.Router();

function calcRiskLevel(rating) {
  if (rating >= 15) return 'Critical';
  if (rating >= 10) return 'High';
  if (rating >= 5)  return 'Medium';
  return 'Low';
}

// GET /api/risks?project_id=
router.get('/', requireAuth, requireProjectPermission('risks:read'), requireProjectAccess, (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM risk_register WHERE project_id=? ORDER BY risk_rating DESC, created_at DESC').all(req.query.project_id));
});

// POST /api/risks
router.post('/', requireAuth, requireProjectAccess, requireProjectPermission('risks:create'), (req, res) => {
  try {
    const db = getDb();
    const { project_id, title, category, description, likelihood, consequence, mitigation, contingency, owner, review_date } = req.body;
    if (!project_id || !title) return res.status(400).json({ error: 'project_id and title required' });

    const count = db.prepare('SELECT COUNT(*) as c FROM risk_register WHERE project_id=?').get(project_id).c;
    const project = db.prepare('SELECT code FROM projects WHERE id=?').get(project_id);
    const ref = `${project.code}-RISK-${String(count + 1).padStart(3, '0')}`;

    const l = Number(likelihood) || 3;
    const c2 = Number(consequence) || 3;
    const rating = l * c2;
    const level = calcRiskLevel(rating);

    const id = uuidv4();
    db.prepare(`
      INSERT INTO risk_register (id,project_id,ref,title,category,description,likelihood,consequence,risk_rating,risk_level,mitigation,contingency,owner,review_date,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, project_id, ref, title, category||'', description||'', l, c2, rating, level, mitigation||'', contingency||'', owner||'', review_date||'', req.user.id);

    res.status(201).json(db.prepare('SELECT * FROM risk_register WHERE id=?').get(id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/risks/:id
router.patch('/:id', requireAuth, requireProjectPermission('risks:update'), (req, res) => {
  try {
    const db = getDb();
    const risk = requireProjectAccessByRecord(req, res, 'SELECT project_id FROM risk_register WHERE id=?', [req.params.id]);
    if (!risk) return;
    const { title, category, description, likelihood, consequence, mitigation, contingency, owner, status, review_date, residual_likelihood, residual_consequence } = req.body;
    const l = Number(likelihood) || 3;
    const c2 = Number(consequence) || 3;
    const rating = l * c2;
    const level = calcRiskLevel(rating);
    const rl = Number(residual_likelihood) || 2;
    const rc = Number(residual_consequence) || 2;
    const rRating = rl * rc;
    const rLevel = calcRiskLevel(rRating);

    db.prepare(`
      UPDATE risk_register SET title=?,category=?,description=?,likelihood=?,consequence=?,risk_rating=?,risk_level=?,
      mitigation=?,contingency=?,owner=?,status=?,review_date=?,residual_likelihood=?,residual_consequence=?,residual_rating=?,residual_level=?,updated_at=?
      WHERE id=?
    `).run(title||'', category||'', description||'', l, c2, rating, level, mitigation||'', contingency||'', owner||'', status||'Open', review_date||'', rl, rc, rRating, rLevel, new Date().toISOString(), req.params.id);

    res.json(db.prepare('SELECT * FROM risk_register WHERE id=?').get(req.params.id));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/risks/:id
router.delete('/:id', requireAuth, requireProjectPermission('risks:delete'), (req, res) => {
  const db = getDb();
  const risk = requireProjectAccessByRecord(req, res, 'SELECT project_id FROM risk_register WHERE id=?', [req.params.id]);
  if (!risk) return;
  db.prepare('DELETE FROM risk_register WHERE id=?').run(req.params.id);
  res.json({ message: 'Deleted' });
});

module.exports = router;
