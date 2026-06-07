const jwt = require('jsonwebtoken');
const { getDb } = require('../db/schema');

const PERMISSION_VALUES = Object.freeze({
  YES: 'Yes',
  NO: 'No',
  READ_ONLY: 'Read Only',
  ASSIGNED: 'Assigned',
  ALL_PROJECTS: 'All Projects',
  RESTRICTED: 'Restricted',
});

const ROLES = Object.freeze({
  SYSTEM_ADMIN: 'system_admin',
  PROJECT_MANAGER: 'project_manager',
  PMO: 'pmo',
  QA_QC_ENGINEER: 'qa_qc_engineer',
  PROJECT_ENGINEER: 'project_engineer',
  SITE_ENGINEER: 'site_engineer',
  VIEWER: 'viewer',
});

const ROLE_LABELS = Object.freeze({
  [ROLES.SYSTEM_ADMIN]: 'System Admin',
  [ROLES.PROJECT_MANAGER]: 'Project Manager',
  [ROLES.PMO]: 'PMO',
  [ROLES.QA_QC_ENGINEER]: 'QA/QC Engineer',
  [ROLES.PROJECT_ENGINEER]: 'Project Engineer',
  [ROLES.SITE_ENGINEER]: 'Site Engineer',
  [ROLES.VIEWER]: 'Viewer',
});

const ALLOWED_ROLES = Object.freeze(Object.values(ROLES));

const LEGACY_ROLE_MAP = Object.freeze({
  admin: ROLES.SYSTEM_ADMIN,
  document_controller: ROLES.PMO,
  engineer: ROLES.PROJECT_ENGINEER,
  hse_officer: ROLES.SITE_ENGINEER,
  approver: ROLES.QA_QC_ENGINEER,
});

function normalizeRole(role) {
  const key = String(role || '').trim().toLowerCase();
  return LEGACY_ROLE_MAP[key] || key;
}

function isAllowedRole(role) {
  return ALLOWED_ROLES.includes(normalizeRole(role));
}

function getRoleLabel(role) {
  return ROLE_LABELS[normalizeRole(role)] || ROLE_LABELS[ROLES.VIEWER];
}

const PERMISSION_MATRIX = Object.freeze({
  'platform.login': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'Yes', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'Yes' },
  'projects.view': { system_admin: 'All Projects', project_manager: 'All Projects', pmo: 'All Projects', qa_qc_engineer: 'All Projects', project_engineer: 'All Projects', site_engineer: 'Yes', viewer: 'Assigned' },
  'projects.create': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'No', viewer: 'No' },
  'projects.edit': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'No', viewer: 'Read Only' },
  'projects.team': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Read Only', viewer: 'Read Only' },
  'dashboard.view': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'Read Only' },
  'dashboard.print': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'No', viewer: 'No' },
  'documents.view': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'Read Only' },
  'documents.create': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'No' },
  'documents.edit_draft': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'No' },
  'documents.issue': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'No' },
  'documents.close': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'No', site_engineer: 'No', viewer: 'No' },
  'documents.override_reference': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'No', project_engineer: 'No', site_engineer: 'No', viewer: 'No' },
  'evidence.upload': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'No' },
  'evidence.verify': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'No', viewer: 'No' },
  'reports.view': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'Read Only' },
  'reports.export_csv': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'No', site_engineer: 'No', viewer: 'No' },
  'reports.print': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'No', site_engineer: 'Yes', viewer: 'No' },
  'progress.view': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'Read Only' },
  'progress.create': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'No' },
  'progress.edit_draft': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'No' },
  'progress.issue': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'No' },
  'progress.close': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'No' },
  'progress.photos_upload': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'No' },
  'inspections.create': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'No' },
  'ncr.create': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'No', viewer: 'No' },
  'schedule.view': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'Read Only' },
  'schedule.edit': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'All Projects', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'No' },
  'notifications.view': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'Yes', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'Yes' },
  'notifications.mark_read': { system_admin: 'Yes', project_manager: 'Yes', pmo: 'Yes', qa_qc_engineer: 'Yes', project_engineer: 'Yes', site_engineer: 'Yes', viewer: 'Yes' },
  'admin.backup_restore': { system_admin: 'Yes', project_manager: 'No', pmo: 'No', qa_qc_engineer: 'No', project_engineer: 'No', site_engineer: 'No', viewer: 'No' },
  'admin.users_manage': { system_admin: 'Yes', project_manager: 'No', pmo: 'No', qa_qc_engineer: 'No', project_engineer: 'No', site_engineer: 'No', viewer: 'No' },
  'admin.roles_manage': { system_admin: 'Yes', project_manager: 'No', pmo: 'No', qa_qc_engineer: 'No', project_engineer: 'No', site_engineer: 'No', viewer: 'No' },
  'admin.settings': { system_admin: 'Yes', project_manager: 'No', pmo: 'No', qa_qc_engineer: 'No', project_engineer: 'No', site_engineer: 'No', viewer: 'No' },
});

const LEGACY_PERMISSION_MAP = Object.freeze({
  'project:read': 'projects.view',
  'project:create': 'projects.create',
  'project:update': 'projects.edit',
  'project:delete': 'admin.settings',
  'documents:read': 'documents.view',
  'documents:create': 'documents.create',
  'documents:update': 'documents.edit_draft',
  'documents:delete': 'admin.settings',
  'stakeholders:read': 'projects.team',
  'stakeholders:create': 'projects.team',
  'stakeholders:update': 'projects.team',
  'stakeholders:delete': 'projects.team',
  'handover:read': 'documents.view',
  'handover:update': 'documents.edit_draft',
  'approvals:view': 'documents.view',
  'approvals:approve': 'evidence.verify',
  'progress:read': 'progress.view',
  'progress:create': 'progress.create',
  'progress:update': 'progress.edit_draft',
  'safety:read': 'schedule.view',
  'safety:create': 'schedule.edit',
  'safety:update': 'schedule.edit',
  'safety:delete': 'admin.settings',
  'risks:read': 'schedule.view',
  'risks:create': 'schedule.edit',
  'risks:update': 'schedule.edit',
  'risks:delete': 'admin.settings',
  'admin:backup': 'admin.backup_restore',
});

const ALLOW_VALUES = new Set([PERMISSION_VALUES.YES, PERMISSION_VALUES.READ_ONLY, PERMISSION_VALUES.ASSIGNED, PERMISSION_VALUES.ALL_PROJECTS, PERMISSION_VALUES.RESTRICTED]);
const MUTATING_ALLOW_VALUES = new Set([PERMISSION_VALUES.YES, PERMISSION_VALUES.ALL_PROJECTS, PERMISSION_VALUES.RESTRICTED]);

function resolvePermissionKey(permissionKey) {
  return LEGACY_PERMISSION_MAP[permissionKey] || permissionKey;
}

function getPermissionValue(role, permissionKey) {
  const resolvedKey = resolvePermissionKey(permissionKey);
  return PERMISSION_MATRIX[resolvedKey]?.[normalizeRole(role)] || PERMISSION_VALUES.NO;
}

function isReadMethod(method) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(String(method || '').toUpperCase());
}

function permissionValueAllows(value, { readOnlyOk = false } = {}) {
  if (readOnlyOk) return ALLOW_VALUES.has(value);
  return MUTATING_ALLOW_VALUES.has(value);
}

function isSystemAdmin(user) {
  return normalizeRole(user?.role) === ROLES.SYSTEM_ADMIN;
}

function allProjectsRole(user) {
  const role = normalizeRole(user?.role);
  const value = getPermissionValue(role, 'projects.view');
  return value === PERMISSION_VALUES.ALL_PROJECTS || role === ROLES.SYSTEM_ADMIN;
}

function canPerform(user, permissionKey, projectId = null, options = {}) {
  const value = getPermissionValue(user?.role, permissionKey);
  if (!permissionValueAllows(value, options)) return false;
  if (projectId && [PERMISSION_VALUES.ASSIGNED].includes(value)) return canAccessProject(user, projectId);
  return true;
}

function getProjectIdFromRequest(req) {
  return req.params.projectId || req.params.id || req.body.project_id || req.query.project_id || req.body.projectId || req.query.projectId;
}

function canAccessProject(user, projectId) {
  if (!user || !projectId) return false;
  if (allProjectsRole(user)) return true;
  const db = getDb();
  const membership = db.prepare('SELECT 1 FROM project_memberships WHERE user_id=? AND project_id=? AND is_active=1').get(user.id, projectId);
  return !!membership;
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
  try {
    const tokenUser = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
    const db = getDb();
    const user = db.prepare('SELECT id,name,email,role,is_active,status FROM users WHERE id=?').get(tokenUser.id);
    if (!user || Number(user.is_active) !== 1 || String(user.status || 'active').toLowerCase() !== 'active') {
      return res.status(401).json({ error: user ? 'User account is inactive. Please contact System Admin.' : 'User is inactive or no longer exists' });
    }
    const normalizedRole = normalizeRole(user.role);
    if (!isAllowedRole(normalizedRole)) return res.status(403).json({ error: 'Role is not permitted' });
    req.user = { ...tokenUser, id: user.id, email: user.email, name: user.name, role: normalizedRole };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(roles = []) {
  const allowed = new Set((Array.isArray(roles) ? roles : [roles]).map(normalizeRole));
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!allowed.has(req.user.role)) return res.status(403).json({ error: 'Insufficient role' });
    next();
  };
}

function requireAnyRole(roles = []) {
  return requireRole(roles);
}

function requirePermission(permissionKey, options = {}) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const readOnlyOk = options.readOnlyOk ?? isReadMethod(req.method);
    if (!canPerform(req.user, permissionKey, null, { readOnlyOk })) {
      return res.status(403).json({ error: `Missing permission: ${resolvePermissionKey(permissionKey)}` });
    }
    next();
  };
}

function requireProjectPermission(permissionKey) {
  return requirePermission(permissionKey);
}

function requireProjectAccess(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (allProjectsRole(req.user)) return next();
  const projectId = getProjectIdFromRequest(req);
  if (!projectId) return res.status(400).json({ error: 'project_id or project route id required' });
  if (!canAccessProject(req.user, projectId)) return res.status(403).json({ error: 'No access to this project' });
  next();
}

function requireProjectMembershipByProjectId(req, res, projectId) {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return false;
  }
  if (allProjectsRole(req.user)) return true;
  if (!projectId) {
    res.status(400).json({ error: 'project_id required' });
    return false;
  }
  if (!canAccessProject(req.user, projectId)) {
    res.status(403).json({ error: 'Unauthorized access' });
    return false;
  }
  return true;
}

function requireProjectAccessByRecord(req, res, recordLookupQuery, recordLookupParams = []) {
  const db = getDb();
  const record = db.prepare(recordLookupQuery).get(...recordLookupParams);
  if (!record) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  if (!requireProjectMembershipByProjectId(req, res, record.project_id)) return null;
  return record;
}

module.exports = {
  requireAuth,
  requireRole,
  requireAnyRole,
  requirePermission,
  requireProjectAccess,
  requireProjectPermission,
  requireProjectMembershipByProjectId,
  requireProjectAccessByRecord,
  isSystemAdmin,
  normalizeRole,
  canAccessProject,
  canPerform,
  getPermissionValue,
  getRoleLabel,
  isAllowedRole,
  ROLES,
  ROLE_LABELS,
  ALLOWED_ROLES,
  PERMISSION_VALUES,
  PERMISSION_MATRIX,
  PROJECT_PERMISSIONS: PERMISSION_MATRIX,
};
