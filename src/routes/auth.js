const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { requireAuth, requirePermission, normalizeRole, getRoleLabel, isAllowedRole, isSystemAdmin, ALLOWED_ROLES, ROLE_LABELS } = require('../middleware/auth');

const router = express.Router();

function userDto(row, projects = []) {
  const role = normalizeRole(row.role);
  const active = String(row.status || '').toLowerCase() ? String(row.status || '').toLowerCase() === 'active' : Number(row.is_active) === 1;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role,
    role_label: getRoleLabel(role),
    status: active ? 'active' : 'inactive',
    is_active: active ? 1 : 0,
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at,
    project_ids: projects,
  };
}

function getUserProjectIds(db, userId) {
  return db.prepare('SELECT project_id FROM project_memberships WHERE user_id=? AND is_active=1 ORDER BY created_at').all(userId).map((r) => r.project_id);
}

function validateUserInput({ name, email, role, status }, { requirePassword = false, password } = {}) {
  if (!name || !String(name).trim()) return 'name is required';
  if (!email || !String(email).trim()) return 'email is required';
  if (!/^\S+@\S+\.\S+$/.test(String(email).trim())) return 'valid email is required';
  if (!role || !isAllowedRole(role)) return 'valid internal role is required';
  if (status && !['active', 'inactive'].includes(String(status).toLowerCase())) return 'status must be active or inactive';
  if (requirePassword && (!password || String(password).length < 8)) return 'password of at least 8 characters is required';
  return '';
}


function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tableName));
}

function columnExists(db, tableName, columnName) {
  if (!tableExists(db, tableName)) return false;
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((col) => col.name === columnName);
}

const HISTORY_REFERENCE_COLUMNS = Object.freeze([
  ['projects', 'created_by'],
  ['documents', 'created_by'],
  ['documents', 'updated_by'],
  ['documents', 'owner'],
  ['doc_history', 'performed_by'],
  ['doc_history', 'user_id'],
  ['notifications', 'recipient_user_id'],
  ['notifications', 'user_id'],
  ['notifications', 'recipient'],
  ['progress_reports', 'prepared_by'],
  ['progress_reports', 'created_by'],
  ['progress_reports', 'updated_by'],
  ['progress_photos', 'uploaded_by'],
  ['attachments', 'uploaded_by'],
  ['project_logos', 'uploaded_by'],
  ['safety_records', 'created_by'],
  ['schedule_activities', 'created_by'],
  ['project_followups', 'created_by'],
  ['handover_items', 'uploaded_by'],
  ['handover_items', 'approved_by'],
  ['risk_register', 'owner'],
  ['risk_register', 'created_by'],
]);

function getUserHistoryReferences(db, userId) {
  return HISTORY_REFERENCE_COLUMNS.reduce((references, [tableName, columnName]) => {
    if (!columnExists(db, tableName, columnName)) return references;
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE ${columnName}=?`).get(userId);
    if (Number(row?.count || 0) > 0) references.push({ table: tableName, column: columnName, count: Number(row.count) });
    return references;
  }, []);
}

function deactivateUserForHistory(db, userId) {
  db.prepare("UPDATE users SET status='inactive', is_active=0, updated_at=datetime('now') WHERE id=?").run(userId);
  if (tableExists(db, 'project_memberships') && columnExists(db, 'project_memberships', 'is_active')) {
    db.prepare('UPDATE project_memberships SET is_active=0 WHERE user_id=?').run(userId);
  }
}

function hardDeleteUser(db, userId) {
  if (tableExists(db, 'project_memberships')) db.prepare('DELETE FROM project_memberships WHERE user_id=?').run(userId);
  db.prepare('DELETE FROM users WHERE id=?').run(userId);
}

function syncProjectMemberships(db, userId, role, projectIds) {
  if (!Array.isArray(projectIds)) return;
  const desired = new Set(projectIds.filter(Boolean).map(String));
  const existing = db.prepare('SELECT project_id FROM project_memberships WHERE user_id=?').all(userId).map((r) => String(r.project_id));
  const existingSet = new Set(existing);
  for (const projectId of desired) {
    if (existingSet.has(projectId)) {
      db.prepare('UPDATE project_memberships SET role=?, is_active=1 WHERE user_id=? AND project_id=?').run(role, userId, projectId);
    } else {
      db.prepare('INSERT INTO project_memberships (id, project_id, user_id, role, is_active) VALUES (?,?,?,?,1)').run(uuidv4(), projectId, userId, role);
    }
  }
  for (const projectId of existing) {
    if (!desired.has(projectId)) db.prepare('UPDATE project_memberships SET is_active=0 WHERE user_id=? AND project_id=?').run(userId, projectId);
  }
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(String(email).toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (Number(user.is_active) !== 1 || String(user.status || 'active').toLowerCase() !== 'active') return res.status(401).json({ error: 'User account is inactive. Please contact System Admin.' });

    const normalizedRole = normalizeRole(user.role);
    if (!isAllowedRole(normalizedRole)) return res.status(403).json({ error: 'Role is not permitted' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: normalizedRole },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: userDto({ ...user, role: normalizedRole }, getUserProjectIds(db, user.id)) });
  } catch (e) {
    console.error('[auth] login failed', e);
    res.status(500).json({ error: 'Unable to login' });
  }
});

// POST /api/auth/bootstrap-user
// Free-plan provisioning path for Render when you need to create test users without an existing admin session.
router.post('/bootstrap-user', async (req, res) => {
  try {
    const bootstrapKey = String(req.header('x-bootstrap-key') || req.body.bootstrap_key || '').trim();
    if (!process.env.BOOTSTRAP_ADMIN_KEY || !process.env.BOOTSTRAP_ADMIN_KEY.trim()) {
      return res.status(503).json({ error: 'Bootstrap user provisioning is disabled on this deployment' });
    }

    if (!bootstrapKey || bootstrapKey !== process.env.BOOTSTRAP_ADMIN_KEY.trim()) {
      return res.status(403).json({ error: 'Invalid bootstrap key' });
    }

    const { name, email, password, role = 'system_admin', status = 'active' } = req.body;
    const normalizedRole = normalizeRole(role);
    const validationError = validateUserInput({ name, email, role: normalizedRole, status }, { requirePassword: true, password });
    if (validationError) return res.status(400).json({ error: validationError });
    if (normalizedRole !== 'system_admin') {
      return res.status(400).json({ error: 'Bootstrap user must be created as system_admin' });
    }

    const db = getDb();
    const normalizedEmail = String(email).toLowerCase().trim();
    const existing = db.prepare('SELECT id FROM users WHERE email=?').get(normalizedEmail);
    if (existing) return res.status(409).json({ error: 'Email already in use' });

    const id = uuidv4();
    const hash = await bcrypt.hash(password, 10);
    db.prepare('INSERT INTO users (id,name,email,password,role,status,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,datetime(\'now\'),datetime(\'now\'))')
      .run(id, String(name).trim(), normalizedEmail, hash, normalizedRole, 'active', 1);

    const created = db.prepare('SELECT id,name,email,role,status,is_active,created_at,updated_at FROM users WHERE id=?').get(id);
    res.status(201).json({
      message: 'Bootstrap user created successfully',
      user: userDto(created, getUserProjectIds(db, id)),
    });
  } catch (e) {
    console.error('[auth] bootstrap user failed', e);
    res.status(500).json({ error: 'Unable to create bootstrap user' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id,name,email,role,status,is_active,created_at,updated_at FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(userDto(user, getUserProjectIds(db, user.id)));
});

router.get('/roles', requireAuth, requirePermission('admin.users_manage'), (req, res) => {
  res.json(ALLOWED_ROLES.map((role) => ({ code: role, label: ROLE_LABELS[role] })));
});

// POST /api/auth/users  (System Admin only - create internal user)
router.post('/users', requireAuth, requirePermission('admin.users_manage'), async (req, res) => {
  try {
    const { name, email, password, role, status = 'active', project_ids } = req.body;
    const normalizedRole = normalizeRole(role);
    const validationError = validateUserInput({ name, email, role: normalizedRole, status }, { requirePassword: true, password });
    if (validationError) return res.status(400).json({ error: validationError });

    const db = getDb();
    const normalizedEmail = String(email).toLowerCase().trim();
    const existing = db.prepare('SELECT id FROM users WHERE email=?').get(normalizedEmail);
    if (existing) return res.status(409).json({ error: 'Email already in use' });

    const id = uuidv4();
    const hash = await bcrypt.hash(password, 10);
    const active = String(status).toLowerCase() === 'inactive' ? 0 : 1;
    db.prepare('INSERT INTO users (id,name,email,password,role,status,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,datetime(\'now\'),datetime(\'now\'))')
      .run(id, String(name).trim(), normalizedEmail, hash, normalizedRole, active ? 'active' : 'inactive', active);
    syncProjectMemberships(db, id, normalizedRole, project_ids);
    const created = db.prepare('SELECT id,name,email,role,status,is_active,created_at,updated_at FROM users WHERE id=?').get(id);
    res.status(201).json(userDto(created, getUserProjectIds(db, id)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/auth/users (System Admin only)
router.get('/users', requireAuth, requirePermission('admin.users_manage'), (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id,name,email,role,status,is_active,created_at,updated_at FROM users ORDER BY created_at').all();
  res.json(users.map((u) => userDto(u, getUserProjectIds(db, u.id))));
});

// PATCH /api/auth/users/:id (System Admin only)
router.patch('/users/:id', requireAuth, requirePermission('admin.users_manage'), async (req, res) => {
  try {
    const db = getDb();
    const current = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'User not found' });

    const next = {
      name: req.body.name ?? current.name,
      email: req.body.email ?? current.email,
      role: normalizeRole(req.body.role ?? current.role),
      status: String(req.body.status ?? current.status ?? (current.is_active ? 'active' : 'inactive')).toLowerCase(),
    };
    const validationError = validateUserInput(next);
    if (validationError) return res.status(400).json({ error: validationError });

    const normalizedEmail = String(next.email).toLowerCase().trim();
    const duplicate = db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(normalizedEmail, req.params.id);
    if (duplicate) return res.status(409).json({ error: 'Email already in use' });

    const active = next.status === 'active' ? 1 : 0;
    db.prepare('UPDATE users SET name=?, email=?, role=?, status=?, is_active=?, updated_at=datetime(\'now\') WHERE id=?')
      .run(String(next.name).trim(), normalizedEmail, next.role, next.status, active, req.params.id);

    if (req.body.password) {
      if (String(req.body.password).length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
      const hash = await bcrypt.hash(req.body.password, 10);
      db.prepare('UPDATE users SET password=?, updated_at=datetime(\'now\') WHERE id=?').run(hash, req.params.id);
    }

    syncProjectMemberships(db, req.params.id, next.role, req.body.project_ids);
    const updated = db.prepare('SELECT id,name,email,role,status,is_active,created_at,updated_at FROM users WHERE id=?').get(req.params.id);
    res.json(userDto(updated, getUserProjectIds(db, req.params.id)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// DELETE /api/auth/users/:id (System Admin only - safe delete/deactivate)
router.delete('/users/:id', requireAuth, requirePermission('admin.users_manage'), (req, res) => {
  if (!isSystemAdmin(req.user)) return res.status(403).json({ error: 'System Admin role required' });
  if (String(req.params.id) === String(req.user.id)) return res.status(400).json({ error: 'You cannot delete your own active account' });

  const db = getDb();
  try {
    const current = db.prepare('SELECT id,name,email,role,status,is_active FROM users WHERE id=?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'User not found' });

    const references = getUserHistoryReferences(db, req.params.id);
    db.exec('BEGIN');
    if (references.length > 0) {
      deactivateUserForHistory(db, req.params.id);
      db.exec('COMMIT');
      return res.json({
        status: 'deactivated_due_to_history',
        message: 'User has existing system records and was deactivated instead of deleted to preserve audit history.',
        references: references.map(({ table, column, count }) => ({ table, column, count })),
      });
    }

    hardDeleteUser(db, req.params.id);
    db.exec('COMMIT');
    return res.json({ status: 'deleted', message: 'User deleted successfully.' });
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* no active transaction */ }
    console.error('[auth] safe user delete failed', e);
    return res.status(500).json({ error: 'Unable to delete user safely' });
  }
});

// PATCH /api/auth/password
router.patch('/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password=?, updated_at=datetime(\'now\') WHERE id=?').run(hash, req.user.id);
    res.json({ message: 'Password updated' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
