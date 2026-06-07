const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/schema');
const { requireAuth, requireProjectAccess, requireProjectAccessByRecord, requireProjectPermission } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_STATUSES = new Set(['Not Started', 'In Progress', 'Complete', 'Overdue', 'On Hold']);

function normalizeIsoDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function deriveStatus(progressPercent, plannedFinish, status) {
  const normalizedProgress = Math.max(0, Math.min(100, Number(progressPercent || 0)));
  const baseStatus = ALLOWED_STATUSES.has(status) ? status : 'Not Started';
  if (normalizedProgress >= 100) return 'Complete';
  const today = new Date().toISOString().slice(0, 10);
  if (plannedFinish && plannedFinish < today && normalizedProgress < 100 && baseStatus !== 'On Hold') return 'Overdue';
  if (baseStatus === 'Overdue' && plannedFinish && plannedFinish >= today && normalizedProgress < 100) return 'In Progress';
  if (baseStatus === 'Not Started' && normalizedProgress > 0) return 'In Progress';
  return baseStatus;
}


function firstDefined(obj, keys = []) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      return obj[key];
    }
  }
  return undefined;
}

function looksLikeInternalId(value) {
  if (!value) return false;
  const raw = String(value).trim();
  if (!raw) return false;
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw);
  const longHex = /^[0-9a-f]{24,}$/i.test(raw);
  const knownInternal = raw.startsWith('tmp-') || raw.startsWith('internal-');
  return uuidLike || longHex || knownInternal;
}

function normalizeImportedActivity(activity = {}, index = 0, source = 'imported') {
  const normalized = {
    wbs: firstDefined(activity, ['wbs', 'WBS']),
    activity_id: firstDefined(activity, ['activity_id', 'Activity ID', 'activityId', 'id']),
    activity_name: firstDefined(activity, ['activity_name', 'Activity Name', 'activityName', 'name', 'taskName']),
    planned_start: firstDefined(activity, ['planned_start', 'start', 'Start', 'startDate']),
    planned_finish: firstDefined(activity, ['planned_finish', 'finish', 'Finish', 'finishDate']),
    duration_days: firstDefined(activity, ['duration_days', 'duration', 'Duration']),
    progress_percent: firstDefined(activity, ['progress_percent', 'progress', 'Progress', 'percentComplete']),
    status: firstDefined(activity, ['status']),
    responsible_person: firstDefined(activity, ['responsible_person', 'responsible', 'Responsible', 'owner']),
    remarks: firstDefined(activity, ['remarks', 'notes', 'Remarks']),
    source: firstDefined(activity, ['source']) || source,
    sort_order: firstDefined(activity, ['sort_order']) ?? index,
  };

  if (normalized.wbs && looksLikeInternalId(normalized.wbs) && normalized.activity_id) {
    normalized.wbs = null;
  }

  normalized.activity_name = normalized.activity_name || normalized.activity_id || normalized.wbs;
  return normalized;
}

function mapActivity(payload = {}, fallback = {}) {
  const progressPercent = Math.max(0, Math.min(100, Number(payload.progress_percent ?? payload.percent ?? fallback.progress_percent ?? 0)));
  const plannedFinish = normalizeIsoDate(payload.planned_finish ?? payload.finish ?? fallback.planned_finish);
  const status = deriveStatus(progressPercent, plannedFinish, payload.status ?? fallback.status);

  return {
    id: payload.id || fallback.id || uuidv4(),
    project_id: payload.project_id || fallback.project_id,
    wbs: payload.wbs ?? fallback.wbs ?? null,
    activity_id: payload.activity_id ?? payload.external_activity_id ?? fallback.activity_id ?? null,
    activity_name: payload.activity_name ?? payload.name ?? fallback.activity_name,
    planned_start: normalizeIsoDate(payload.planned_start ?? payload.start ?? fallback.planned_start),
    planned_finish: plannedFinish,
    actual_start: normalizeIsoDate(payload.actual_start ?? fallback.actual_start),
    actual_finish: normalizeIsoDate(payload.actual_finish ?? fallback.actual_finish),
    duration_days: Number.isFinite(Number(payload.duration_days ?? payload.duration ?? fallback.duration_days)) ? Number(payload.duration_days ?? payload.duration ?? fallback.duration_days) : null,
    progress_percent: progressPercent,
    status,
    responsible_person: payload.responsible_person ?? payload.responsible ?? fallback.responsible_person ?? null,
    remarks: payload.remarks ?? fallback.remarks ?? null,
    source: payload.source ?? fallback.source ?? 'manual',
    sort_order: Number.isFinite(Number(payload.sort_order ?? fallback.sort_order)) ? Number(payload.sort_order ?? fallback.sort_order) : null,
    created_by: fallback.created_by || payload.created_by || null,
  };
}

router.get('/', requireAuth, requireProjectPermission('project:read'), requireProjectAccess, (req, res) => {
  const { project_id } = req.query;
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM schedule_activities
    WHERE project_id=?
    ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END, sort_order ASC, planned_start ASC, created_at ASC
  `).all(project_id);
  return res.json(rows);
});

router.post('/', requireAuth, requireProjectAccess, requireProjectPermission('project:update'), (req, res) => {
  const db = getDb();
  const row = mapActivity({ ...req.body, source: req.body.source || 'manual' });
  if (!row.project_id || !row.activity_name) return res.status(400).json({ error: 'project_id and activity_name are required' });

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO schedule_activities (
      id, project_id, wbs, activity_id, activity_name, planned_start, planned_finish, actual_start, actual_finish,
      duration_days, progress_percent, status, responsible_person, remarks, source, sort_order, created_by, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    row.id, row.project_id, row.wbs, row.activity_id, row.activity_name, row.planned_start, row.planned_finish, row.actual_start, row.actual_finish,
    row.duration_days, row.progress_percent, row.status, row.responsible_person, row.remarks, row.source, row.sort_order, req.user.id, now, now,
  );

  const created = db.prepare('SELECT * FROM schedule_activities WHERE id=?').get(row.id);
  return res.status(201).json(created);
});

router.post('/import', requireAuth, requireProjectAccess, requireProjectPermission('project:update'), (req, res) => {
  const db = getDb();
  const { project_id, activities, replace = true } = req.body || {};
  if (!project_id) return res.status(400).json({ error: 'project_id is required' });
  if (!Array.isArray(activities)) return res.status(400).json({ error: 'activities array is required' });
  if (activities.length === 0) return res.status(400).json({ error: 'no valid schedule activities found' });

  const now = new Date().toISOString();

  try {
    db.exec('BEGIN IMMEDIATE TRANSACTION');

    if (replace) {
      db.prepare("DELETE FROM schedule_activities WHERE project_id=? AND source IN ('imported', 'xer', 'xml', 'csv')").run(project_id);
    }

    const stmt = db.prepare(`
      INSERT INTO schedule_activities (
        id, project_id, wbs, activity_id, activity_name, planned_start, planned_finish, actual_start, actual_finish,
        duration_days, progress_percent, status, responsible_person, remarks, source, sort_order, created_by, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    let inserted = 0;
    let skipped = 0;
    for (let idx = 0; idx < activities.length; idx += 1) {
      const normalized = normalizeImportedActivity(activities[idx], idx);
      const row = mapActivity({ ...normalized, project_id });
      if (!row.activity_name) {
        skipped += 1;
        continue;
      }

      stmt.run(
        row.id || uuidv4(), project_id, row.wbs, row.activity_id, row.activity_name, row.planned_start, row.planned_finish, row.actual_start, row.actual_finish,
        row.duration_days, row.progress_percent, row.status, row.responsible_person, row.remarks, row.source, row.sort_order, req.user.id, now, now,
      );
      inserted += 1;
    }

    if (inserted === 0) {
      const error = new Error('no valid schedule activities found');
      error.code = 'NO_VALID_ROWS';
      throw error;
    }

    db.exec('COMMIT');

    return res.json({
      imported: inserted,
      skipped,
      message: `Imported ${inserted} schedule activities`,
    });
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (rollbackError) {
      console.error('Schedule import rollback failed', { project_id, error: rollbackError.message });
    }
    console.error('Schedule import failed', { project_id, error: error.message });
    if (error?.code === 'NO_VALID_ROWS') return res.status(400).json({ error: 'no valid schedule activities found' });
    if (error?.message?.includes('constraint') || error?.message?.includes('validation')) return res.status(400).json({ error: 'invalid schedule activity data' });
    return res.status(400).json({ error: error?.message || 'Invalid schedule import data' });
  }
});

router.patch('/:id', requireAuth, requireProjectPermission('project:update'), (req, res) => {
  const db = getDb();
  const existing = requireProjectAccessByRecord(req, res, 'SELECT * FROM schedule_activities WHERE id=?', [req.params.id]);
  if (!existing) return;

  const merged = mapActivity(req.body || {}, existing);
  if (!merged.activity_name) return res.status(400).json({ error: 'activity_name is required' });

  db.prepare(`
    UPDATE schedule_activities SET
      wbs=?, activity_id=?, activity_name=?, planned_start=?, planned_finish=?, actual_start=?, actual_finish=?, duration_days=?, progress_percent=?, status=?,
      responsible_person=?, remarks=?, source=?, sort_order=?, updated_at=?
    WHERE id=?
  `).run(
    merged.wbs, merged.activity_id, merged.activity_name, merged.planned_start, merged.planned_finish, merged.actual_start, merged.actual_finish,
    merged.duration_days, merged.progress_percent, merged.status, merged.responsible_person, merged.remarks, merged.source, merged.sort_order,
    new Date().toISOString(), req.params.id,
  );

  const updated = db.prepare('SELECT * FROM schedule_activities WHERE id=?').get(req.params.id);
  return res.json(updated);
});

router.delete('/:id', requireAuth, requireProjectPermission('project:update'), (req, res) => {
  const db = getDb();
  const existing = requireProjectAccessByRecord(req, res, 'SELECT project_id FROM schedule_activities WHERE id=?', [req.params.id]);
  if (!existing) return;

  db.prepare('DELETE FROM schedule_activities WHERE id=?').run(req.params.id);
  return res.json({ ok: true });
});

module.exports = router;
