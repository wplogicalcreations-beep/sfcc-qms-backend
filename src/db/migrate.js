// Run this ONCE to add new columns and tables
// node src/db/migrate.js

require('dotenv').config();
const { getDb } = require('./schema');

function migrate() {
  const db = getDb();
  console.log('Running migrations...');

  // Add form_data column to documents (stores all form fields as JSON)
  try {
    db.exec('ALTER TABLE documents ADD COLUMN form_data TEXT');
    console.log('✅ Added form_data column to documents');
  } catch(e) {
    if (e.message.includes('duplicate column')) console.log('ℹ️  form_data column already exists');
    else console.log('ℹ️  form_data:', e.message);
  }

  // Progress reports table
  db.exec(`
    CREATE TABLE IF NOT EXISTS progress_reports (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL,
      ref           TEXT NOT NULL,
      report_date   TEXT NOT NULL,
      period_from   TEXT,
      period_to     TEXT,
      prepared_by   TEXT,
      overall_pct   REAL DEFAULT 0,
      status        TEXT DEFAULT 'Draft',
      summary       TEXT,
      work_done     TEXT,
      work_planned  TEXT,
      issues        TEXT,
      created_by    TEXT,
      created_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS progress_photos (
      id           TEXT PRIMARY KEY,
      report_id    TEXT NOT NULL,
      project_id   TEXT NOT NULL,
      caption      TEXT,
      stored_name  TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_size    INTEGER,
      uploaded_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (report_id) REFERENCES progress_reports(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS risk_register (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL,
      ref             TEXT NOT NULL,
      title           TEXT NOT NULL,
      category        TEXT,
      description     TEXT,
      likelihood      INTEGER DEFAULT 3,
      consequence     INTEGER DEFAULT 3,
      risk_rating     INTEGER,
      risk_level      TEXT,
      mitigation      TEXT,
      contingency     TEXT,
      owner           TEXT,
      status          TEXT DEFAULT 'Open',
      review_date     TEXT,
      residual_likelihood INTEGER DEFAULT 2,
      residual_consequence INTEGER DEFAULT 2,
      residual_rating  INTEGER,
      residual_level   TEXT,
      created_by      TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_progress_project ON progress_reports(project_id);
    CREATE INDEX IF NOT EXISTS idx_risk_project ON risk_register(project_id);
  `);
  console.log('✅ Created progress_reports, progress_photos, risk_register tables');

  const hasQmsTemplates = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='qms_form_templates'").get();
  if (!hasQmsTemplates) {
    db.exec(`CREATE TABLE IF NOT EXISTS qms_form_templates (
      id TEXT PRIMARY KEY, template_key TEXT NOT NULL UNIQUE, document_type TEXT NOT NULL,
      title TEXT NOT NULL, revision TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Draft',
      html_template TEXT NOT NULL, css_template TEXT NOT NULL, placeholders_json TEXT,
      is_active INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    console.log('✅ Created qms_form_templates table');
  } else {
    console.log('ℹ️ qms_form_templates already exists');
  }
  db.prepare("PRAGMA table_info(qms_form_templates)").all();

  console.log('Migration complete.');
}

migrate();
