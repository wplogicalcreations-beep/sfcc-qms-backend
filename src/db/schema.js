// Uses Node.js built-in SQLite (Node v22+, stable in v24) — no npm install needed
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PLACEHOLDERS, cssTemplate, htmlTemplate } = require('../templates/controlledTransmittalTemplate');

const DB_PATH = process.env.DB_PATH || './data/sfcc_qms.db';
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

let db;

function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
  }

  ensureQmsFormTemplatesTable(db);
  ensureProjectStakeholdersTable(db);
  ensureProjectLogosTable(db);
  seedControlledTransmittalTemplate(db);
  seedControlledMaterialSubmittalTemplate(db);

  return db;
}

function ensureProjectLogosTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_logos (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      logo_type TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      uploaded_by TEXT,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project_logos_project_type_active ON project_logos(project_id, logo_type, active);
  `);
  const requiredColumns = {
    id: 'TEXT PRIMARY KEY',
    project_id: 'TEXT NOT NULL',
    logo_type: 'TEXT NOT NULL',
    original_filename: 'TEXT NOT NULL',
    stored_filename: 'TEXT NOT NULL',
    file_path: 'TEXT NOT NULL',
    mime_type: 'TEXT NOT NULL',
    size_bytes: 'INTEGER NOT NULL DEFAULT 0',
    uploaded_by: 'TEXT',
    uploaded_at: "TEXT NOT NULL DEFAULT (datetime('now'))",
    active: 'INTEGER NOT NULL DEFAULT 1',
  };
  const existing = db.prepare('PRAGMA table_info(project_logos)').all();
  const existingNames = new Set(existing.map((col) => col.name));
  for (const [name, def] of Object.entries(requiredColumns)) {
    if (!existingNames.has(name)) db.exec(`ALTER TABLE project_logos ADD COLUMN ${name} ${def}`);
  }
}

function ensureProjectStakeholdersTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_stakeholders (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      company_name TEXT NOT NULL,
      contact_person TEXT,
      role TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address TEXT,
      is_default_for_role INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_project_stakeholders_project_role ON project_stakeholders(project_id, role);
  `);
  const requiredColumns = {
    id: 'TEXT PRIMARY KEY',
    project_id: 'TEXT NOT NULL',
    company_name: 'TEXT NOT NULL',
    contact_person: 'TEXT',
    role: 'TEXT NOT NULL',
    email: 'TEXT',
    phone: 'TEXT',
    address: 'TEXT',
    is_default_for_role: 'INTEGER NOT NULL DEFAULT 0',
    active: 'INTEGER NOT NULL DEFAULT 1',
    created_at: "TEXT NOT NULL DEFAULT (datetime('now'))",
    updated_at: "TEXT NOT NULL DEFAULT (datetime('now'))",
  };
  const existing = db.prepare('PRAGMA table_info(project_stakeholders)').all();
  const existingNames = new Set(existing.map((col) => col.name));
  for (const [name, def] of Object.entries(requiredColumns)) {
    if (!existingNames.has(name)) db.exec(`ALTER TABLE project_stakeholders ADD COLUMN ${name} ${def}`);
  }
}

function ensureQmsFormTemplatesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS qms_form_templates (
      id TEXT PRIMARY KEY,
      template_key TEXT NOT NULL UNIQUE,
      document_type TEXT NOT NULL,
      title TEXT NOT NULL,
      revision TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Draft',
      html_template TEXT NOT NULL,
      css_template TEXT NOT NULL,
      placeholders_json TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_qms_form_templates_doc_type ON qms_form_templates(document_type);
    CREATE INDEX IF NOT EXISTS idx_qms_form_templates_active ON qms_form_templates(document_type, status, is_active);
  `);

  const requiredColumns = {
    id: 'TEXT PRIMARY KEY',
    template_key: 'TEXT NOT NULL UNIQUE',
    document_type: 'TEXT NOT NULL',
    title: 'TEXT NOT NULL',
    revision: 'TEXT NOT NULL',
    status: "TEXT NOT NULL DEFAULT 'Draft'",
    html_template: 'TEXT NOT NULL',
    css_template: 'TEXT NOT NULL',
    placeholders_json: 'TEXT',
    is_active: 'INTEGER NOT NULL DEFAULT 0',
    created_at: "TEXT NOT NULL DEFAULT (datetime('now'))",
    updated_at: "TEXT NOT NULL DEFAULT (datetime('now'))"
  };

  const existing = db.prepare('PRAGMA table_info(qms_form_templates)').all();
  const existingNames = new Set(existing.map((col) => col.name));
  for (const [name, def] of Object.entries(requiredColumns)) {
    if (!existingNames.has(name)) {
      db.exec(`ALTER TABLE qms_form_templates ADD COLUMN ${name} ${def}`);
    }
  }
}

function seedControlledTransmittalTemplate(db) {
  const v2 = db.prepare("SELECT id FROM qms_form_templates WHERE template_key='controlled_transmittal_a4_v2'").get();
  if (!v2) {
    db.prepare(`INSERT INTO qms_form_templates (id, template_key, document_type, title, revision, status, html_template, css_template, placeholders_json, is_active, created_at, updated_at)
      VALUES (?, 'controlled_transmittal_a4_v2', 'TR', 'Transmittal', 'R1', 'Approved', ?, ?, ?, 0, datetime('now'), datetime('now'))`)
      .run(crypto.randomUUID(), htmlTemplate, cssTemplate, JSON.stringify(PLACEHOLDERS));
  }

  const v3 = db.prepare("SELECT id FROM qms_form_templates WHERE template_key='controlled_transmittal_a4_v3'").get();
  if (!v3) {
    db.prepare(`INSERT INTO qms_form_templates (id, template_key, document_type, title, revision, status, html_template, css_template, placeholders_json, is_active, created_at, updated_at)
      VALUES (?, 'controlled_transmittal_a4_v3', 'TR', 'Transmittal', 'R2', 'Approved', ?, ?, ?, 1, datetime('now'), datetime('now'))`)
      .run(crypto.randomUUID(), htmlTemplate, cssTemplate, JSON.stringify(PLACEHOLDERS));
  }

  db.prepare(`UPDATE qms_form_templates SET is_active=0, updated_at=datetime('now') WHERE template_key IN ('controlled_transmittal_a4_v1','controlled_transmittal_a4_v2')`).run();
  db.prepare(`UPDATE qms_form_templates SET status='Approved', revision='R2', is_active=1, updated_at=datetime('now') WHERE template_key='controlled_transmittal_a4_v3'`).run();
}



function seedControlledMaterialSubmittalTemplate(db) {
  const html = `<div class="hdr"><div class="b">CLIENT / EMPLOYER</div><div class="mid"><div class="t">SILVER FOUNDATION CONTRACTING COMPANY</div><div>Engineering & Construction - Quality Management System</div><h1>MATERIAL SUBMITTAL</h1><div>Form No.: MS-FRM-001 | Revision: {{document.revision}} | ISO 9001 Controlled Form</div></div><div class="b">CONSULTANT / ENGINEER</div></div><table class="meta"><tr><td>Project Name</td><td>{{project.name}}</td><td>Project No.</td><td>{{project.code}}</td></tr><tr><td>Contract No.</td><td>{{project.contract_no}}</td><td>Client / Employer</td><td>{{project.client}}</td></tr><tr><td>Main Contractor</td><td>{{project.main_contractor}}</td><td>Consultant</td><td>{{project.consultant}}</td></tr><tr><td>Location / Site</td><td>{{project.location}}</td><td>Date Issued</td><td>{{document.date_issued}}</td></tr><tr><td>Discipline</td><td>{{document.discipline}}</td><td>PMC</td><td>{{project.pmc}}</td></tr><tr><td>Response Due</td><td>{{document.response_due}}</td><td>Area / Zone</td><td>{{document.area_zone}}</td></tr></table><h3>SECTION 1: SUBMITTAL INFORMATION</h3><table><tr><td>Submittal Type</td><td>{{form.submittal_type}}</td><td>Specification Reference</td><td>{{form.spec_reference}}</td></tr><tr><td>Package Reference</td><td>{{form.package_reference}}</td><td>Date</td><td>{{form.date}}</td></tr></table><h3>SECTION 2: MATERIAL SUBMITTAL ITEMS</h3><table><tr><th>No.</th><th>Submittal No.</th><th>Rev.</th><th>Material Description / Specification</th><th>Manufacturer / Supplier</th><th>Country of Origin</th><th>Code / Model</th><th>Remarks</th></tr>{{form.material_rows}}</table><h3>SECTION 3: APPROVAL CODES REFERENCE</h3><div class="box">A — Approved As Submitted | B — Approved As Noted | C — Not Approved / Resubmit | D — Disapproved | E — For Information Only</div><h3>Comments</h3><table><tr><td>Client / Consultant Review Comments</td><td>—</td></tr><tr><td>Contractor Notes / Remarks</td><td>{{form.contractor_notes}}</td></tr></table><h3>SIGNATURES & AUTHORIZATION</h3><table><tr><td>Submitted By / Contractor<br/>Name & Title<br/><br/>Signature<br/><br/>Date<br/><br/>Stamp / Seal</td><td>Reviewed By / Consultant<br/>Name & Title<br/><br/>Signature<br/><br/>Date<br/><br/>Stamp / Seal</td><td>Approved By / Client<br/>Name & Title<br/><br/>Signature<br/><br/>Date<br/><br/>Stamp / Seal</td></tr></table><div class="ft">Original: Client / Employer | Copy: Consultant | Copy: Project Manager | Copy: Contractor QC File <span>Template Engine: Professional DB Template MS v1</span></div>`;
  const css = `@page{size:A4;margin:6mm}body{font-family:Arial;font-size:9px;color:#111}.hdr{display:grid;grid-template-columns:1fr 2fr 1fr;border:1px solid #222}.hdr .mid{text-align:center}.hdr .b{text-align:center;padding:6px;font-weight:700}.t{font-weight:700;color:#14305c}h1{font-size:16px;margin:2px 0}table{width:100%;border-collapse:collapse}td,th{border:1px solid #222;padding:4px;vertical-align:top}th{background:#e8eef8}h3{margin:6px 0 0;background:#1f3f6c;color:#fff;padding:4px;font-size:10px}.box{border:1px solid #222;padding:5px}.meta td:nth-child(odd){font-weight:700;background:#f8f8f8}.ft{margin-top:6px;border-top:1px solid #222;padding-top:3px;font-size:8px;display:flex;justify-content:space-between}`;
  const exists = db.prepare("SELECT id FROM qms_form_templates WHERE template_key='controlled_material_submittal_a4_v1'").get();
  if (!exists) {
    db.prepare(`INSERT INTO qms_form_templates (id, template_key, document_type, title, revision, status, html_template, css_template, is_active, created_at, updated_at) VALUES (?, 'controlled_material_submittal_a4_v1', 'MS', 'Material Submittal', 'R0', 'Approved', ?, ?, 1, datetime('now'), datetime('now'))`).run(crypto.randomUUID(), html, css);
  }

  db.prepare(`UPDATE qms_form_templates
    SET status='Approved',
        is_active=1,
        document_type=CASE WHEN document_type='Material Submittal' THEN 'MS' ELSE document_type END,
        updated_at=datetime('now')
    WHERE template_key='controlled_material_submittal_a4_v1'`).run();
}


function ensureUsersTableShape(db) {
  const cols = db.prepare("PRAGMA table_info('users')").all();
  if (!cols.length) return;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('status')) db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  if (!names.has('updated_at')) db.exec("ALTER TABLE users ADD COLUMN updated_at TEXT");
  if (!names.has('is_active')) db.exec('ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
  db.exec(`
    UPDATE users
    SET role = CASE
      WHEN LOWER(COALESCE(role, '')) = 'document_controller' THEN 'pmo'
      WHEN LOWER(COALESCE(role, '')) = 'admin' THEN 'system_admin'
      WHEN LOWER(COALESCE(role, '')) = 'engineer' THEN 'project_engineer'
      WHEN LOWER(COALESCE(role, '')) = 'hse_officer' THEN 'site_engineer'
      WHEN LOWER(COALESCE(role, '')) = 'approver' THEN 'qa_qc_engineer'
      ELSE LOWER(COALESCE(role, 'viewer'))
    END;

    UPDATE users
    SET status = CASE WHEN COALESCE(is_active, 1) = 1 THEN 'active' ELSE 'inactive' END
    WHERE status IS NULL OR TRIM(status) = '';

    UPDATE users
    SET is_active = CASE WHEN LOWER(COALESCE(status, 'active')) = 'inactive' THEN 0 ELSE 1 END;

    UPDATE users
    SET updated_at = COALESCE(NULLIF(updated_at, ''), created_at, datetime('now'))
    WHERE updated_at IS NULL OR TRIM(updated_at) = '';
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email)');
}

function initDb() {
  const db = getDb();

  db.exec(`
    -- Users & Auth
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT UNIQUE NOT NULL,
      password    TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'viewer',
      status      TEXT NOT NULL DEFAULT 'active',
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Projects
    CREATE TABLE IF NOT EXISTS projects (
      id              TEXT PRIMARY KEY,
      code            TEXT UNIQUE NOT NULL,
      name            TEXT NOT NULL,
      client          TEXT,
      consultant      TEXT,
      pmc             TEXT,
      location        TEXT,
      sector          TEXT,
      discipline      TEXT,
      main_contractor TEXT,
      contract_no     TEXT,
      scope           TEXT,
      contract_value  REAL DEFAULT 0,
      start_date      TEXT,
      end_date        TEXT,
      status          TEXT NOT NULL DEFAULT 'Active',
      progress        INTEGER DEFAULT 0,
      project_manager TEXT,
      planned_budget REAL DEFAULT 0,
      actual_cost REAL DEFAULT 0,
      forecast_cost REAL DEFAULT 0,
      planned_progress REAL DEFAULT 0,
      actual_progress REAL DEFAULT 0,
      schedule_status TEXT DEFAULT 'On Track',
      budget_status TEXT DEFAULT 'On Budget',
      resource_status TEXT DEFAULT 'Adequate',
      risk_status TEXT DEFAULT 'Low',
      key_highlights TEXT,
      key_issues TEXT,
      pending_decisions TEXT,
      pending_actions TEXT,
      phase_remaining_days INTEGER DEFAULT 0,
      target_completion_date TEXT,
      certificate_body_text TEXT,
      certificate_title TEXT,
      portfolio_timeline_start TEXT,
      portfolio_timeline_end TEXT,
      created_by      TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS project_memberships (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, user_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Numbering counters per project+type
    CREATE TABLE IF NOT EXISTS numbering_counters (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL,
      doc_type    TEXT NOT NULL,
      discipline_code TEXT NOT NULL DEFAULT 'GEN',
      current_val INTEGER NOT NULL DEFAULT 0,
      UNIQUE(project_id, doc_type, discipline_code),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Stakeholders
    CREATE TABLE IF NOT EXISTS stakeholders (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL,
      name        TEXT NOT NULL,
      role        TEXT NOT NULL,
      type        TEXT NOT NULL,
      contact     TEXT,
      email       TEXT,
      phone       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Documents (core table - all form types)
    CREATE TABLE IF NOT EXISTS documents (
      id                TEXT PRIMARY KEY,
      project_id        TEXT NOT NULL,
      ref               TEXT NOT NULL,
      type              TEXT NOT NULL,
      discipline        TEXT,
      title             TEXT NOT NULL,
      description       TEXT,
      supplier          TEXT,
      area              TEXT,
      severity          TEXT,
      commercial_value  REAL DEFAULT 0,
      revision          TEXT NOT NULL DEFAULT 'R0',
      workflow_status   TEXT NOT NULL DEFAULT 'Draft',
      approval_status   TEXT NOT NULL DEFAULT 'Not Submitted',
      evidence_status   TEXT NOT NULL DEFAULT 'No Evidence',
      issue_date        TEXT,
      due_date          TEXT,
      closed_date       TEXT,
      notes             TEXT,
      form_data         TEXT,
      created_by        TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    -- Document audit history
    CREATE TABLE IF NOT EXISTS doc_history (
      id          TEXT PRIMARY KEY,
      doc_id      TEXT NOT NULL,
      action      TEXT NOT NULL,
      field       TEXT,
      old_value   TEXT,
      new_value   TEXT,
      performed_by TEXT,
      user_id     TEXT,
      performed_at TEXT NOT NULL DEFAULT (datetime('now')),
      timestamp   TEXT,
      FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    -- File attachments
    CREATE TABLE IF NOT EXISTS attachments (
      id            TEXT PRIMARY KEY,
      doc_id        TEXT,
      project_id    TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name   TEXT NOT NULL,
      file_type     TEXT,
      file_size     INTEGER,
      uploaded_by   TEXT,
      uploaded_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Safety records
    CREATE TABLE IF NOT EXISTS safety_records (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL,
      ref         TEXT NOT NULL,
      type        TEXT NOT NULL,
      subtype     TEXT,
      title       TEXT NOT NULL,
      area        TEXT,
      responsible TEXT,
      status      TEXT NOT NULL DEFAULT 'Active',
      valid_from  TEXT,
      valid_to    TEXT,
      notes       TEXT,
      created_by  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Handover items
    CREATE TABLE IF NOT EXISTS handover_items (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL,
      discipline    TEXT DEFAULT 'general',
      package_name  TEXT,
      status        TEXT DEFAULT 'pending',
      uploaded_by   TEXT,
      upload_date   TEXT,
      approved_by   TEXT,
      approved_date TEXT,
      remarks       TEXT,
      attachment_id TEXT,
      is_applicable INTEGER NOT NULL DEFAULT 1,
      category      TEXT NOT NULL DEFAULT 'standard',
      certificate_issued INTEGER NOT NULL DEFAULT 0,
      certificate_approved TEXT DEFAULT 'Not Approved',
      certificate_uploaded INTEGER NOT NULL DEFAULT 0,
      certificate_upload_date TEXT,
      certificate_remarks TEXT,
      certificate_attachment_id TEXT,
      po_number TEXT,
      contract_number TEXT,
      actual_completion_date TEXT,
      certificate_issue_date TEXT,
      project_name TEXT,
      project_code TEXT,
      site_location TEXT,
      client_name TEXT,
      consultant_name TEXT,
      contractor_name TEXT,
      contract_value TEXT,
      project_start_date TEXT,
      target_completion_date TEXT,
      certificate_body_text TEXT,
      certificate_title TEXT,
      snag_item_no TEXT,
      area_location TEXT,
      priority TEXT,
      responsible_owner TEXT,
      target_date TEXT,
      evidence_reference TEXT,
      scope_completed_summary TEXT,
      outstanding_items TEXT,
      snag_status_summary TEXT,
      handover_status TEXT,
      prepared_by TEXT,
      internally_approved_by TEXT,
      signed_evidence_reference TEXT,
      package       TEXT NOT NULL,
      description   TEXT NOT NULL,
      required      INTEGER NOT NULL DEFAULT 1,
      received      INTEGER NOT NULL DEFAULT 0,
      approved      INTEGER NOT NULL DEFAULT 0,
      doc_id        TEXT,
      notes         TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS schedule_activities (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      wbs TEXT,
      activity_id TEXT,
      activity_name TEXT NOT NULL,
      planned_start TEXT,
      planned_finish TEXT,
      actual_start TEXT,
      actual_finish TEXT,
      duration_days INTEGER,
      progress_percent REAL DEFAULT 0,
      status TEXT DEFAULT 'Not Started',
      responsible_person TEXT,
      remarks TEXT,
      source TEXT,
      sort_order INTEGER,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS project_followups (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      action_required TEXT,
      comment TEXT,
      responsible_person TEXT,
      due_date TEXT,
      priority TEXT NOT NULL DEFAULT 'Medium',
      status TEXT NOT NULL DEFAULT 'Open',
      completed_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      recipient_user_id TEXT,
      recipient_role TEXT,
      source_type TEXT NOT NULL DEFAULT 'workflow',
      source_id TEXT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      status TEXT NOT NULL DEFAULT 'unread',
      due_date TEXT,
      action_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_docs_project ON documents(project_id);
    CREATE INDEX IF NOT EXISTS idx_docs_type ON documents(type);
    CREATE INDEX IF NOT EXISTS idx_docs_workflow ON documents(workflow_status);
    CREATE INDEX IF NOT EXISTS idx_docs_approval ON documents(approval_status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_unique_ref ON documents(project_id, type, ref);
    CREATE INDEX IF NOT EXISTS idx_history_doc ON doc_history(doc_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_doc ON attachments(doc_id);
    CREATE INDEX IF NOT EXISTS idx_safety_project ON safety_records(project_id);
    CREATE INDEX IF NOT EXISTS idx_handover_project ON handover_items(project_id);
    CREATE INDEX IF NOT EXISTS idx_membership_user_project ON project_memberships(user_id, project_id);
    CREATE INDEX IF NOT EXISTS idx_followups_project ON project_followups(project_id);
    CREATE INDEX IF NOT EXISTS idx_schedule_project ON schedule_activities(project_id);
    CREATE INDEX IF NOT EXISTS idx_schedule_status ON schedule_activities(status);
    CREATE INDEX IF NOT EXISTS idx_schedule_activity_id ON schedule_activities(activity_id);
    CREATE INDEX IF NOT EXISTS idx_schedule_planned_finish ON schedule_activities(planned_finish);
    CREATE INDEX IF NOT EXISTS idx_notifications_recipient_status ON notifications(recipient_user_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_project ON notifications(project_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_overdue_daily ON notifications(recipient_user_id, source_type, source_id, title, due_date);
  `);
  ensureUsersTableShape(db);
  ensureNumberingCountersTableShape(db);
  ensureProgressReportTables(db);
  ensureNotificationsTableShape(db);
  const handoverColumns = [
    ['discipline', "TEXT DEFAULT 'general'"],
    ['package_name', 'TEXT'],
    ['status', "TEXT DEFAULT 'pending'"],
    ['uploaded_by', 'TEXT'],
    ['upload_date', 'TEXT'],
    ['approved_by', 'TEXT'],
    ['approved_date', 'TEXT'],
    ['remarks', 'TEXT'],
    ['attachment_id', 'TEXT'],
    ['is_applicable', 'INTEGER NOT NULL DEFAULT 1'],
    ['category', "TEXT NOT NULL DEFAULT 'standard'"],
    ['certificate_issued', 'INTEGER NOT NULL DEFAULT 0'],
    ['certificate_approved', "TEXT DEFAULT 'Not Approved'"],
    ['certificate_uploaded', 'INTEGER NOT NULL DEFAULT 0'],
    ['certificate_upload_date', 'TEXT'],
    ['certificate_remarks', 'TEXT'],
    ['certificate_attachment_id', 'TEXT'],
    ['po_number', 'TEXT'],
    ['contract_number', 'TEXT'],
    ['actual_completion_date', 'TEXT'],
    ['certificate_issue_date', 'TEXT'],
    ['project_name', 'TEXT'],
    ['project_code', 'TEXT'],
    ['site_location', 'TEXT'],
    ['client_name', 'TEXT'],
    ['consultant_name', 'TEXT'],
    ['contractor_name', 'TEXT'],
    ['contract_value', 'TEXT'],
    ['project_start_date', 'TEXT'],
    ['target_completion_date', 'TEXT'],
    ['certificate_body_text', 'TEXT'],
    ['certificate_title', 'TEXT'],
    ['snag_item_no', 'TEXT'],
    ['area_location', 'TEXT'],
    ['priority', 'TEXT'],
    ['responsible_owner', 'TEXT'],
    ['target_date', 'TEXT'],
    ['evidence_reference', 'TEXT'],
    ['scope_completed_summary', 'TEXT'],
    ['outstanding_items', 'TEXT'],
    ['snag_status_summary', 'TEXT'],
    ['handover_status', 'TEXT'],
    ['prepared_by', 'TEXT'],
    ['internally_approved_by', 'TEXT'],
    ['signed_evidence_reference', 'TEXT'],
    ['created_at', 'TEXT'],
    ['updated_at', 'TEXT'],
  ];
  const existingCols = db.prepare("PRAGMA table_info('handover_items')").all().map((c) => c.name);
  for (const [name, def] of handoverColumns) {
    if (!existingCols.includes(name)) {
      db.exec(`ALTER TABLE handover_items ADD COLUMN ${name} ${def}`);
    }
  }

  // SQLite rejects non-constant defaults in ALTER TABLE ADD COLUMN,
  // so timestamp columns are added without DEFAULT and backfilled here.
  db.exec(`
    UPDATE handover_items
    SET package_name = COALESCE(NULLIF(package_name, ''), package)
    WHERE package_name IS NULL OR TRIM(package_name) = '';

    UPDATE handover_items
    SET status = CASE
      WHEN COALESCE(approved, 0) >= COALESCE(required, 1) THEN 'approved'
      WHEN COALESCE(received, 0) > 0 THEN 'in_review'
      ELSE 'pending'
    END
    WHERE status IS NULL OR TRIM(status) = '';

    UPDATE handover_items
    SET remarks = COALESCE(remarks, notes, '')
    WHERE remarks IS NULL;

    UPDATE handover_items
    SET created_at = datetime('now')
    WHERE created_at IS NULL OR TRIM(created_at) = '';

    UPDATE handover_items
    SET updated_at = COALESCE(NULLIF(updated_at, ''), created_at, datetime('now'))
    WHERE updated_at IS NULL OR TRIM(updated_at) = '';
  `);

  const defaultDisciplines = ['arch','civil','mech','elec','plumbing','ff','elv','landscape'];
  const defaultPackages = [
    'As-Built Drawings',
    'Approved Material Submittals',
    'Approved Shop Drawings',
    'Inspection Records',
    'Testing & Commissioning Records',
    'Operation & Maintenance Manual',
    'Warranty Certificates',
    'Final Evidence / Photos',
  ];
  const projects = db.prepare('SELECT id FROM projects').all();
  const existsStmt = db.prepare('SELECT id FROM handover_items WHERE project_id=? AND discipline=? AND package_name=? LIMIT 1');
  const insertStmt = db.prepare(`INSERT INTO handover_items (id, project_id, discipline, package_name, package, description, required, status, category, is_applicable, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 'pending', 'standard', 1, ?, ?)`);

  db.exec(`
    UPDATE handover_items
    SET category = CASE
      WHEN package_name = 'Project Completion Certificate' THEN 'certificate'
      WHEN package_name = 'Snagging / Punch List' THEN 'snagging'
      ELSE COALESCE(NULLIF(category, ''), 'standard')
    END
    WHERE category IS NULL OR TRIM(category) = '' OR package_name IN ('Project Completion Certificate', 'Snagging / Punch List');

    UPDATE handover_items
    SET is_applicable = 1
    WHERE is_applicable IS NULL;

    UPDATE handover_items
    SET status = 'not_applicable'
    WHERE COALESCE(is_applicable, 1) = 0;

    UPDATE handover_items
    SET is_applicable = 0, status = 'not_applicable'
    WHERE package_name = 'Insurance Documents';

    UPDATE handover_items
    SET category = 'legacy_seed', is_applicable = 0, status = 'not_applicable'
    WHERE (discipline IS NULL OR TRIM(discipline) = '')
      AND (category IS NULL OR TRIM(category) = '' OR category = 'standard');
  `);

  for (const project of projects) {
    for (const disc of defaultDisciplines) {
      for (const pkg of defaultPackages) {
        if (!existsStmt.get(project.id, disc, pkg)) {
          const now = new Date().toISOString();
          insertStmt.run(crypto.randomUUID(), project.id, disc, pkg, pkg, `${disc} - ${pkg}`, now, now);
        }
      }
    }
  }


  const specialItems = [
    { discipline: 'project_closeout', package_name: 'Project Completion Certificate', category: 'certificate', description: 'Project completion certificate workflow' },
    { discipline: 'project_closeout', package_name: 'Snagging / Punch List', category: 'snagging', description: 'Snagging and punch list closeout' },
  ];
  const specialInsertStmt = db.prepare(`INSERT INTO handover_items (id, project_id, discipline, package_name, package, description, required, status, category, is_applicable, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 'pending', ?, 1, ?, ?)`);
  for (const project of projects) {
    for (const special of specialItems) {
      if (!existsStmt.get(project.id, special.discipline, special.package_name)) {
        const now = new Date().toISOString();
        specialInsertStmt.run(crypto.randomUUID(), project.id, special.discipline, special.package_name, special.package_name, special.description, special.category, now, now);
      }
    }
  }


  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_activities (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      wbs TEXT,
      activity_id TEXT,
      activity_name TEXT NOT NULL,
      planned_start TEXT,
      planned_finish TEXT,
      actual_start TEXT,
      actual_finish TEXT,
      duration_days INTEGER,
      progress_percent REAL DEFAULT 0,
      status TEXT DEFAULT 'Not Started',
      responsible_person TEXT,
      remarks TEXT,
      source TEXT,
      sort_order INTEGER,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_schedule_project ON schedule_activities(project_id);
    CREATE INDEX IF NOT EXISTS idx_schedule_status ON schedule_activities(status);
    CREATE INDEX IF NOT EXISTS idx_schedule_activity_id ON schedule_activities(activity_id);
    CREATE INDEX IF NOT EXISTS idx_schedule_planned_finish ON schedule_activities(planned_finish);
  `);


  ensureQmsFormTemplatesTable(db);

  console.log('✅ Database schema initialized');

  // Auto-migrate: add columns that may not exist in older databases
  // Role normalization migration for legacy installs
  db.prepare("UPDATE users SET role='system_admin' WHERE role='admin'").run();

  const autoMigrations = [
    "ALTER TABLE documents ADD COLUMN form_data TEXT",
    "ALTER TABLE doc_history ADD COLUMN user_id TEXT",
    "ALTER TABLE doc_history ADD COLUMN timestamp TEXT",
    "ALTER TABLE projects ADD COLUMN project_manager TEXT",
    "ALTER TABLE projects ADD COLUMN planned_budget REAL DEFAULT 0",
    "ALTER TABLE projects ADD COLUMN actual_cost REAL DEFAULT 0",
    "ALTER TABLE projects ADD COLUMN forecast_cost REAL DEFAULT 0",
    "ALTER TABLE projects ADD COLUMN planned_progress REAL DEFAULT 0",
    "ALTER TABLE projects ADD COLUMN actual_progress REAL DEFAULT 0",
    "ALTER TABLE projects ADD COLUMN schedule_status TEXT DEFAULT 'On Track'",
    "ALTER TABLE projects ADD COLUMN budget_status TEXT DEFAULT 'On Budget'",
    "ALTER TABLE projects ADD COLUMN resource_status TEXT DEFAULT 'Adequate'",
    "ALTER TABLE projects ADD COLUMN risk_status TEXT DEFAULT 'Low'",
    "ALTER TABLE projects ADD COLUMN key_highlights TEXT",
    "ALTER TABLE projects ADD COLUMN key_issues TEXT",
    "ALTER TABLE projects ADD COLUMN pending_decisions TEXT",
    "ALTER TABLE projects ADD COLUMN pending_actions TEXT",
    "ALTER TABLE projects ADD COLUMN phase_remaining_days INTEGER DEFAULT 0",
    "ALTER TABLE projects ADD COLUMN target_completion_date TEXT",
    "ALTER TABLE projects ADD COLUMN main_contractor TEXT",
    "ALTER TABLE projects ADD COLUMN contract_no TEXT",
    "ALTER TABLE projects ADD COLUMN portfolio_timeline_start TEXT",
    "ALTER TABLE projects ADD COLUMN portfolio_timeline_end TEXT",
    `CREATE TABLE IF NOT EXISTS progress_reports (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, ref TEXT NOT NULL, report_no TEXT, report_type TEXT NOT NULL DEFAULT 'daily',
      report_date TEXT, week_start TEXT, week_end TEXT, week_number TEXT, period_from TEXT, period_to TEXT, prepared_by TEXT,
      workflow_status TEXT DEFAULT 'draft', status TEXT DEFAULT 'Draft', overall_pct REAL, planned_progress REAL, actual_progress REAL, variance REAL,
      schedule_status TEXT, risk_status TEXT, general_remarks TEXT, summary TEXT, work_done TEXT, work_planned TEXT, issues TEXT, fields_json TEXT, manual_schedule_remarks TEXT,
      created_by TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS progress_photos (
      id TEXT PRIMARY KEY, report_id TEXT NOT NULL, project_id TEXT NOT NULL,
      caption TEXT, area_location TEXT, discipline TEXT, taken_at TEXT, remarks TEXT, stored_name TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT, file_size INTEGER, uploaded_by TEXT, created_at TEXT DEFAULT (datetime('now')),
      uploaded_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (report_id) REFERENCES progress_reports(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS qms_form_templates (
      id TEXT PRIMARY KEY, template_key TEXT NOT NULL UNIQUE, document_type TEXT NOT NULL,
      title TEXT NOT NULL, revision TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Draft',
      html_template TEXT NOT NULL, css_template TEXT NOT NULL, placeholders_json TEXT,
      is_active INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))` ,
    `CREATE TABLE IF NOT EXISTS risk_register (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, ref TEXT NOT NULL, title TEXT NOT NULL,
      category TEXT, description TEXT, likelihood INTEGER DEFAULT 3, consequence INTEGER DEFAULT 3,
      risk_rating INTEGER, risk_level TEXT, mitigation TEXT, contingency TEXT, owner TEXT,
      status TEXT DEFAULT 'Open', review_date TEXT,
      residual_likelihood INTEGER DEFAULT 2, residual_consequence INTEGER DEFAULT 2,
      residual_rating INTEGER, residual_level TEXT, created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE)`,
  ];

  for (const sql of autoMigrations) {
    try { db.exec(sql); } catch(e) { /* column/table already exists, skip */ }
  }


  ensureQmsFormTemplatesTable(db);
  seedControlledTransmittalTemplate(db);
  seedControlledMaterialSubmittalTemplate(db);

  return db;
}



function ensureProgressReportTables(db) {
  const tableExists = (tableName) => Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
  ).get(tableName));
  const columnNames = (tableName) => new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((col) => col.name));
  const addColumnIfMissing = (tableName, names, columnName, definition) => {
    if (names.has(columnName)) return;
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    names.add(columnName);
  };
  const execIfColumnsExist = (tableName, requiredColumns, sql) => {
    const names = columnNames(tableName);
    if (requiredColumns.every((columnName) => names.has(columnName))) db.exec(sql);
  };
  const createIndexIfColumnsExist = (tableName, requiredColumns, sql) => {
    try {
      execIfColumnsExist(tableName, requiredColumns, sql);
    } catch (error) {
      console.warn(`[schema] skipped progress report index migration for ${tableName}: ${error.message}`);
    }
  };

  if (!tableExists('progress_reports')) {
    db.exec(`
      CREATE TABLE progress_reports (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        ref TEXT NOT NULL,
        report_no TEXT,
        report_type TEXT NOT NULL DEFAULT 'daily',
        report_date TEXT,
        week_start TEXT,
        week_end TEXT,
        week_number TEXT,
        period_from TEXT,
        period_to TEXT,
        prepared_by TEXT,
        workflow_status TEXT NOT NULL DEFAULT 'draft',
        status TEXT DEFAULT 'Draft',
        overall_pct REAL,
        planned_progress REAL,
        actual_progress REAL,
        variance REAL,
        schedule_status TEXT,
        risk_status TEXT,
        general_remarks TEXT,
        summary TEXT,
        work_done TEXT,
        work_planned TEXT,
        issues TEXT,
        fields_json TEXT,
        manual_schedule_remarks TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);
  }

  const progressReportColumns = {
    id: 'TEXT',
    project_id: 'TEXT',
    ref: 'TEXT',
    report_no: 'TEXT',
    report_type: "TEXT DEFAULT 'daily'",
    report_date: 'TEXT',
    week_start: 'TEXT',
    week_end: 'TEXT',
    week_number: 'TEXT',
    period_from: 'TEXT',
    period_to: 'TEXT',
    prepared_by: 'TEXT',
    workflow_status: "TEXT DEFAULT 'draft'",
    status: "TEXT DEFAULT 'Draft'",
    overall_pct: 'REAL',
    planned_progress: 'REAL',
    actual_progress: 'REAL',
    variance: 'REAL',
    schedule_status: 'TEXT',
    risk_status: 'TEXT',
    general_remarks: 'TEXT',
    summary: 'TEXT',
    work_done: 'TEXT',
    work_planned: 'TEXT',
    issues: 'TEXT',
    fields_json: 'TEXT',
    manual_schedule_remarks: 'TEXT',
    created_by: 'TEXT',
    created_at: 'TEXT',
    updated_at: 'TEXT',
  };
  const progressNames = columnNames('progress_reports');
  for (const [name, definition] of Object.entries(progressReportColumns)) {
    addColumnIfMissing('progress_reports', progressNames, name, definition);
  }

  execIfColumnsExist('progress_reports', ['id'], "UPDATE progress_reports SET id=lower(hex(randomblob(16))) WHERE id IS NULL OR TRIM(id)=''");
  execIfColumnsExist('progress_reports', ['report_type'], "UPDATE progress_reports SET report_type='daily' WHERE report_type IS NULL OR TRIM(report_type)=''");
  execIfColumnsExist('progress_reports', ['workflow_status'], "UPDATE progress_reports SET workflow_status='draft' WHERE workflow_status IS NULL OR TRIM(workflow_status)=''");
  execIfColumnsExist('progress_reports', ['fields_json'], "UPDATE progress_reports SET fields_json='{}' WHERE fields_json IS NULL OR TRIM(fields_json)=''");
  execIfColumnsExist('progress_reports', ['created_at'], "UPDATE progress_reports SET created_at=datetime('now') WHERE created_at IS NULL OR TRIM(created_at)=''");
  execIfColumnsExist('progress_reports', ['updated_at', 'created_at'], "UPDATE progress_reports SET updated_at=COALESCE(NULLIF(updated_at,''), created_at, datetime('now')) WHERE updated_at IS NULL OR TRIM(updated_at)=''");
  execIfColumnsExist('progress_reports', ['workflow_status', 'status'], "UPDATE progress_reports SET status=UPPER(SUBSTR(workflow_status,1,1)) || SUBSTR(workflow_status,2) WHERE status IS NULL OR TRIM(status)=''");
  execIfColumnsExist('progress_reports', ['report_no', 'ref'], "UPDATE progress_reports SET report_no=COALESCE(NULLIF(report_no,''), NULLIF(ref,'')) WHERE report_no IS NULL OR TRIM(report_no)=''");
  execIfColumnsExist('progress_reports', ['ref', 'report_no', 'id'], "UPDATE progress_reports SET ref=COALESCE(NULLIF(ref,''), NULLIF(report_no,''), id) WHERE ref IS NULL OR TRIM(ref)=''");
  execIfColumnsExist('progress_reports', ['period_from', 'report_type', 'report_date', 'week_start'], "UPDATE progress_reports SET period_from=CASE WHEN report_type='weekly' THEN week_start ELSE report_date END WHERE period_from IS NULL OR TRIM(period_from)=''");
  execIfColumnsExist('progress_reports', ['period_to', 'report_type', 'report_date', 'week_end'], "UPDATE progress_reports SET period_to=CASE WHEN report_type='weekly' THEN week_end ELSE report_date END WHERE period_to IS NULL OR TRIM(period_to)=''");

  if (!tableExists('progress_report_documents')) {
    db.exec(`
      CREATE TABLE progress_report_documents (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(report_id, document_id),
        FOREIGN KEY (report_id) REFERENCES progress_reports(id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      )
    `);
  }
  const documentNames = columnNames('progress_report_documents');
  for (const [name, definition] of Object.entries({ id: 'TEXT', report_id: 'TEXT', document_id: 'TEXT', created_at: 'TEXT' })) {
    addColumnIfMissing('progress_report_documents', documentNames, name, definition);
  }
  execIfColumnsExist('progress_report_documents', ['id'], "UPDATE progress_report_documents SET id=lower(hex(randomblob(16))) WHERE id IS NULL OR TRIM(id)=''");
  execIfColumnsExist('progress_report_documents', ['created_at'], "UPDATE progress_report_documents SET created_at=datetime('now') WHERE created_at IS NULL OR TRIM(created_at)=''");

  if (!tableExists('progress_report_schedule_items')) {
    db.exec(`
      CREATE TABLE progress_report_schedule_items (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        schedule_item_id TEXT,
        manual_reference TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(report_id, schedule_item_id),
        FOREIGN KEY (report_id) REFERENCES progress_reports(id) ON DELETE CASCADE,
        FOREIGN KEY (schedule_item_id) REFERENCES schedule_activities(id) ON DELETE CASCADE
      )
    `);
  }
  const scheduleNames = columnNames('progress_report_schedule_items');
  for (const [name, definition] of Object.entries({ id: 'TEXT', report_id: 'TEXT', schedule_item_id: 'TEXT', manual_reference: 'TEXT', created_at: 'TEXT' })) {
    addColumnIfMissing('progress_report_schedule_items', scheduleNames, name, definition);
  }
  execIfColumnsExist('progress_report_schedule_items', ['id'], "UPDATE progress_report_schedule_items SET id=lower(hex(randomblob(16))) WHERE id IS NULL OR TRIM(id)=''");
  execIfColumnsExist('progress_report_schedule_items', ['created_at'], "UPDATE progress_report_schedule_items SET created_at=datetime('now') WHERE created_at IS NULL OR TRIM(created_at)=''");


  if (!tableExists('progress_photos')) {
    db.exec(`
      CREATE TABLE progress_photos (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        caption TEXT,
        area_location TEXT,
        discipline TEXT,
        taken_at TEXT,
        remarks TEXT,
        stored_name TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT,
        file_size INTEGER,
        uploaded_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        uploaded_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (report_id) REFERENCES progress_reports(id) ON DELETE CASCADE
      )
    `);
  }
  const photoNames = columnNames('progress_photos');
  for (const [name, definition] of Object.entries({ id: 'TEXT', report_id: 'TEXT', project_id: 'TEXT', caption: 'TEXT', area_location: 'TEXT', discipline: 'TEXT', taken_at: 'TEXT', remarks: 'TEXT', stored_name: 'TEXT', original_name: 'TEXT', mime_type: 'TEXT', file_size: 'INTEGER', uploaded_by: 'TEXT', created_at: 'TEXT', uploaded_at: 'TEXT' })) {
    addColumnIfMissing('progress_photos', photoNames, name, definition);
  }
  execIfColumnsExist('progress_photos', ['id'], "UPDATE progress_photos SET id=lower(hex(randomblob(16))) WHERE id IS NULL OR TRIM(id)=''");
  execIfColumnsExist('progress_photos', ['created_at'], "UPDATE progress_photos SET created_at=COALESCE(NULLIF(created_at,''), NULLIF(uploaded_at,''), datetime('now')) WHERE created_at IS NULL OR TRIM(created_at)=''");
  execIfColumnsExist('progress_photos', ['uploaded_at'], "UPDATE progress_photos SET uploaded_at=COALESCE(NULLIF(uploaded_at,''), NULLIF(created_at,''), datetime('now')) WHERE uploaded_at IS NULL OR TRIM(uploaded_at)=''");

  createIndexIfColumnsExist('progress_reports', ['project_id', 'report_type', 'report_no'], 'CREATE INDEX IF NOT EXISTS idx_progress_report_no ON progress_reports(project_id, report_type, report_no)');
  createIndexIfColumnsExist('progress_reports', ['project_id', 'report_type', 'updated_at'], 'CREATE INDEX IF NOT EXISTS idx_progress_reports_project_type ON progress_reports(project_id, report_type, updated_at DESC)');
  createIndexIfColumnsExist('progress_report_documents', ['report_id'], 'CREATE INDEX IF NOT EXISTS idx_progress_report_documents_report ON progress_report_documents(report_id)');
  createIndexIfColumnsExist('progress_report_schedule_items', ['report_id'], 'CREATE INDEX IF NOT EXISTS idx_progress_report_schedule_report ON progress_report_schedule_items(report_id)');
  createIndexIfColumnsExist('progress_photos', ['report_id'], 'CREATE INDEX IF NOT EXISTS idx_progress_photos_report ON progress_photos(report_id)');
  createIndexIfColumnsExist('progress_report_documents', ['report_id', 'document_id'], 'CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_report_documents_unique ON progress_report_documents(report_id, document_id)');
  createIndexIfColumnsExist('progress_report_schedule_items', ['report_id', 'schedule_item_id'], 'CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_report_schedule_unique ON progress_report_schedule_items(report_id, schedule_item_id)');
}

function ensureNumberingCountersTableShape(db) {
  const normalizeScope = () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS numbering_counters (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        doc_type TEXT NOT NULL,
        discipline_code TEXT NOT NULL DEFAULT 'GEN',
        current_val INTEGER NOT NULL DEFAULT 0,
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    const columns = db.prepare('PRAGMA table_info(numbering_counters)').all();
    const names = new Set(columns.map((c) => c.name));
    const hasDisciplineCode = names.has('discipline_code');
    const hasCurrentVal = names.has('current_val');
    const hasCreatedAt = names.has('created_at');
    const hasUpdatedAt = names.has('updated_at');

    const tableSqlRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='numbering_counters'").get();
    const tableSql = String(tableSqlRow?.sql || '').toUpperCase();
    const hasLegacyTableUnique = tableSql.includes('UNIQUE(PROJECT_ID, DOC_TYPE)');

    const indexes = db.prepare('PRAGMA index_list(numbering_counters)').all();
    let hasNewUniqueIndex = false;
    let hasLegacyUniqueIndex = false;

    for (const idx of indexes) {
      if (!idx?.name || Number(idx?.unique || 0) !== 1) continue;
      const cols = db.prepare(`PRAGMA index_info(${JSON.stringify(idx.name)})`).all().map((c) => c.name);
      if (cols.length === 3 && cols[0] === 'project_id' && cols[1] === 'doc_type' && cols[2] === 'discipline_code') {
        hasNewUniqueIndex = true;
      }
      if (cols.length === 2 && cols[0] === 'project_id' && cols[1] === 'doc_type') {
        hasLegacyUniqueIndex = true;
      }
    }

    const needsRebuild = !hasDisciplineCode || !hasCurrentVal || !hasCreatedAt || !hasUpdatedAt || hasLegacyTableUnique || hasLegacyUniqueIndex || !hasNewUniqueIndex;
    if (!needsRebuild) {
      db.exec("UPDATE numbering_counters SET discipline_code='GEN' WHERE COALESCE(TRIM(discipline_code),'')=''");
      db.exec("UPDATE numbering_counters SET created_at=datetime('now') WHERE created_at IS NULL OR TRIM(created_at)=''");
      db.exec("UPDATE numbering_counters SET updated_at=datetime('now') WHERE updated_at IS NULL OR TRIM(updated_at)=''");
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_numbering_counter_scope ON numbering_counters(project_id, doc_type, discipline_code)');
      return;
    }

    console.warn(`[schema] numbering_counters legacy shape detected; rebuilding (discipline_code=${hasDisciplineCode}, current_val=${hasCurrentVal}, created_at=${hasCreatedAt}, updated_at=${hasUpdatedAt})`);

    const disciplineExpr = hasDisciplineCode
      ? "CASE WHEN COALESCE(TRIM(discipline_code),'')='' THEN 'GEN' ELSE UPPER(TRIM(discipline_code)) END"
      : "'GEN'";
    const currentValExpr = hasCurrentVal ? 'COALESCE(current_val, 0)' : '0';
    const createdAtExpr = hasCreatedAt ? "COALESCE(created_at, datetime('now'))" : "datetime('now')";
    const updatedAtExpr = hasUpdatedAt ? "COALESCE(updated_at, datetime('now'))" : "datetime('now')";

    db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      db.exec('DROP TABLE IF EXISTS numbering_counters_new');
      db.exec(`
        CREATE TABLE numbering_counters_new (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          doc_type TEXT NOT NULL,
          discipline_code TEXT NOT NULL DEFAULT 'GEN',
          current_val INTEGER NOT NULL DEFAULT 0,
          created_at TEXT,
          updated_at TEXT,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
      `);

      db.exec(`
        INSERT INTO numbering_counters_new (id, project_id, doc_type, discipline_code, current_val, created_at, updated_at)
        SELECT
          COALESCE(MIN(id), lower(hex(randomblob(16)))),
          project_id,
          UPPER(TRIM(doc_type)),
          ${disciplineExpr},
          MAX(${currentValExpr}),
          MIN(${createdAtExpr}),
          MAX(${updatedAtExpr})
        FROM numbering_counters
        GROUP BY project_id, UPPER(TRIM(doc_type)), ${disciplineExpr}
      `);

      db.exec('DROP TABLE numbering_counters');
      db.exec('ALTER TABLE numbering_counters_new RENAME TO numbering_counters');
      db.exec("UPDATE numbering_counters SET discipline_code='GEN' WHERE COALESCE(TRIM(discipline_code),'')=''");
      db.exec("UPDATE numbering_counters SET created_at=datetime('now') WHERE created_at IS NULL OR TRIM(created_at)=''");
      db.exec("UPDATE numbering_counters SET updated_at=datetime('now') WHERE updated_at IS NULL OR TRIM(updated_at)=''");
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_numbering_counter_scope ON numbering_counters(project_id, doc_type, discipline_code)');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  try {
    normalizeScope();
  } catch (error) {
    console.error('[schema] numbering_counters migration failed; attempting safe rebuild:', error.message);
    try {
      db.exec('DROP TABLE IF EXISTS numbering_counters_new');
      db.exec(`
        CREATE TABLE IF NOT EXISTS numbering_counters_new (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          doc_type TEXT NOT NULL,
          discipline_code TEXT NOT NULL DEFAULT 'GEN',
          current_val INTEGER NOT NULL DEFAULT 0,
          created_at TEXT,
          updated_at TEXT,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
      `);
      db.exec(`
        INSERT INTO numbering_counters_new (id, project_id, doc_type, discipline_code, current_val, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), project_id, UPPER(TRIM(doc_type)), 'GEN', 0, datetime('now'), datetime('now')
        FROM numbering_counters
        WHERE project_id IS NOT NULL AND doc_type IS NOT NULL
        GROUP BY project_id, UPPER(TRIM(doc_type))
      `);
      db.exec('DROP TABLE numbering_counters');
      db.exec('ALTER TABLE numbering_counters_new RENAME TO numbering_counters');
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_numbering_counter_scope ON numbering_counters(project_id, doc_type, discipline_code)');
    } catch (rebuildError) {
      console.error('[schema] numbering_counters fallback rebuild failed:', rebuildError.message);
      throw rebuildError;
    }
  }
}

function ensureNotificationsTableShape(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      recipient_user_id TEXT,
      recipient_role TEXT,
      source_type TEXT NOT NULL DEFAULT 'workflow',
      source_id TEXT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      status TEXT NOT NULL DEFAULT 'unread',
      due_date TEXT,
      action_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_recipient_status ON notifications(recipient_user_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_project ON notifications(project_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_overdue_daily ON notifications(recipient_user_id, source_type, source_id, title, due_date);
  `);

  const requiredColumns = {
    id: 'TEXT PRIMARY KEY',
    project_id: 'TEXT NOT NULL',
    recipient_user_id: 'TEXT',
    recipient_role: 'TEXT',
    source_type: "TEXT NOT NULL DEFAULT 'workflow'",
    source_id: 'TEXT',
    title: 'TEXT NOT NULL',
    message: 'TEXT NOT NULL',
    severity: "TEXT NOT NULL DEFAULT 'info'",
    status: "TEXT NOT NULL DEFAULT 'unread'",
    due_date: 'TEXT',
    action_url: 'TEXT',
    created_at: "TEXT NOT NULL DEFAULT (datetime('now'))",
    read_at: 'TEXT',
  };
  const existing = db.prepare("PRAGMA table_info('notifications')").all();
  const existingNames = new Set(existing.map((col) => col.name));
  for (const [name, def] of Object.entries(requiredColumns)) {
    if (!existingNames.has(name)) db.exec(`ALTER TABLE notifications ADD COLUMN ${name} ${def}`);
  }
}

module.exports = { getDb, initDb };
