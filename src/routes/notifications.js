const express = require('express');
const { getDb } = require('../db/schema');
const { requireAuth, requirePermission, ROLES, normalizeRole } = require('../middleware/auth');
const { createNotification, createForProjectMembers } = require('../services/notificationService');

const router = express.Router();


function notificationVisibleClause(req, alias = 'n') {
  const role = normalizeRole(req.user.role);
  const params = [req.user.id, role];
  const clauses = [
    `${alias}.recipient_user_id=?`,
    `LOWER(COALESCE(${alias}.recipient_role,''))=LOWER(?)`,
  ];

  if (role === ROLES.SYSTEM_ADMIN) {
    clauses.push(`(
      LOWER(COALESCE(${alias}.recipient_role,'')) IN ('system_admin','admin')
      OR (
        ${alias}.recipient_user_id IS NULL
        AND COALESCE(${alias}.recipient_role,'')=''
        AND (
          LOWER(COALESCE(${alias}.source_type,'')) IN ('system','system/admin')
          OR LOWER(COALESCE(${alias}.source_type,'')) LIKE 'system/%'
        )
      )
    )`);
  }

  return { clause: `(${clauses.join(' OR ')})`, params };
}

function dedupeExpression(alias = 'n') {
  return `COALESCE(NULLIF(${alias}.source_type,''),'notification') || '|' ||
    COALESCE(NULLIF(${alias}.source_id,''), ${alias}.id) || '|' ||
    COALESCE(NULLIF(${alias}.title,''),'') || '|' ||
    COALESCE(NULLIF(${alias}.message,''),'') || '|' ||
    COALESCE(NULLIF(${alias}.due_date,''),'') || '|' ||
    COALESCE(NULLIF(${alias}.action_url,''),'')`;
}


function activeProjectNotificationClause(alias = 'n') {
  return `(${alias}.project_id IS NULL OR EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id=${alias}.project_id
      AND LOWER(COALESCE(p.status,'Active'))='active'
  ))`;
}

function getVisibleProjectIds(db, req) {
  if (req.user.role === ROLES.SYSTEM_ADMIN) {
    return db.prepare('SELECT id FROM projects').all().map((r) => r.id);
  }
  return db.prepare('SELECT project_id FROM project_memberships WHERE user_id=? AND is_active=1').all(req.user.id).map((r) => r.project_id);
}

router.get('/', requireAuth, requirePermission('notifications.view'), (req, res) => {
  const db = getDb();
  const { project_id, severity, status = 'all', limit = 50 } = req.query;
  const visible = notificationVisibleClause(req, 'n');
  const where = [visible.clause, activeProjectNotificationClause('n')];
  const params = [...visible.params];

  if (project_id) { where.push('n.project_id=?'); params.push(project_id); }
  if (severity) { where.push('LOWER(n.severity)=LOWER(?)'); params.push(severity); }
  if (status !== 'all') { where.push('LOWER(n.status)=LOWER(?)'); params.push(status); }

  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const rows = db.prepare(`
    WITH visible AS (
      SELECT n.*, ${dedupeExpression('n')} AS notification_key
      FROM notifications n
      WHERE ${where.join(' AND ')}
    ), ranked AS (
      SELECT visible.*, ROW_NUMBER() OVER (
        PARTITION BY notification_key
        ORDER BY CASE WHEN LOWER(COALESCE(status,''))='unread' THEN 0 ELSE 1 END, datetime(created_at) DESC, id DESC
      ) AS rn
      FROM visible
    )
    SELECT id, project_id, recipient_user_id, recipient_role, source_type, source_id, title, message, severity, status, due_date, action_url, created_at, read_at
    FROM ranked
    WHERE rn=1
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `).all(...params, safeLimit);
  res.json(rows);
});

router.get('/unread-count', requireAuth, requirePermission('notifications.view'), (req, res) => {
  const db = getDb();
  const visible = notificationVisibleClause(req, 'n');
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM (
      SELECT ${dedupeExpression('n')} AS notification_key
      FROM notifications n
      WHERE ${visible.clause}
        AND ${activeProjectNotificationClause('n')}
        AND LOWER(COALESCE(n.status,''))='unread'
      GROUP BY notification_key
    ) scoped_unread
  `).get(...visible.params);
  res.json({ unread: row?.c || 0 });
});

router.patch('/:id/read', requireAuth, requirePermission('notifications.mark_read'), (req, res) => {
  const db = getDb();
  const visible = notificationVisibleClause(req, 'n');
  const n = db.prepare(`SELECT n.* FROM notifications n WHERE n.id=? AND ${visible.clause} AND ${activeProjectNotificationClause('n')}`).get(req.params.id, ...visible.params);
  if (!n) return res.status(404).json({ error: 'Notification not found' });
  const result = db.prepare(`
    UPDATE notifications
    SET status='read', read_at=?, created_at=created_at
    WHERE id IN (
      SELECT n.id
      FROM notifications n
      WHERE ${visible.clause}
        AND ${activeProjectNotificationClause('n')}
        AND LOWER(COALESCE(n.status,''))='unread'
        AND ${dedupeExpression('n')} = (
          SELECT ${dedupeExpression('target')}
          FROM notifications target
          WHERE target.id=?
        )
    )
  `).run(new Date().toISOString(), ...visible.params, req.params.id);
  res.json({ ok: true, updated: result.changes || 0 });
});

router.patch('/mark-all-read', requireAuth, requirePermission('notifications.mark_read'), (req, res) => {
  const db = getDb();
  const visible = notificationVisibleClause(req, 'n');
  const result = db.prepare(`
    UPDATE notifications
    SET status='read', read_at=?
    WHERE id IN (
      SELECT n.id
      FROM notifications n
      WHERE ${visible.clause}
        AND ${activeProjectNotificationClause('n')}
        AND LOWER(COALESCE(n.status,''))='unread'
    )
  `).run(new Date().toISOString(), ...visible.params);
  res.json({ ok: true, updated: result.changes || 0 });
});

router.post('/run-overdue-check', requireAuth, requirePermission('admin.settings'), (req, res) => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const docs = db.prepare(`SELECT d.id, d.project_id, d.ref, d.title, d.due_date, d.workflow_status FROM documents d
    JOIN projects p ON p.id=d.project_id
    WHERE d.due_date IS NOT NULL AND d.due_date < ? AND LOWER(COALESCE(d.workflow_status,'')) NOT IN ('closed','superseded','cancelled')
      AND LOWER(COALESCE(p.status,'Active'))='active'`).all(today);
  const approaching = db.prepare(`SELECT d.id, d.project_id, d.ref, d.title, d.due_date, d.workflow_status FROM documents d
    JOIN projects p ON p.id=d.project_id
    WHERE d.due_date IS NOT NULL AND d.due_date = date(?, '+2 day') AND LOWER(COALESCE(d.workflow_status,'')) NOT IN ('closed','superseded','cancelled')
      AND LOWER(COALESCE(p.status,'Active'))='active'`).all(today);

  let created = 0;
  docs.forEach((doc) => {
    const exists = db.prepare(`SELECT 1 FROM notifications WHERE project_id=? AND source_type='workflow' AND source_id=? AND title=? AND due_date=?`).get(doc.project_id, doc.id, 'Document Overdue', today);
    if (!exists) {
      createForProjectMembers(db, {
        project_id: doc.project_id,
        source_type: 'workflow',
        source_id: doc.id,
        title: 'Document Overdue',
        message: `Follow-up required. External response is overdue for ${doc.ref}.`,
        severity: 'critical',
        due_date: today,
        action_url: `/project/${doc.project_id}/documents`
      });
      created += 1;
    }
  });

  approaching.forEach((doc) => {
    const exists = db.prepare(`SELECT 1 FROM notifications WHERE project_id=? AND source_type='workflow' AND source_id=? AND title=? AND due_date=?`).get(doc.project_id, doc.id, 'Response Due Soon', doc.due_date);
    if (!exists) {
      createForProjectMembers(db, {
        project_id: doc.project_id,
        source_type: 'workflow',
        source_id: doc.id,
        title: 'Response Due Soon',
        message: `Follow-up required. External response is due on ${doc.due_date} for ${doc.ref}.`,
        severity: 'warning',
        due_date: doc.due_date,
        action_url: `/project/${doc.project_id}/documents`
      });
      created += 1;
    }
  });

  res.json({ checked: docs.length + approaching.length, created, run_date: today, note: 'Can be wired to cron by calling this endpoint daily.' });
});

router.get('/debug', requireAuth, requirePermission('admin.settings'), (req, res) => {
  const db = getDb();
  const visibleProjectIds = getVisibleProjectIds(db, req);
  const totalCount = db.prepare('SELECT COUNT(*) AS c FROM notifications').get()?.c || 0;
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE recipient_user_id=?').get(req.user.id)?.c || 0;
  const roleCount = db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE LOWER(COALESCE(recipient_role,''))=LOWER(?)").get(req.user.role)?.c || 0;
  const last10 = db.prepare(`SELECT id, project_id, recipient_user_id, recipient_role, title, status, created_at
    FROM notifications ORDER BY datetime(created_at) DESC LIMIT 10`).all();
  res.json({
    current_user_id: req.user.id,
    current_user_role: req.user.role,
    visible_project_ids: visibleProjectIds,
    total_notifications_count: totalCount,
    notifications_for_current_user_count: userCount,
    notifications_for_current_role_count: roleCount,
    last_10_notifications: last10
  });
});

router.post('/debug-test', requireAuth, requirePermission('admin.settings'), (req, res) => {
  const db = getDb();
  const pid = db.prepare('SELECT id FROM projects ORDER BY created_at DESC LIMIT 1').get()?.id || null;
  const id = createNotification(db, {
    project_id: pid,
    recipient_user_id: req.user.id,
    source_type: 'system/debug',
    source_id: 'debug-test',
    title: 'Test Notification',
    message: 'Notification system test created successfully.',
    severity: 'info',
    action_url: pid ? `/project/${pid}/documents` : null
  });
  const row = db.prepare('SELECT * FROM notifications WHERE id=?').get(id);
  res.status(201).json(row);
});

module.exports = router;
