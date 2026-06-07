const { getDb } = require('../db/schema');

const APP_NAME = 'SFCC QMS Platform';
const BACKUP_VERSION = '1.0';
const FILE_LIMITATION_NOTE = 'This backup includes database records and file references. Physical uploaded files must be backed up from the uploads folder unless ZIP backup is implemented.';

const APPROVED_BACKUP_TABLES = new Set([
  'users',
  'projects',
  'project_memberships',
  'project_stakeholders',
  'project_logos',
  'qms_form_templates',
  'numbering_counters',
  'stakeholders',
  'documents',
  'doc_history',
  'attachments',
  'safety_records',
  'handover_items',
  'schedule_activities',
  'project_followups',
  'notifications',
  'progress_reports',
  'progress_report_documents',
  'progress_report_schedule_items',
  'progress_photos',
  'risk_register',
]);
const RESTORE_ORDER = Array.from(APPROVED_BACKUP_TABLES);

function allUserTables(db) {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all();
  return rows.map((row) => row.name);
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function selectAll(db, table) {
  return db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all();
}

function selectWhereProject(db, table, projectId) {
  return db.prepare(`SELECT * FROM ${quoteIdentifier(table)} WHERE project_id=?`).all(projectId);
}

function countRecords(data) {
  return Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.length]));
}

function getUserLabel(user) {
  return user?.email || user?.name || user?.id || 'system';
}

function buildBackup(metadata, data) {
  const recordCounts = countRecords(data);
  return {
    metadata: {
      backup_version: BACKUP_VERSION,
      generated_at: new Date().toISOString(),
      app_name: APP_NAME,
      database_type: 'sqlite',
      table_count: Object.keys(data).length,
      record_counts: recordCounts,
      notes: [FILE_LIMITATION_NOTE, 'Safe restore mode skips duplicate records and does not delete, reset, or overwrite existing active data.'],
      limitations: [FILE_LIMITATION_NOTE],
      ...metadata,
    },
    data,
  };
}

function createFullBackup(user) {
  const db = getDb();
  const data = {};
  for (const table of allUserTables(db)) data[table] = selectAll(db, table);
  return buildBackup({ backup_scope: 'full', generated_by: getUserLabel(user) }, data);
}

function getProject(db, projectId) {
  return db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
}

function createProjectBackup(projectId, user) {
  const db = getDb();
  const project = getProject(db, projectId);
  if (!project) return null;

  const tables = allUserTables(db);
  const data = {};
  for (const table of tables) {
    const columns = new Set(tableColumns(db, table).map((col) => col.name));
    if (table === 'projects') data[table] = [project];
    else if (columns.has('project_id')) data[table] = selectWhereProject(db, table, projectId);
  }

  const projectDocumentIds = new Set((data.documents || []).map((row) => row.id));
  const projectReportIds = new Set((data.progress_reports || []).map((row) => row.id));

  if (tables.includes('doc_history') && projectDocumentIds.size) {
    data.doc_history = db.prepare(`SELECT h.* FROM doc_history h JOIN documents d ON d.id=h.doc_id WHERE d.project_id=?`).all(projectId);
  }
  if (tables.includes('progress_report_documents') && projectReportIds.size) {
    data.progress_report_documents = db.prepare(`SELECT prd.* FROM progress_report_documents prd JOIN progress_reports pr ON pr.id=prd.report_id WHERE pr.project_id=?`).all(projectId);
  }
  if (tables.includes('progress_report_schedule_items') && projectReportIds.size) {
    data.progress_report_schedule_items = db.prepare(`SELECT psi.* FROM progress_report_schedule_items psi JOIN progress_reports pr ON pr.id=psi.report_id WHERE pr.project_id=?`).all(projectId);
  }
  if (tables.includes('users') && tables.includes('project_memberships')) {
    data.users = db.prepare(`SELECT DISTINCT u.* FROM users u JOIN project_memberships pm ON pm.user_id=u.id WHERE pm.project_id=?`).all(projectId);
  }

  return buildBackup({
    backup_scope: 'project',
    project_id: project.id,
    project_name: project.name,
    project_code: project.code,
    generated_by: getUserLabel(user),
  }, data);
}

function parseBackupPayload(payload) {
  if (!payload || typeof payload !== 'object') return { valid: false, errors: ['Backup file must contain a JSON object.'] };
  const metadata = payload.metadata;
  const data = payload.data;
  const errors = [];
  const warnings = [];
  if (!metadata || typeof metadata !== 'object') errors.push('Missing metadata object.');
  if (!data || typeof data !== 'object' || Array.isArray(data)) errors.push('Missing data table object.');
  if (metadata) {
    if (metadata.app_name !== APP_NAME) warnings.push('Backup app_name does not exactly match SFCC QMS Platform.');
    if (!metadata.backup_version) errors.push('Missing backup_version.');
    if (!metadata.backup_scope || !['full', 'project'].includes(metadata.backup_scope)) errors.push('backup_scope must be full or project.');
    if (!metadata.generated_at) warnings.push('Missing generated_at metadata.');
  }
  if (data) {
    for (const [table, rows] of Object.entries(data)) {
      if (!Array.isArray(rows)) errors.push(`Table ${table} must be an array.`);
    }
  }
  return { valid: errors.length === 0, errors, warnings, metadata, data };
}

function summarizeBackup(payload) {
  const parsed = parseBackupPayload(payload);
  const recordCounts = parsed.data ? countRecords(parsed.data) : {};
  return {
    valid: parsed.valid,
    errors: parsed.errors,
    warnings: [...parsed.warnings, FILE_LIMITATION_NOTE],
    preview: parsed.metadata ? {
      backup_version: parsed.metadata.backup_version,
      backup_scope: parsed.metadata.backup_scope,
      generated_at: parsed.metadata.generated_at,
      generated_by: parsed.metadata.generated_by,
      project_id: parsed.metadata.project_id,
      project_name: parsed.metadata.project_name,
      project_code: parsed.metadata.project_code,
      included_tables: Object.keys(parsed.data || {}),
      table_count: Object.keys(parsed.data || {}).length,
      record_counts: recordCounts,
      notes: parsed.metadata.notes || [],
      limitations: parsed.metadata.limitations || [FILE_LIMITATION_NOTE],
    } : null,
  };
}

function orderedTables(data) {
  const names = Object.keys(data || {});
  const known = RESTORE_ORDER.filter((table) => names.includes(table));
  const rest = names.filter((table) => !known.includes(table)).sort();
  return [...known, ...rest];
}

function primaryKeyColumn(columns) {
  const pk = columns.find((col) => col.pk === 1);
  return pk?.name || (columns.some((col) => col.name === 'id') ? 'id' : null);
}

function rowExistsByPk(db, table, pk, value) {
  if (value === undefined || value === null || value === '') return false;
  return !!db.prepare(`SELECT 1 FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(pk)}=? LIMIT 1`).get(value);
}

function isSqliteInternalTable(table) {
  return String(table || '').toLowerCase().startsWith('sqlite_');
}

function isApprovedBackupTable(table) {
  return APPROVED_BACKUP_TABLES.has(table);
}

function makeEmptyRestoreResult(parsed, summary, dryRun) {
  return {
    ok: parsed.valid,
    mode: dryRun ? 'dry_run' : 'restore',
    dry_run: !!dryRun,
    valid: parsed.valid,
    preview: summary.preview,
    imported_counts: {},
    skipped_counts: {},
    warning_count: summary.warnings.length,
    error_count: summary.errors.length,
    warnings: [...summary.warnings],
    errors: [...summary.errors],
    duplicate_details: [],
    duplicates: [],
  };
}

function addDuplicate(result, detail) {
  result.duplicate_details.push(detail);
  result.duplicates = result.duplicate_details;
}

function addWarningOnce(result, warning) {
  if (!result.warnings.includes(warning)) result.warnings.push(warning);
}

function sanitizeErrorMessage(error) {
  return String(error?.message || error || 'Unknown restore error.')
    .replace(/\b(?:[A-Za-z]:)?[\/][^\n\r\t ]+/g, '[path]');
}

function uniqueIndexes(db, table, tableColumnNames) {
  return db.prepare(`PRAGMA index_list(${quoteIdentifier(table)})`).all()
    .filter((index) => Number(index.unique) === 1)
    .map((index) => ({
      name: index.name,
      columns: db.prepare(`PRAGMA index_info(${quoteIdentifier(index.name)})`).all().map((col) => col.name),
    }))
    .filter((index) => index.columns.length > 0 && index.columns.every((name) => tableColumnNames.has(name)));
}

function duplicateUniqueIndex(db, table, row, indexes, pk) {
  for (const index of indexes) {
    const values = index.columns.map((name) => row[name]);
    if (values.some((value) => value === undefined || value === null || value === '')) continue;
    const where = index.columns.map((name) => `${quoteIdentifier(name)}=?`).join(' AND ');
    const hit = db.prepare(`SELECT ${pk ? quoteIdentifier(pk) : 'rowid'} AS restore_match_id FROM ${quoteIdentifier(table)} WHERE ${where} LIMIT 1`).get(...values);
    if (hit && (!pk || hit.restore_match_id !== row[pk])) {
      return `duplicate unique index ${index.name} (${index.columns.join(', ')})`;
    }
  }
  return null;
}

function duplicateReference(db, table, row, columnNames) {
  if (table === 'documents' && row.project_id && row.type && row.ref && columnNames.has('project_id') && columnNames.has('type') && columnNames.has('ref')) {
    const hit = db.prepare('SELECT id FROM documents WHERE project_id=? AND type=? AND ref=? LIMIT 1').get(row.project_id, row.type, row.ref);
    if (hit && hit.id !== row.id) return `duplicate document reference ${row.ref}`;
  }
  if (table === 'progress_reports' && row.project_id) {
    if (row.report_no && columnNames.has('report_no')) {
      const hit = db.prepare('SELECT id FROM progress_reports WHERE project_id=? AND report_no=? LIMIT 1').get(row.project_id, row.report_no);
      if (hit && hit.id !== row.id) return `duplicate progress report number ${row.report_no}`;
    }
    if (row.ref && columnNames.has('ref')) {
      const hit = db.prepare('SELECT id FROM progress_reports WHERE project_id=? AND ref=? LIMIT 1').get(row.project_id, row.ref);
      if (hit && hit.id !== row.id) return `duplicate progress report reference ${row.ref}`;
    }
  }
  if (table === 'projects' && row.code && columnNames.has('code')) {
    const hit = db.prepare('SELECT id FROM projects WHERE code=? LIMIT 1').get(row.code);
    if (hit && hit.id !== row.id) return `duplicate project code ${row.code}`;
  }
  if (table === 'users' && row.email && columnNames.has('email')) {
    const hit = db.prepare('SELECT id FROM users WHERE email=? LIMIT 1').get(row.email);
    if (hit && hit.id !== row.id) return `duplicate user email ${row.email}`;
  }
  return null;
}


function normalizeCounterScopeValue(value, fallback = 'GEN') {
  const cleaned = String(value || '').trim().toUpperCase();
  return cleaned || fallback;
}

function mergeNumberingCounterWithoutRollback(db, row, columnNames, { dryRun = true } = {}) {
  if (!row || !row.project_id || !row.doc_type || !columnNames.has('project_id') || !columnNames.has('doc_type') || !columnNames.has('current_val')) return false;
  const disciplineCode = columnNames.has('discipline_code') ? normalizeCounterScopeValue(row.discipline_code) : 'GEN';
  const docType = normalizeCounterScopeValue(row.doc_type);
  const incomingVal = Math.max(0, Number(row.current_val || 0));
  const existing = db.prepare(`
    SELECT id, current_val
    FROM numbering_counters
    WHERE project_id=? AND UPPER(TRIM(doc_type))=? AND UPPER(TRIM(COALESCE(discipline_code,'GEN')))=?
    LIMIT 1
  `).get(row.project_id, docType, disciplineCode);

  if (!existing) return false;
  if (!dryRun && incomingVal > Number(existing.current_val || 0)) {
    const setUpdatedAt = columnNames.has('updated_at') ? ", updated_at=datetime('now')" : '';
    db.prepare(`UPDATE numbering_counters SET current_val=?${setUpdatedAt} WHERE id=?`).run(incomingVal, existing.id);
  }
  return true;
}

function filterInsertableRow(row, tableColumnNames) {
  return Object.fromEntries(Object.entries(row || {}).filter(([name]) => tableColumnNames.has(name)));
}

function buildInsert(db, table, row) {
  const columns = Object.keys(row);
  if (!columns.length) return null;
  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${placeholders})`;
  return { statement: db.prepare(sql), values: columns.map((name) => row[name]) };
}

function isDuplicateConstraint(error) {
  return error?.code?.startsWith?.('SQLITE_CONSTRAINT') || /constraint failed|unique constraint failed/i.test(error?.message || '');
}

function restoreBackup(payload, { dryRun = true } = {}) {
  const parsed = parseBackupPayload(payload);
  const summary = summarizeBackup(payload);
  const result = makeEmptyRestoreResult(parsed, summary, dryRun);
  if (!parsed.valid) return result;

  const db = getDb();
  const existingTables = new Set(allUserTables(db));

  try {
    for (const table of orderedTables(parsed.data)) {
      const rows = parsed.data[table] || [];
      result.imported_counts[table] = 0;
      result.skipped_counts[table] = 0;

      if (isSqliteInternalTable(table)) {
        result.skipped_counts[table] += rows.length;
        addWarningOnce(result, `Skipped SQLite internal table ${table}.`);
        continue;
      }
      if (!isApprovedBackupTable(table)) {
        result.skipped_counts[table] += rows.length;
        addWarningOnce(result, `Skipped unknown or unapproved backup table ${table}.`);
        continue;
      }
      if (!existingTables.has(table)) {
        result.skipped_counts[table] += rows.length;
        addWarningOnce(result, `Skipped missing table ${table}.`);
        continue;
      }

      const columns = tableColumns(db, table);
      const columnNames = new Set(columns.map((col) => col.name));
      const pk = primaryKeyColumn(columns);
      const indexes = uniqueIndexes(db, table, columnNames);

      for (const originalRow of rows) {
        const row = filterInsertableRow(originalRow, columnNames);
        const removedColumns = Object.keys(originalRow || {}).filter((name) => !columnNames.has(name));
        if (removedColumns.length) addWarningOnce(result, `Ignored unknown column(s) in ${table}: ${removedColumns.join(', ')}.`);

        const rowId = pk ? row[pk] : row.id;
        if (pk && rowExistsByPk(db, table, pk, rowId)) {
          if (table === 'numbering_counters') mergeNumberingCounterWithoutRollback(db, row, columnNames, { dryRun });
          result.skipped_counts[table] += 1;
          addDuplicate(result, { table, id: rowId, reason: `duplicate primary key ${pk}` });
          continue;
        }

        const duplicateReason = duplicateReference(db, table, row, columnNames) || duplicateUniqueIndex(db, table, row, indexes, pk);
        if (duplicateReason) {
          if (table === 'numbering_counters') mergeNumberingCounterWithoutRollback(db, row, columnNames, { dryRun });
          result.skipped_counts[table] += 1;
          addDuplicate(result, { table, id: rowId, reason: duplicateReason });
          continue;
        }

        if (!Object.keys(row).length) {
          result.skipped_counts[table] += 1;
          result.errors.push(`${table}:${rowId || 'unknown'} has no columns matching the current schema.`);
          continue;
        }

        if (dryRun) {
          result.imported_counts[table] += 1;
          continue;
        }

        try {
          const insert = buildInsert(db, table, row);
          insert.statement.run(...insert.values);
          result.imported_counts[table] += 1;
        } catch (error) {
          result.skipped_counts[table] += 1;
          const safeMessage = sanitizeErrorMessage(error);
          if (isDuplicateConstraint(error)) {
            addDuplicate(result, { table, id: rowId, reason: safeMessage });
          } else {
            result.errors.push(`${table}:${rowId || 'unknown'} ${safeMessage}`);
          }
        }
      }
    }
  } catch (error) {
    result.errors.push(`Restore stopped safely: ${sanitizeErrorMessage(error)}`);
  }

  result.warning_count = result.warnings.length;
  result.error_count = result.errors.length;
  result.ok = result.valid && result.error_count === 0;
  result.duplicates = result.duplicate_details;
  return result;
}

module.exports = {
  FILE_LIMITATION_NOTE,
  createFullBackup,
  createProjectBackup,
  summarizeBackup,
  restoreBackup,
};
