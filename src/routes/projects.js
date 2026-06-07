const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/schema');
const { requireAuth, requireProjectAccess, requireProjectPermission, requireRole, ROLES, getPermissionValue } = require('../middleware/auth');
const { createUploader, handleUploadError } = require('../middleware/uploadSecurity');

const router = express.Router();
const TYPES = ['MS', 'DS', 'RFI', 'IR', 'NCR', 'TR', 'VO', 'SI'];
const LOGO_TYPES = new Set(['sfcc', 'client', 'consultant', 'pmc']);
const logoUpload = createUploader({ type: 'projectLogos', destinationDir: path.resolve(process.cwd(), 'uploads/project-logos') });


const ARCHIVED_PROJECT_STATUSES = new Set(['archived', 'archive', 'inactive', 'deleted']);
const ACTIVE_PROJECT_STATUSES = new Set(['active']);
const COMPLETED_PROJECT_STATUSES = new Set(['completed', 'complete', 'closed', 'closeout closed']);
const ISSUED_DOCUMENT_STATUSES = new Set(['issued', 'submitted', 'closed', 'approved', 'approved as noted', 'response received']);
const OPEN_ACTION_CLOSED_STATUSES = new Set(['completed', 'complete', 'cancelled', 'canceled', 'closed', 'done']);

function normalizeStatus(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isActiveProjectStatus(value) {
  return ACTIVE_PROJECT_STATUSES.has(normalizeStatus(value || 'Active'));
}

function isCompletedProjectStatus(value) {
  return COMPLETED_PROJECT_STATUSES.has(normalizeStatus(value));
}

function isArchivedProjectStatus(value) {
  return ARCHIVED_PROJECT_STATUSES.has(normalizeStatus(value));
}

function isIssuedDocumentRow(row = {}) {
  const workflow = normalizeStatus(row.workflow_status);
  const approval = normalizeStatus(row.approval_status);
  if (['draft', 'new', 'not submitted'].includes(workflow)) return false;
  if (workflow === '' && ['draft', 'new', 'not submitted', ''].includes(approval)) return false;
  return ISSUED_DOCUMENT_STATUSES.has(workflow) || ISSUED_DOCUMENT_STATUSES.has(approval);
}

function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampPercentValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function resolveSummaryProgress(project = {}) {
  if (isCompletedProjectStatus(project.status)) return 100;
  const actual = clampPercentValue(project.actual_progress);
  if (actual !== null && actual > 0) return actual;
  const progress = clampPercentValue(project.progress);
  if (progress !== null && progress > 0) return progress;
  const schedule = clampPercentValue(project.schedule_avg_progress);
  if (schedule !== null && Number(project.schedule_activity_count || 0) > 0) return schedule;
  const latestReport = clampPercentValue(project.latest_report_progress);
  if (latestReport !== null) return latestReport;
  if (actual !== null) return actual;
  if (progress !== null) return progress;
  return null;
}

function isHighRiskProject(project = {}) {
  const risk = normalizeStatus(project.risk_status || project.calculated_risk_status);
  return risk === 'high' || risk === 'high risk' || risk === 'critical';
}

function getVisibleProjectIds(db, user, { includeCompleted = true } = {}) {
  const rows = db.prepare('SELECT id, status FROM projects').all();
  let visibleIds = rows
    .filter((row) => !isArchivedProjectStatus(row.status))
    .filter((row) => includeCompleted || isActiveProjectStatus(row.status))
    .map((row) => row.id);

  if (getPermissionValue(user.role, 'projects.view') !== 'All Projects') {
    const memberships = new Set(db.prepare('SELECT project_id FROM project_memberships WHERE user_id=? AND is_active=1').all(user.id).map((m) => m.project_id));
    visibleIds = visibleIds.filter((id) => memberships.has(id));
  }

  return visibleIds;
}

function makeInClause(ids) {
  return ids.map(() => '?').join(',');
}

const QA_PROJECT_CODE = 'SFCC-TEST-001';
const QA_PROJECT_DEFAULTS = {
  code: QA_PROJECT_CODE,
  name: 'Internal QMS Test Project',
  client: 'Silver Foundation',
  location: 'Riyadh',
  sector: 'Internal QA',
  main_contractor: 'Silver Foundation Contracting Company',
  consultant: 'Not Set',
  pmc: 'Not Set',
  contract_no: 'Not Set',
  discipline: 'General',
  status: 'Active',
};

function isBlankOrNotSet(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '' || normalized === 'not set' || normalized === 'n/a' || normalized === 'na';
}

function ensureProjectOptionalColumns(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(projects)').all().map((col) => col.name));
  const optionalColumns = {
    main_contractor: 'TEXT',
    contract_no: 'TEXT',
  };
  for (const [name, definition] of Object.entries(optionalColumns)) {
    if (!columns.has(name)) db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${definition}`);
  }
}

function ensureProjectNumberingCounters(db, projectId) {
  for (const t of TYPES) {
    const exists = db.prepare('SELECT 1 FROM numbering_counters WHERE project_id=? AND doc_type=? AND discipline_code=?').get(projectId, t, 'GEN');
    if (!exists) {
      db.prepare('INSERT INTO numbering_counters (id,project_id,doc_type,discipline_code,current_val) VALUES (?,?,?,?,?)').run(uuidv4(), projectId, t, 'GEN', 0);
    }
  }
}

function ensureQaProject(db, userId) {
  ensureProjectOptionalColumns(db);
  const now = new Date().toISOString();
  let project = db.prepare('SELECT * FROM projects WHERE code=?').get(QA_PROJECT_CODE);
  let created = false;
  let updatedMissingFields = [];

  if (!project) {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO projects (id,code,name,client,consultant,pmc,location,sector,discipline,status,main_contractor,contract_no,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      QA_PROJECT_DEFAULTS.code,
      QA_PROJECT_DEFAULTS.name,
      QA_PROJECT_DEFAULTS.client,
      QA_PROJECT_DEFAULTS.consultant,
      QA_PROJECT_DEFAULTS.pmc,
      QA_PROJECT_DEFAULTS.location,
      QA_PROJECT_DEFAULTS.sector,
      QA_PROJECT_DEFAULTS.discipline,
      QA_PROJECT_DEFAULTS.status,
      QA_PROJECT_DEFAULTS.main_contractor,
      QA_PROJECT_DEFAULTS.contract_no,
      userId || null,
      now,
      now
    );
    project = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
    created = true;
  } else {
    const updates = ['status=?', 'updated_at=?'];
    const vals = [QA_PROJECT_DEFAULTS.status, now];
    const fields = ['name', 'client', 'location', 'sector', 'main_contractor', 'consultant', 'pmc', 'contract_no', 'discipline'];
    for (const field of fields) {
      if (isBlankOrNotSet(project[field])) {
        updates.push(`${field}=?`);
        vals.push(QA_PROJECT_DEFAULTS[field]);
        updatedMissingFields.push(field);
      }
    }
    vals.push(project.id);
    db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id=?`).run(...vals);
    project = db.prepare('SELECT * FROM projects WHERE id=?').get(project.id);
  }

  ensureProjectNumberingCounters(db, project.id);
  return { project, created, updatedMissingFields };
}

function projectCounts(db) {
  const rows = db.prepare(`
    SELECT
      SUM(CASE WHEN LOWER(COALESCE(status,'Active'))='active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN LOWER(COALESCE(status,'')) IN ('archived','inactive') THEN 1 ELSE 0 END) AS archived,
      COUNT(*) AS total
    FROM projects
  `).get();
  return {
    active: Number(rows?.active || 0),
    archived: Number(rows?.archived || 0),
    total: Number(rows?.total || 0),
  };
}

const toLogo = (row) => row ? ({
  id: row.id,
  project_id: row.project_id,
  logo_type: row.logo_type,
  original_filename: row.original_filename,
  mime_type: row.mime_type,
  size_bytes: row.size_bytes,
  uploaded_by: row.uploaded_by,
  uploaded_at: row.uploaded_at,
  active: Number(row.active || 0),
  view_url: `/api/projects/${row.project_id}/logos/${row.logo_type}/view`,
}) : null;

// GET /api/projects
router.get('/', requireAuth, requireProjectPermission('project:read'), (req, res) => {
  const db = getDb();
  ensureProjectOptionalColumns(db);
  const showArchived = String(req.query.show_archived || '').toLowerCase() === 'true' && req.user.role === ROLES.SYSTEM_ADMIN;
  const projectWhere = showArchived ? '1=1' : "LOWER(COALESCE(p.status,'Active'))='active'";
  let projects = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM documents d WHERE d.project_id=p.id) as total_docs,
      (SELECT COUNT(*) FROM documents d WHERE d.project_id=p.id AND LOWER(COALESCE(d.workflow_status,'')) NOT IN ('draft','new','not submitted') AND (LOWER(COALESCE(d.workflow_status,'')) IN ('issued','submitted','closed','approved','approved as noted','response received') OR LOWER(COALESCE(d.approval_status,'')) IN ('issued','submitted','closed','approved','approved as noted','response received'))) as issued_docs,
      (SELECT COUNT(*) FROM documents d WHERE d.project_id=p.id AND d.workflow_status != 'Closed') as open_docs,
      (SELECT COUNT(*) FROM documents d WHERE d.project_id=p.id AND d.approval_status IN ('Approved','Approved as Noted')) as approved_docs,
      (SELECT COUNT(*) FROM schedule_activities sa WHERE sa.project_id=p.id) as schedule_activity_count,
      (SELECT COUNT(*) FROM schedule_activities sa WHERE sa.project_id=p.id AND COALESCE(sa.progress_percent, 0) >= 100) as completed_activity_count,
      (SELECT COUNT(*) FROM schedule_activities sa WHERE sa.project_id=p.id AND sa.planned_finish < date('now') AND COALESCE(sa.progress_percent, 0) < 100) as overdue_activity_count,
      (SELECT ROUND(AVG(COALESCE(sa.progress_percent, 0)), 0) FROM schedule_activities sa WHERE sa.project_id=p.id) as schedule_avg_progress,
      (SELECT MAX(sa.planned_finish) FROM schedule_activities sa WHERE sa.project_id=p.id) as latest_schedule_finish,
      (SELECT COUNT(*) FROM project_followups pf WHERE pf.project_id=p.id AND LOWER(TRIM(COALESCE(pf.status,'open'))) NOT IN ('completed','complete','cancelled','canceled','closed','done')) as open_followup_count,
      (SELECT COUNT(*) FROM handover_items hi WHERE hi.project_id=p.id AND COALESCE(hi.is_applicable,1)=1 AND LOWER(COALESCE(hi.status,'pending')) NOT IN ('approved','complete','completed','closed','not applicable')) as pending_handover_count,
      (SELECT COUNT(*) FROM risk_register rr WHERE rr.project_id=p.id AND LOWER(COALESCE(rr.status, 'open')) NOT IN ('closed','mitigated')) as open_risk_count,
      (SELECT COUNT(*) FROM risk_register rr WHERE rr.project_id=p.id AND LOWER(COALESCE(rr.status, 'open')) NOT IN ('closed','mitigated') AND LOWER(COALESCE(rr.risk_level, rr.risk_rating, '')) IN ('high', 'critical')) as high_risk_count,
      (SELECT COUNT(*) FROM risk_register rr WHERE rr.project_id=p.id AND COALESCE(rr.status, 'Open') != 'Closed' AND LOWER(COALESCE(rr.risk_level, '')) = 'medium') as medium_risk_count,
      (SELECT pr.overall_pct FROM progress_reports pr WHERE pr.project_id=p.id ORDER BY pr.report_date DESC, pr.created_at DESC LIMIT 1) as latest_report_progress,
      CASE
        WHEN COALESCE(p.actual_progress, 0) > 0 THEN ROUND(COALESCE(p.actual_progress, 0), 0)
        WHEN (SELECT COUNT(*) FROM schedule_activities sa WHERE sa.project_id=p.id) > 0 THEN ROUND(COALESCE((SELECT AVG(COALESCE(sa.progress_percent, 0)) FROM schedule_activities sa WHERE sa.project_id=p.id), 0), 0)
        WHEN (SELECT pr.overall_pct FROM progress_reports pr WHERE pr.project_id=p.id ORDER BY pr.report_date DESC, pr.created_at DESC LIMIT 1) IS NOT NULL THEN ROUND(COALESCE((SELECT pr.overall_pct FROM progress_reports pr WHERE pr.project_id=p.id ORDER BY pr.report_date DESC, pr.created_at DESC LIMIT 1), 0), 0)
        ELSE 0
      END as calculated_progress,
      CASE
        WHEN COALESCE(TRIM(p.schedule_status), '') != '' THEN p.schedule_status
        WHEN (SELECT COUNT(*) FROM schedule_activities sa WHERE sa.project_id=p.id) = 0 THEN 'Not Set'
        WHEN (SELECT COUNT(*) FROM schedule_activities sa WHERE sa.project_id=p.id AND sa.planned_finish < date('now') AND COALESCE(sa.progress_percent, 0) < 100) > 0 THEN 'Delayed'
        WHEN COALESCE((SELECT AVG(COALESCE(sa.progress_percent, 0)) FROM schedule_activities sa WHERE sa.project_id=p.id), 0) >= 30 THEN 'On Track'
        ELSE 'At Risk'
      END as calculated_schedule_status,
      CASE
        WHEN COALESCE(TRIM(p.budget_status), '') != '' THEN p.budget_status
        WHEN COALESCE(p.planned_budget, 0) <= 0 THEN 'Not Set'
        WHEN COALESCE(p.forecast_cost, 0) > COALESCE(p.planned_budget, 0) OR COALESCE(p.actual_cost, 0) > COALESCE(p.planned_budget, 0) THEN 'Over Budget'
        ELSE 'On Budget'
      END as calculated_budget_status,
      CASE
        WHEN COALESCE(TRIM(p.risk_status), '') != '' THEN p.risk_status
        WHEN (SELECT COUNT(*) FROM risk_register rr WHERE rr.project_id=p.id AND COALESCE(rr.status, 'Open') != 'Closed') = 0 THEN 'Not Set'
        WHEN (SELECT COUNT(*) FROM risk_register rr WHERE rr.project_id=p.id AND COALESCE(rr.status, 'Open') != 'Closed' AND LOWER(COALESCE(rr.risk_level, '')) IN ('high', 'critical')) > 0 THEN 'High'
        WHEN (SELECT COUNT(*) FROM risk_register rr WHERE rr.project_id=p.id AND COALESCE(rr.status, 'Open') != 'Closed' AND LOWER(COALESCE(rr.risk_level, '')) = 'medium') > 0 THEN 'Medium'
        ELSE 'Low'
      END as calculated_risk_status,
      CASE
        WHEN COALESCE(p.target_completion_date, '') != '' THEN CAST(CEIL((julianday(p.target_completion_date) - julianday(date('now')))) AS INTEGER)
        WHEN COALESCE(p.end_date, '') != '' THEN CAST(CEIL((julianday(p.end_date) - julianday(date('now')))) AS INTEGER)
        WHEN (SELECT MAX(sa.planned_finish) FROM schedule_activities sa WHERE sa.project_id=p.id) IS NOT NULL THEN CAST(CEIL((julianday((SELECT MAX(sa.planned_finish) FROM schedule_activities sa WHERE sa.project_id=p.id)) - julianday(date('now')))) AS INTEGER)
        WHEN COALESCE(p.portfolio_timeline_end, '') != '' THEN CAST(CEIL((julianday(p.portfolio_timeline_end) - julianday(date('now')))) AS INTEGER)
        ELSE NULL
      END as calculated_remaining_days
    FROM projects p
    WHERE ${projectWhere}
    ORDER BY p.created_at DESC
  `).all();
  if (getPermissionValue(req.user.role, 'projects.view') !== 'All Projects') {
    const memberships = db.prepare('SELECT project_id FROM project_memberships WHERE user_id=? AND is_active=1').all(req.user.id).map((m) => m.project_id);
    projects = projects.filter((p) => memberships.includes(p.id));
  }
  res.json(projects);
});



// GET /api/projects/summary — backend-owned portfolio KPI tiles
router.get('/summary', requireAuth, requireProjectPermission('project:read'), (req, res) => {
  const db = getDb();
  ensureProjectOptionalColumns(db);

  const visibleProjectIds = getVisibleProjectIds(db, req.user, { includeCompleted: true });
  if (visibleProjectIds.length === 0) {
    return res.json({
      activeProjects: 0,
      completedProjects: 0,
      issuedDocuments: 0,
      openActions: 0,
      totalContractValue: 0,
      averageProgress: 0,
      highRiskProjects: 0,
      source: 'backend',
    });
  }

  const placeholders = makeInClause(visibleProjectIds);
  const visibleProjects = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM schedule_activities sa WHERE sa.project_id=p.id) as schedule_activity_count,
      (SELECT ROUND(AVG(COALESCE(sa.progress_percent, 0)), 0) FROM schedule_activities sa WHERE sa.project_id=p.id) as schedule_avg_progress,
      (SELECT pr.overall_pct FROM progress_reports pr WHERE pr.project_id=p.id ORDER BY pr.report_date DESC, pr.created_at DESC LIMIT 1) as latest_report_progress
    FROM projects p
    WHERE p.id IN (${placeholders})
  `).all(...visibleProjectIds);
  const activeProjects = visibleProjects.filter((project) => isActiveProjectStatus(project.status));
  const activeProjectIds = activeProjects.map((project) => project.id);
  const completedProjects = visibleProjects.filter((project) => isCompletedProjectStatus(project.status));

  let issuedDocuments = 0;
  let openActions = 0;
  if (activeProjectIds.length > 0) {
    const activePlaceholders = makeInClause(activeProjectIds);
    const documentRows = db.prepare(`
      SELECT d.id, d.workflow_status, d.approval_status
      FROM documents d
      WHERE d.project_id IN (${activePlaceholders})
    `).all(...activeProjectIds);
    issuedDocuments = documentRows.filter(isIssuedDocumentRow).length;

    openActions = Number(db.prepare(`
      SELECT COUNT(DISTINCT pf.id) as count
      FROM project_followups pf
      WHERE pf.project_id IN (${activePlaceholders})
        AND LOWER(TRIM(COALESCE(pf.status, 'Open'))) NOT IN (${Array.from(OPEN_ACTION_CLOSED_STATUSES).map(() => '?').join(',')})
    `).get(...activeProjectIds, ...Array.from(OPEN_ACTION_CLOSED_STATUSES))?.count || 0);
  }

  const progressValues = activeProjects
    .map(resolveSummaryProgress)
    .filter((value) => value !== null);

  res.json({
    activeProjects: activeProjects.length,
    completedProjects: completedProjects.length,
    issuedDocuments,
    openActions,
    totalContractValue: activeProjects.reduce((total, project) => total + parseMoney(project.contract_value), 0),
    averageProgress: progressValues.length ? Math.round(progressValues.reduce((total, value) => total + value, 0) / progressValues.length) : 0,
    highRiskProjects: activeProjects.filter(isHighRiskProject).length,
    source: 'backend',
  });
});

// GET /api/projects/issues-actions-summary
router.get('/issues-actions-summary', requireAuth, requireProjectPermission('project:read'), (req, res) => {
  const db = getDb();
  let allowedProjectIds = null;
  if (getPermissionValue(req.user.role, 'projects.view') !== 'All Projects') {
    allowedProjectIds = db.prepare('SELECT project_id FROM project_memberships WHERE user_id=? AND is_active=1').all(req.user.id).map((m) => m.project_id);
    if (allowedProjectIds.length === 0) return res.json([]);
  }

  const baseSql = `
    SELECT
      pf.*,
      p.name as project_name,
      p.code as project_code
    FROM project_followups pf
    JOIN projects p ON p.id = pf.project_id
    WHERE LOWER(TRIM(COALESCE(pf.status, 'open'))) NOT IN ('completed', 'complete', 'cancelled', 'canceled', 'closed', 'done')
      AND LOWER(COALESCE(p.status,'Active'))='active'
  `;

  const rows = allowedProjectIds
    ? db.prepare(`${baseSql} AND pf.project_id IN (${allowedProjectIds.map(() => '?').join(',')}) ORDER BY datetime(pf.created_at) DESC`).all(...allowedProjectIds)
    : db.prepare(`${baseSql} ORDER BY datetime(pf.created_at) DESC`).all();

  res.json(rows);
});

// POST /api/projects
router.post('/', requireAuth, requireProjectPermission('project:create'), (req, res) => {
  try {
    const db = getDb();
    const id = uuidv4();
    const {
      code, name, client, consultant, pmc, location, sector,
      discipline, scope, contract_value, start_date, end_date, project_manager, planned_budget, actual_cost, forecast_cost, planned_progress, actual_progress, schedule_status, budget_status, resource_status, risk_status, key_highlights, key_issues, pending_decisions, pending_actions, phase_remaining_days, target_completion_date, portfolio_timeline_start, portfolio_timeline_end
    } = req.body;

    if (!code || !name) return res.status(400).json({ error: 'code and name required' });

    // Check code uniqueness
    const existing = db.prepare('SELECT id FROM projects WHERE code=?').get(code);
    if (existing) return res.status(409).json({ error: 'Project code already exists' });

    db.prepare(`
      INSERT INTO projects (id,code,name,client,consultant,pmc,location,sector,discipline,scope,contract_value,start_date,end_date,created_by,project_manager,planned_budget,actual_cost,forecast_cost,planned_progress,actual_progress,schedule_status,budget_status,resource_status,risk_status,key_highlights,key_issues,pending_decisions,pending_actions,phase_remaining_days,target_completion_date,portfolio_timeline_start,portfolio_timeline_end)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, code, name, client||'', consultant||'', pmc||'', location||'', sector||'', discipline||'', scope||'', contract_value||0, start_date||null, end_date||null, req.user.id, project_manager||'', planned_budget||0, actual_cost||0, forecast_cost||0, planned_progress||0, actual_progress||0, schedule_status||'On Track', budget_status||'On Budget', resource_status||'Adequate', risk_status||'Low', key_highlights||'', key_issues||'', pending_decisions||'', pending_actions||'', phase_remaining_days||0, target_completion_date||null, portfolio_timeline_start||start_date||null, portfolio_timeline_end||end_date||null);

    // Init numbering counters
    for (const t of TYPES) {
      db.prepare('INSERT INTO numbering_counters (id,project_id,doc_type,discipline_code,current_val) VALUES (?,?,?,?,?)').run(uuidv4(), id, t, 'GEN', 0);
    }

    // Auto-create standard discipline closeout items for new projects.
    const closeoutDisciplines = [
      ['arch', 'Architectural'], ['civil', 'Civil & Structural'], ['mech', 'Mechanical (HVAC)'], ['elec', 'Electrical'],
      ['plumbing', 'Plumbing & Drainage'], ['ff', 'Fire Fighting'], ['elv', 'Extra Low Voltage (ELV)'], ['landscape', 'Landscape'],
    ];
    const closeoutRequirements = [
      ['As-Built Drawings', 'Final discipline as-built drawings and marked-up records.'],
      ['Approved Material Submittals', 'Approved material submittals and technical data sheets.'],
      ['Approved Shop Drawings', 'Approved shop drawings and installation details.'],
      ['Inspection Records', 'Inspection requests, checklists, and acceptance records.'],
      ['Testing & Commissioning Records', 'Testing, balancing, commissioning, and verification records.'],
      ['Operation & Maintenance Manual', 'Operation and maintenance manuals for maintainable systems.'],
      ['Warranty Certificates', 'Warranty certificates and supplier guarantees.'],
      ['Final Evidence / Photos', 'Final evidence photographs and closeout confirmation records.'],
    ];
    const closeoutStmt = db.prepare(`INSERT INTO handover_items (id,project_id,discipline,package_name,package,description,required,status,category,is_applicable,created_at,updated_at) VALUES (?,?,?,?,?,?,1,'pending','standard',1,?,?)`);
    const now = new Date().toISOString();
    for (const [disciplineKey, disciplineLabel] of closeoutDisciplines) {
      for (const [packageName, description] of closeoutRequirements) {
        closeoutStmt.run(uuidv4(), id, disciplineKey, packageName, packageName, `${disciplineLabel} - ${description}`, now, now);
      }
    }

    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
    res.status(201).json(project);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// GET /api/projects/qa-dataset/status (admin only)
router.get('/qa-dataset/status', requireAuth, requireRole([ROLES.SYSTEM_ADMIN]), (req, res) => {
  const db = getDb();
  ensureProjectOptionalColumns(db);
  const counts = projectCounts(db);
  const qaProject = db.prepare('SELECT * FROM projects WHERE code=?').get(QA_PROJECT_CODE) || null;
  res.json({
    qa_project_code: QA_PROJECT_CODE,
    qa_project_exists: !!qaProject,
    qa_project: qaProject,
    counts,
  });
});

// POST /api/projects/qa-dataset/prepare (admin only)
router.post('/qa-dataset/prepare', requireAuth, requireRole([ROLES.SYSTEM_ADMIN]), (req, res) => {
  const db = getDb();
  if (req.body?.backup_confirmed !== true) {
    return res.status(400).json({ error: 'Full system backup confirmation is required before cleanup.' });
  }

  try {
    ensureProjectOptionalColumns(db);
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    const before = projectCounts(db);
    const ensureResult = ensureQaProject(db, req.user.id);
    const now = new Date().toISOString();
    const archiveResult = db.prepare(`
      UPDATE projects
      SET status='Archived', updated_at=?
      WHERE code != ?
        AND LOWER(COALESCE(status,'Active')) != 'archived'
    `).run(now, QA_PROJECT_CODE);
    const after = projectCounts(db);
    db.exec('COMMIT;');

    res.json({
      ok: true,
      message: 'Clean QA dataset prepared. SFCC-TEST-001 is active and all other projects are archived.',
      qa_project: db.prepare('SELECT * FROM projects WHERE code=?').get(QA_PROJECT_CODE),
      qa_project_created: ensureResult.created,
      qa_project_updated_missing_fields: ensureResult.updatedMissingFields,
      archived_projects_changed: archiveResult.changes || 0,
      counts_before: before,
      counts_after: after,
      preservation: {
        hard_deleted_projects: 0,
        linked_records_deleted: 0,
        numbering_counters_deleted: 0,
      },
    });
  } catch (e) {
    try { db.exec('ROLLBACK;'); } catch {}
    res.status(500).json({ error: e.message });
  }
});

// GET /api/projects/:id
router.get('/:id', requireAuth, requireProjectAccess, requireProjectPermission('project:read'), (req, res) => {
  const db = getDb();
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  res.json(p);
});

// PATCH /api/projects/:id
router.patch('/:id', requireAuth, requireProjectAccess, requireProjectPermission('project:update'), (req, res) => {
  try {
    const db = getDb();
    const p = db.prepare('SELECT id FROM projects WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });

    const allowed = ['name','client','consultant','pmc','location','sector','discipline','scope','contract_value','start_date','end_date','status','progress','project_manager','planned_budget','actual_cost','forecast_cost','planned_progress','actual_progress','schedule_status','budget_status','resource_status','risk_status','key_highlights','key_issues','pending_decisions','pending_actions','phase_remaining_days','target_completion_date','portfolio_timeline_start','portfolio_timeline_end'];
    const updates = [];
    const vals = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key}=?`);
        vals.push(req.body[key]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });
    updates.push('updated_at=?');
    vals.push(new Date().toISOString());
    vals.push(req.params.id);
    db.prepare(`UPDATE projects SET ${updates.join(',')} WHERE id=?`).run(...vals);
    res.json(db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/projects/:id (admin only - soft delete by setting status)
router.delete('/:id', requireAuth, requireRole([ROLES.SYSTEM_ADMIN]), (req, res) => {
  const db = getDb();
  db.prepare("UPDATE projects SET status='Archived', updated_at=? WHERE id=?").run(new Date().toISOString(), req.params.id);
  res.json({ message: 'Project archived' });
});

// GET /api/projects/:id/insights  — KPI dashboard data
router.get('/:id/insights', requireAuth, requireProjectAccess, requireProjectPermission('project:read'), (req, res) => {
  const db = getDb();
  const pid = req.params.id;
  const today = new Date().toISOString().split('T')[0];

  const stats = {
    total: db.prepare('SELECT COUNT(*) as c FROM documents WHERE project_id=?').get(pid).c,
    open: db.prepare("SELECT COUNT(*) as c FROM documents WHERE project_id=? AND LOWER(COALESCE(workflow_status,'open')) NOT IN ('closed','approved')").get(pid).c,
    pendingApprovals: db.prepare("SELECT COUNT(*) as c FROM documents WHERE project_id=? AND LOWER(COALESCE(approval_status,'')) NOT IN ('approved','approved as noted') AND LOWER(COALESCE(workflow_status,''))!='closed'").get(pid).c,
    issued: db.prepare("SELECT COUNT(*) as c FROM documents WHERE project_id=? AND LOWER(COALESCE(workflow_status,'')) IN ('issued','response received','closed')").get(pid).c,
    draft: db.prepare("SELECT COUNT(*) as c FROM documents WHERE project_id=? AND LOWER(COALESCE(workflow_status,'')) IN ('draft','new')").get(pid).c,
    approved: db.prepare("SELECT COUNT(*) as c FROM documents WHERE project_id=? AND approval_status IN ('Approved','Approved as Noted')").get(pid).c,
    rejected: db.prepare("SELECT COUNT(*) as c FROM documents WHERE project_id=? AND LOWER(COALESCE(approval_status,'')) IN ('rejected','revise and resubmit','resubmit')").get(pid).c,
    overdue: db.prepare("SELECT COUNT(*) as c FROM documents WHERE project_id=? AND due_date<? AND workflow_status!='Closed'").get(pid, today).c,
    byType: {},
    missingEvidence: db.prepare("SELECT COUNT(*) as c FROM documents WHERE project_id=? AND approval_status='Submitted' AND evidence_status='No Evidence'").get(pid).c,
  };

  for (const t of TYPES) {
    stats.byType[t] = db.prepare('SELECT COUNT(*) as c FROM documents WHERE project_id=? AND type=?').get(pid, t).c;
  }

  const handover = db.prepare("SELECT COUNT(*) as applicable_count, SUM(CASE WHEN LOWER(COALESCE(status,''))='approved' THEN 1 ELSE 0 END) as approved_count FROM handover_items WHERE project_id=? AND category='standard' AND COALESCE(is_applicable,1)=1").get(pid);
  const handoverDocs = db.prepare("SELECT COUNT(*) as applicable_count, SUM(CASE WHEN LOWER(COALESCE(status,''))='approved' THEN 1 ELSE 0 END) as approved_count FROM handover_items WHERE project_id=? AND category='document' AND COALESCE(is_applicable,1)=1").get(pid);
  const disciplinesReady = db.prepare("SELECT COUNT(DISTINCT discipline) as c FROM handover_items WHERE project_id=? AND COALESCE(is_applicable,1)=1 GROUP BY project_id").get(pid)?.c || 0;

  const followups = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN LOWER(COALESCE(status,'open')) IN ('completed','closed') THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN LOWER(COALESCE(status,'open')) NOT IN ('completed','closed','cancelled') THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN due_date<? AND LOWER(COALESCE(status,'open')) NOT IN ('completed','closed','cancelled') THEN 1 ELSE 0 END) as overdue FROM project_followups WHERE project_id=?").get(today, pid);
  const risks = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN LOWER(COALESCE(risk_level,'')) IN ('high','critical') THEN 1 ELSE 0 END) as highCritical, SUM(CASE WHEN LOWER(COALESCE(status,'open')) IN ('open','in progress') THEN 1 ELSE 0 END) as open, SUM(CASE WHEN LOWER(COALESCE(status,'')) IN ('mitigated','closed') THEN 1 ELSE 0 END) as closed FROM risk_register WHERE project_id=?").get(pid);
  const schedule = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN COALESCE(progress_percent,0) >= 100 THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN COALESCE(progress_percent,0) > 0 AND COALESCE(progress_percent,0) < 100 THEN 1 ELSE 0 END) as inProgress, SUM(CASE WHEN COALESCE(progress_percent,0) <= 0 THEN 1 ELSE 0 END) as notStarted, SUM(CASE WHEN planned_finish < ? AND COALESCE(progress_percent,0) < 100 THEN 1 ELSE 0 END) as overdue, ROUND(AVG(COALESCE(progress_percent,0)),0) as actualProgress, MIN(planned_start) as minStart, MAX(planned_finish) as maxFinish FROM schedule_activities WHERE project_id=?").get(today, pid);
  stats.handover = {
    overallPercent: handover.applicable_count > 0 ? Math.round((handover.approved_count || 0) / handover.applicable_count * 100) : 0,
    documentReadinessPercent: handoverDocs.applicable_count > 0 ? Math.round((handoverDocs.approved_count || 0) / handoverDocs.applicable_count * 100) : 0,
    packageCompletenessPercent: handover.applicable_count > 0 ? Math.round((handover.approved_count || 0) / handover.applicable_count * 100) : 0,
    disciplinesReady,
  };
  stats.followups = followups;
  stats.risks = risks;
  stats.schedule = schedule;
  stats.latestProgress = db.prepare("SELECT overall_pct, report_date FROM progress_reports WHERE project_id=? ORDER BY report_date DESC, created_at DESC LIMIT 1").get(pid) || null;

  res.json(stats);
});

function toStakeholderRow(row = {}) {
  return {
    id: row.id,
    project_id: row.project_id,
    company_name: row.company_name || row.name || '',
    contact_person: row.contact_person || row.contact || '',
    role: row.role || '',
    email: row.email || '',
    phone: row.phone || '',
    address: row.address || '',
    is_default_for_role: Number(row.is_default_for_role || 0),
    active: Number(row.active ?? 1),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// GET /api/projects/:id/stakeholders
router.get('/:id/stakeholders', requireAuth, requireProjectAccess, requireProjectPermission('stakeholders:read'), (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM project_stakeholders WHERE project_id=? ORDER BY role, created_at').all(req.params.id);
  res.json(rows.map(toStakeholderRow));
});

router.get('/:id/logos', requireAuth, requireProjectAccess, requireProjectPermission('stakeholders:read'), (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM project_logos WHERE project_id=? AND active=1').all(req.params.id);
  const payload = { sfcc: null, client: null, consultant: null, pmc: null };
  rows.forEach((r) => { if (payload[r.logo_type] !== undefined) payload[r.logo_type] = toLogo(r); });
  res.json(payload);
});

router.get('/:id/logos/:logoType/view', requireAuth, requireProjectAccess, requireProjectPermission('stakeholders:read'), (req, res) => {
  const { id, logoType } = req.params;
  if (!LOGO_TYPES.has(logoType)) return res.status(400).json({ error: 'Invalid logo type' });
  const db = getDb();
  const row = db.prepare('SELECT * FROM project_logos WHERE project_id=? AND logo_type=? AND active=1 ORDER BY uploaded_at DESC LIMIT 1').get(id, logoType);
  if (!row || !row.file_path) return res.status(404).json({ error: 'Logo not found' });
  const safeMimes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const normalizedMime = String(row.mime_type || '').toLowerCase();
  if (!safeMimes.has(normalizedMime)) return res.status(404).json({ error: 'Logo not found' });
  const resolvedPath = path.resolve(String(row.file_path));
  const uploadRoot = path.resolve(process.cwd(), 'uploads');
  const relativeFromRoot = path.relative(uploadRoot, resolvedPath);
  const isInsideUploads = relativeFromRoot && !relativeFromRoot.startsWith('..') && !path.isAbsolute(relativeFromRoot);
  if (!isInsideUploads || !fs.existsSync(resolvedPath)) return res.status(404).json({ error: 'Logo not found' });
  res.setHeader('Content-Type', normalizedMime);
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.sendFile(resolvedPath);
});

router.post('/:id/logos/:logoType', requireAuth, requireProjectAccess, requireProjectPermission('stakeholders:update'), logoUpload.single('logo'), handleUploadError, (req, res) => {
  const { id, logoType } = req.params;
  if (!LOGO_TYPES.has(logoType)) return res.status(400).json({ error: 'Invalid logo type' });
  if (!req.file) return res.status(400).json({ error: 'Logo file is required' });
  const db = getDb();
  db.prepare('UPDATE project_logos SET active=0 WHERE project_id=? AND logo_type=? AND active=1').run(id, logoType);
  const lid = uuidv4();
  db.prepare(`INSERT INTO project_logos
    (id, project_id, logo_type, original_filename, stored_filename, file_path, mime_type, size_bytes, uploaded_by, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
    .run(lid, id, logoType, req.file.originalname, req.file.filename, req.file.path, req.file.mimetype, req.file.size, req.user.id);
  const row = db.prepare('SELECT * FROM project_logos WHERE id=?').get(lid);
  res.status(201).json(toLogo(row));
});

router.delete('/:id/logos/:logoType', requireAuth, requireProjectAccess, requireProjectPermission('stakeholders:update'), (req, res) => {
  const { id, logoType } = req.params;
  if (!LOGO_TYPES.has(logoType)) return res.status(400).json({ error: 'Invalid logo type' });
  const db = getDb();
  db.prepare('UPDATE project_logos SET active=0 WHERE project_id=? AND logo_type=? AND active=1').run(id, logoType);
  res.json({ success: true, logo_type: logoType, active: false });
});

// POST /api/projects/:id/stakeholders
router.post('/:id/stakeholders', requireAuth, requireProjectAccess, requireProjectPermission('stakeholders:create'), (req, res) => {
  const db = getDb();
  const id = uuidv4();
  const { company_name, contact_person, role, email, phone, address, is_default_for_role, active } = req.body;
  if (!company_name || !role) return res.status(400).json({ error: 'company_name and role required' });
  if (is_default_for_role) db.prepare('UPDATE project_stakeholders SET is_default_for_role=0 WHERE project_id=? AND role=?').run(req.params.id, role);
  db.prepare('INSERT INTO project_stakeholders (id,project_id,company_name,contact_person,role,email,phone,address,is_default_for_role,active,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,datetime(\'now\'))')
    .run(id, req.params.id, company_name, contact_person||'', role, email||'', phone||'', address||'', is_default_for_role ? 1 : 0, active === 0 ? 0 : 1);
  res.status(201).json(toStakeholderRow(db.prepare('SELECT * FROM project_stakeholders WHERE id=?').get(id)));
});

// PATCH /api/projects/:id/stakeholders/:sid
router.patch('/:id/stakeholders/:sid', requireAuth, requireProjectAccess, requireProjectPermission('stakeholders:update'), (req, res) => {
  const db = getDb();
  const current = db.prepare('SELECT * FROM project_stakeholders WHERE id=? AND project_id=?').get(req.params.sid, req.params.id);
  if (!current) return res.status(404).json({ error: 'Not found' });
  const next = {
    company_name: req.body.company_name ?? current.company_name,
    contact_person: req.body.contact_person ?? current.contact_person,
    role: req.body.role ?? current.role,
    email: req.body.email ?? current.email,
    phone: req.body.phone ?? current.phone,
    address: req.body.address ?? current.address,
    is_default_for_role: req.body.is_default_for_role ?? current.is_default_for_role,
    active: req.body.active ?? current.active,
  };
  if (next.is_default_for_role) db.prepare('UPDATE project_stakeholders SET is_default_for_role=0 WHERE project_id=? AND role=?').run(req.params.id, next.role);
  db.prepare('UPDATE project_stakeholders SET company_name=?,contact_person=?,role=?,email=?,phone=?,address=?,is_default_for_role=?,active=?,updated_at=datetime(\'now\') WHERE id=? AND project_id=?')
    .run(next.company_name, next.contact_person, next.role, next.email, next.phone, next.address, next.is_default_for_role ? 1 : 0, next.active ? 1 : 0, req.params.sid, req.params.id);
  res.json(toStakeholderRow(db.prepare('SELECT * FROM project_stakeholders WHERE id=?').get(req.params.sid)));
});


// DELETE /api/projects/:id/stakeholders/:sid
router.delete('/:id/stakeholders/:sid', requireAuth, requireProjectAccess, requireProjectPermission('stakeholders:delete'), (req, res) => {
  const db = getDb();
  db.prepare('UPDATE project_stakeholders SET active=0,updated_at=datetime(\'now\') WHERE id=? AND project_id=?').run(req.params.sid, req.params.id);
  res.json({ message: 'Deleted' });
});


// GET /api/projects/:id/handover
router.get('/:id/handover', requireAuth, requireProjectAccess, requireProjectPermission('handover:read'), (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM handover_items WHERE project_id=? ORDER BY package').all(req.params.id));
});

// PATCH /api/projects/:id/handover/:hid
router.patch('/:id/handover/:hid', requireAuth, requireProjectAccess, requireProjectPermission('handover:update'), (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT project_id FROM handover_items WHERE id=?').get(req.params.hid);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.project_id !== req.params.id) return res.status(404).json({ error: 'Not found' });
  const { received, approved, notes } = req.body;
  db.prepare('UPDATE handover_items SET received=?,approved=?,notes=?,updated_at=? WHERE id=?')
    .run(received !== undefined ? received : 0, approved !== undefined ? approved : 0, notes||'', new Date().toISOString(), req.params.hid);
  res.json(db.prepare('SELECT * FROM handover_items WHERE id=?').get(req.params.hid));
});

module.exports = router;
