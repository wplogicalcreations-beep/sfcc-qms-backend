const { v4: uuidv4 } = require('uuid');
const { ROLES } = require('../middleware/auth');

const SEVERITIES = new Set(['info', 'warning', 'critical', 'success']);

function normalizeSeverity(value) {
  const v = String(value || 'info').toLowerCase();
  return SEVERITIES.has(v) ? v : 'info';
}

function getProjectUserIds(db, projectId) {
  return db.prepare(`SELECT user_id FROM project_memberships WHERE project_id=? AND is_active=1`).all(projectId).map((r) => r.user_id);
}

const INTERNAL_FALLBACK_ROLES = [
  ROLES.SYSTEM_ADMIN,
  ROLES.PROJECT_MANAGER,
  ROLES.PMO,
  ROLES.QA_QC_ENGINEER,
  ROLES.PROJECT_ENGINEER,
  ROLES.SITE_ENGINEER,
];

function getInternalFallbackUserIds(db, exclude = []) {
  const excluded = new Set((exclude || []).filter(Boolean));
  const placeholders = INTERNAL_FALLBACK_ROLES.map(() => '?').join(',');
  const users = db.prepare(
    `SELECT id FROM users WHERE is_active=1 AND LOWER(CASE WHEN role='document_controller' THEN 'pmo' WHEN role='engineer' THEN 'project_engineer' WHEN role='hse_officer' THEN 'site_engineer' WHEN role='approver' THEN 'qa_qc_engineer' ELSE role END) IN (${placeholders})`
  ).all(...INTERNAL_FALLBACK_ROLES.map((r) => String(r).toLowerCase())).map((r) => r.id);
  return users.filter((id) => !excluded.has(id));
}

function createNotification(db, payload) {
  const recipientUserId = payload.recipient_user_id || null;
  const recipientRole = payload.recipient_role || null;
  const sourceType = payload.source_type || 'workflow';
  const sourceId = payload.source_id || null;
  const dueDate = payload.due_date || null;
  const actionUrl = payload.action_url || null;

  const existingUnread = db.prepare(`
    SELECT id FROM notifications
    WHERE COALESCE(recipient_user_id,'')=COALESCE(?,'')
      AND COALESCE(recipient_role,'')=COALESCE(?,'')
      AND COALESCE(source_type,'')=COALESCE(?,'')
      AND COALESCE(source_id,'')=COALESCE(?,'')
      AND title=?
      AND message=?
      AND COALESCE(due_date,'')=COALESCE(?,'')
      AND COALESCE(action_url,'')=COALESCE(?,'')
      AND LOWER(COALESCE(status,''))='unread'
    ORDER BY datetime(created_at) DESC
    LIMIT 1
  `).get(recipientUserId, recipientRole, sourceType, sourceId, payload.title, payload.message, dueDate, actionUrl);
  if (existingUnread?.id) return existingUnread.id;

  const id = uuidv4();
  db.prepare(`INSERT INTO notifications (id, project_id, recipient_user_id, recipient_role, source_type, source_id, title, message, severity, status, due_date, action_url, created_at, read_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    payload.project_id,
    recipientUserId,
    recipientRole,
    sourceType,
    sourceId,
    payload.title,
    payload.message,
    normalizeSeverity(payload.severity),
    'unread',
    dueDate,
    actionUrl,
    new Date().toISOString(),
    null
  );
  return id;
}

function createForProjectMembers(db, { project_id, exclude_user_id = null, ...base }) {
  const projectUsers = getProjectUserIds(db, project_id);
  const recipients = new Set(projectUsers.filter(Boolean));
  getInternalFallbackUserIds(db, [exclude_user_id]).forEach((uid) => recipients.add(uid));
  recipients.forEach((uid) => {
    if (uid && uid !== exclude_user_id) createNotification(db, { ...base, project_id, recipient_user_id: uid });
  });
}

module.exports = { createNotification, createForProjectMembers, normalizeSeverity, getProjectUserIds };
