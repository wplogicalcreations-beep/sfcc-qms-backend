require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb, initDb } = require('./schema');

const TYPES = ['MS', 'DS', 'RFI', 'IR', 'NCR', 'TR', 'VO', 'SI'];

async function seed() {
  const db = initDb();

  // Check if already seeded
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (existing.cnt > 0) {
    console.log('Database already seeded. Skipping.');
    return;
  }

  console.log('Seeding database...');

  // Create admin user
  const adminId = uuidv4();
  const hashedPwd = await bcrypt.hash('Admin@1234', 10);
  db.prepare('INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)').run(adminId, 'System Admin', 'admin@silverfoundation.sa', hashedPwd, 'system_admin');

  // Create demo users
  const users = [
    { name: 'Ahmed Al-Rashidi', email: 'project.manager@example.invalid', role: 'project_manager' },
    { name: 'Khalid Hassan', email: 'qa.qc.engineer@example.invalid', role: 'qa_qc_engineer' },
    { name: 'Sara Mohammed', email: 'pmo@example.invalid', role: 'pmo' },
    { name: 'Omar Khalil', email: 'site.engineer@example.invalid', role: 'site_engineer' },
    { name: 'Faisal Nasser', email: 'project.engineer@example.invalid', role: 'project_engineer' },
    { name: 'Maha Ali', email: 'viewer@example.invalid', role: 'viewer' },
  ];
  const userIds = [];
  for (const u of users) {
    const uid = uuidv4();
    const pwd = await bcrypt.hash('Pass@1234', 10);
    db.prepare('INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)').run(uid, u.name, u.email, pwd, u.role);
    userIds.push({ id: uid, role: u.role });
  }

  // Create demo projects
  const projects = [
    { code:'SFCC-JZM-001', name:'Jazan Regional Museum', client:'Ministry of Culture', consultant:'AECOM Middle East', pmc:'Hill International', location:'Jazan, KSA', sector:'Cultural / Museum', discipline:'MEP / Fit-out', scope:'Full MEP installation, interior fit-out, safety systems, and handover.', contract_value:18500000, start_date:'2026-05-01', end_date:'2027-01-30', progress:34, pm:'Ahmed Al-Rashidi', planned_budget:17500000, actual_cost:6900000, forecast_cost:18100000, planned_progress:40, actual_progress:34, schedule_status:'Watch', budget_status:'On Budget', resource_status:'Adequate', risk_status:'Medium', key_highlights:'Facade package approved\nMain LV equipment delivered', key_issues:'Late basement duct routing approval', pending_decisions:'Client signoff on level-5 scope', pending_actions:'Close open NCRs and accelerate IR inspections', phase_remaining_days:240, target_completion_date:'2027-01-30', portfolio_timeline_start:'2026-05-01', portfolio_timeline_end:'2027-01-30' },
    { code:'SFCC-RYD-014', name:'Riyadh Innovation Center', client:'Riyadh Development Authority', consultant:'Dar Al-Handasah', pmc:'Parsons', location:'Riyadh, KSA', sector:'Commercial', discipline:'Civil / MEP', scope:'Core and shell with full MEP and commissioning.', contract_value:26200000, start_date:'2026-02-15', end_date:'2027-04-15', progress:52, pm:'Khalid Hassan', planned_budget:24800000, actual_cost:13900000, forecast_cost:27000000, planned_progress:55, actual_progress:52, schedule_status:'On Track', budget_status:'At Risk', resource_status:'Adequate', risk_status:'High', key_highlights:'HV package awarded\nConcrete productivity improved', key_issues:'Procurement delays for specialty panels', pending_decisions:'Approve alternative panel supplier', pending_actions:'Recover 3-week schedule slippage', phase_remaining_days:180, target_completion_date:'2027-04-15', portfolio_timeline_start:'2026-02-15', portfolio_timeline_end:'2027-04-15' }
  ];

  const projId = uuidv4();
  const proj2Id = uuidv4();
  const projIds = [projId, proj2Id];
  const projectRows = projects.map((p,idx)=>({id:projIds[idx], ...p}));
  for (const pr of projectRows) {
    db.prepare(`
      INSERT INTO projects (id,code,name,client,consultant,pmc,location,sector,discipline,scope,contract_value,start_date,end_date,status,progress,created_by,project_manager,planned_budget,actual_cost,forecast_cost,planned_progress,actual_progress,schedule_status,budget_status,resource_status,risk_status,key_highlights,key_issues,pending_decisions,pending_actions,phase_remaining_days,target_completion_date,portfolio_timeline_start,portfolio_timeline_end)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(pr.id,pr.code,pr.name,pr.client,pr.consultant,pr.pmc,pr.location,pr.sector,pr.discipline,pr.scope,pr.contract_value,pr.start_date,pr.end_date,'Active',pr.progress,adminId,pr.pm,pr.planned_budget,pr.actual_cost,pr.forecast_cost,pr.planned_progress,pr.actual_progress,pr.schedule_status,pr.budget_status,pr.resource_status,pr.risk_status,pr.key_highlights,pr.key_issues,pr.pending_decisions,pr.pending_actions,pr.phase_remaining_days,pr.target_completion_date,pr.portfolio_timeline_start,pr.portfolio_timeline_end);
    for (const u of userIds) db.prepare('INSERT INTO project_memberships (id,project_id,user_id,role,is_active) VALUES (?,?,?,?,1)').run(uuidv4(), pr.id, u.id, u.role);
    for (const t of TYPES) db.prepare('INSERT INTO numbering_counters (id, project_id, doc_type, discipline_code, current_val) VALUES (?, ?, ?, ?, ?)').run(uuidv4(), pr.id, t, 'GEN', 0);
  }

// Create stakeholders
  const stakeholders = [
    { name: 'Ministry of Culture',            role: 'Client / Employer', type: 'Client',      contact: 'Project Director', email: 'pd@moc.gov.sa',    phone: '+966 17 xxx xxxx' },
    { name: 'AECOM Middle East',              role: 'Lead Consultant',   type: 'Consultant',   contact: 'Resident Engineer',email: 're@aecom.com',      phone: '+966 12 xxx xxxx' },
    { name: 'Hill International',             role: 'Project Management',type: 'PMC',          contact: 'PMC Lead',         email: 'pmc@hillintl.com', phone: '+966 11 xxx xxxx' },
    { name: 'Silver Foundation Contracting',  role: 'Main Contractor',   type: 'Contractor',   contact: 'Project Manager',  email: 'project.manager@example.invalid', phone: '+966 13 xxx xxxx' },
  ];
  for (const s of stakeholders) {
    db.prepare('INSERT INTO stakeholders (id,project_id,name,role,type,contact,email,phone) VALUES (?,?,?,?,?,?,?,?)').run(uuidv4(), projId, s.name, s.role, s.type, s.contact, s.email, s.phone);
  }

  // Create demo documents
  const docs = [
    { type:'MS',  disc:'Mech',     title:'VRF Outdoor Unit — Daikin 20TR',              sup:'Daikin ME',      wf:'Response Received', ap:'Approved as Noted', ev:'Uploaded',   area:'Roof',    },
    { type:'MS',  disc:'Elec',     title:'LV Switchboard Main Incomer 2500A',            sup:'ABB',            wf:'Issued',            ap:'Submitted',         ev:'No Evidence',area:'B1 LV Room' },
    { type:'MS',  disc:'Plumbing', title:'HDPE Drainage Pipes DN150',                   sup:'Georg Fischer',  wf:'Draft',             ap:'Not Submitted',     ev:'No Evidence',area:'Ground Floor' },
    { type:'MS',  disc:'FF',       title:'Viking Sprinkler Heads VK302',                sup:'Viking MENA',    wf:'Issued',            ap:'Submitted',         ev:'No Evidence',area:'All Levels' },
    { type:'DS',  disc:'Arch',     title:'Facade Shop Drawings — Level 1 IFC',          wf:'Closed',          ap:'Approved',          ev:'Verified',           area:'External' },
    { type:'DS',  disc:'Mech',     title:'Ductwork Layout Plan — Basement Level 2',     wf:'Ready for Issue', ap:'Not Submitted',     ev:'No Evidence',        area:'B2' },
    { type:'RFI', disc:'Civil',    title:'Raft Foundation Depth Clarification — Zone A',wf:'Issued',          ap:'Submitted',         ev:'No Evidence',        area:'Zone A' },
    { type:'RFI', disc:'Mech',     title:'Duct Routing Conflict — B2 Corridor Ceiling', wf:'Closed',          ap:'Approved',          ev:'Verified',           area:'B2' },
    { type:'RFI', disc:'Elec',     title:'Cable Tray Route Change — Level 3 East Wing', wf:'Response Received',ap:'Approved as Noted',ev:'Uploaded',          area:'Level 3' },
    { type:'IR',  disc:'Mech',     title:'Duct Installation Inspection — Zone A North', wf:'Closed',          ap:'Approved',          ev:'Verified',           area:'Zone A' },
    { type:'IR',  disc:'Civil',    title:'Rebar Inspection — Column Grid C-12',          wf:'Issued',          ap:'Submitted',         ev:'No Evidence',        area:'Grid C' },
    { type:'IR',  disc:'Elec',     title:'Containment Pre-closure Check — Level 2',     wf:'Response Received',ap:'Approved',         ev:'Uploaded',           area:'Level 2' },
    { type:'NCR', disc:'QA',       title:'Concrete Strength Below Specification — Slab S4', wf:'Response Received',ap:'Resubmit Required',ev:'Uploaded',       area:'Zone B',  sev:'Major' },
    { type:'NCR', disc:'Civil',    title:'Rebar Spacing Non-conformance — Column G5',   wf:'Issued',          ap:'Submitted',         ev:'No Evidence',        area:'Zone A',  sev:'Minor' },
    { type:'TR',  disc:'Arch',     title:'Drawing Package Transmittal — Rev 3 IFC Set', wf:'Closed',          ap:'Approved',          ev:'Verified',           area:'All' },
    { type:'TR',  disc:'Mech',     title:'MEP Material Submittals Package Vol.1',        wf:'Closed',          ap:'Approved',          ev:'Verified',           area:'All' },
    { type:'VO',  disc:'Mech',     title:'Additional MEP Works — Level 5 Scope Extension',wf:'Issued',        ap:'Submitted',         ev:'No Evidence',        area:'Level 5', val:450000 },
    { type:'SI',  disc:'General',  title:'Access restriction near west crane zone', wf:'Issued', ap:'Submitted', ev:'Uploaded', area:'West Yard' },
  ];

  const typeCount = {};
  TYPES.forEach(t => typeCount[t] = 0);

  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    typeCount[d.type] = (typeCount[d.type] || 0) + 1;
    const seq = String(typeCount[d.type]).padStart(3, '0');
    const ref = `SFCC-JZM-001-${d.type}-${d.disc.toUpperCase()}-${seq}-R0`;

    const issueDate = new Date(Date.now() - (docs.length - i) * 3 * 86400000).toISOString().split('T')[0];
    const dueDate   = new Date(Date.now() + (i % 5 + 1) * 4 * 86400000).toISOString().split('T')[0];
    const docId = uuidv4();

    db.prepare(`
      INSERT INTO documents (id,project_id,ref,type,discipline,title,supplier,area,severity,commercial_value,revision,workflow_status,approval_status,evidence_status,issue_date,due_date,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(docId, projId, ref, d.type, d.disc, d.title, d.sup||'', d.area||'', d.sev||'', d.val||0, 'R0', d.wf, d.ap, d.ev, issueDate, dueDate, adminId);

    db.prepare('INSERT INTO doc_history (id,doc_id,action,performed_by) VALUES (?,?,?,?)').run(uuidv4(), docId, 'Document created', adminId);
  }

  // Update counters
  for (const [type, count] of Object.entries(typeCount)) {
    if (count > 0) {
      db.prepare('UPDATE numbering_counters SET current_val=? WHERE project_id=? AND doc_type=? AND discipline_code=?').run(count, projId, type, 'GEN');
    }
  }

  // Add baseline docs to second project
  db.prepare(`INSERT INTO documents (id,project_id,ref,type,discipline,title,revision,workflow_status,approval_status,evidence_status,issue_date,due_date,created_by,form_data) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(uuidv4(), proj2Id, 'SFCC-RYD-014-SI-GENERA-001-R0', 'SI', 'General', 'Temporary logistics route instruction', 'R0', 'Under Review', 'Submitted', 'No Evidence', '2026-04-15', '2026-05-10', adminId, JSON.stringify({ instruction_direction:'Issued to Site Team / Subcontractor / Internal Team', issued_by:'PMC Lead', issued_to:'Site Team', subject:'Temporary logistics route', location_or_area:'North service road', instruction_description:'Use revised service route due to utility trench works.', required_action:'Issue toolbox talk and install temporary signs.', response_required:'Yes', response_due_date:'2026-05-10', status:'Issued' }));

  // Handover skeleton
  const handoverPkgs = [
    { package: 'As-Built Drawings',      description: 'IFC and as-built drawing packages',           required: 24 },
    { package: "O&M Manuals",            description: 'Operation and maintenance manuals',            required: 15 },
    { package: 'Warranties & Certs',     description: 'Equipment warranties and test certificates',   required: 12 },
    { package: 'Training Records',       description: 'Client and operator training evidence',        required: 5  },
    { package: 'Testing & Commissioning',description: 'T&C protocols and commissioning records',      required: 18 },
    { package: 'Authority Approvals',    description: 'Municipal and authority clearances',           required: 8  },
  ];
  for (const p of handoverPkgs) {
    db.prepare('INSERT INTO handover_items (id,project_id,package,description,required) VALUES (?,?,?,?,?)').run(uuidv4(), projId, p.package, p.description, p.required);
  }


  const scheduleSeed = [
    { wbs: '1.0', activity_id: 'A100', activity_name: 'Mobilization Complete', planned_start: '2026-05-01', planned_finish: '2026-05-07', actual_start: '2026-05-01', actual_finish: '2026-05-07', duration_days: 7, progress_percent: 100, status: 'Complete', source: 'seed', sort_order: 1 },
    { wbs: '2.0', activity_id: 'A200', activity_name: 'Substructure MEP Works', planned_start: '2026-05-08', planned_finish: '2026-06-10', duration_days: 33, progress_percent: 45, status: 'In Progress', source: 'seed', sort_order: 2 },
    { wbs: '3.0', activity_id: 'A300', activity_name: 'Facade Integration', planned_start: '2026-06-12', planned_finish: '2026-07-05', duration_days: 23, progress_percent: 0, status: 'Not Started', source: 'seed', sort_order: 3 },
    { wbs: '4.0', activity_id: 'A400', activity_name: 'Level B2 Testing', planned_start: '2026-03-20', planned_finish: '2026-04-10', duration_days: 21, progress_percent: 65, status: 'Overdue', source: 'seed', sort_order: 4 },
  ];
  for (const a of scheduleSeed) {
    db.prepare(`INSERT INTO schedule_activities (id, project_id, wbs, activity_id, activity_name, planned_start, planned_finish, actual_start, actual_finish, duration_days, progress_percent, status, responsible_person, remarks, source, sort_order, created_by, created_at, updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
      WHERE NOT EXISTS (SELECT 1 FROM schedule_activities WHERE project_id=? AND activity_id=?)`)
      .run(uuidv4(), projId, a.wbs, a.activity_id, a.activity_name, a.planned_start, a.planned_finish, a.actual_start||null, a.actual_finish||null, a.duration_days, a.progress_percent, a.status, 'Project Team', '', a.source, a.sort_order, adminId, new Date().toISOString(), new Date().toISOString(), projId, a.activity_id);
  }

  db.prepare(`INSERT INTO project_followups (id, project_id, title, description, action_required, comment, responsible_person, due_date, priority, status, completed_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuidv4(), projId, 'Close electrical inspection backlog', 'Pending IR approvals on Level 2 and B1.', 'Coordinate with consultant and submit evidence.', 'Escalated during weekly progress meeting.', 'Ahmed Al-Rashidi', '2026-05-20', 'High', 'Open', null, adminId);

  db.prepare(`INSERT INTO project_followups (id, project_id, title, description, action_required, comment, responsible_person, due_date, priority, status, completed_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuidv4(), projId, 'Finalize façade mockup signoff', 'Mockup approved with minor comments.', 'Issue closure transmittal and archive approval.', 'Completed and uploaded in document control.', 'Khalid Hassan', '2026-04-30', 'Medium', 'Completed', '2026-04-29', adminId);

  console.log('');
  console.log('✅ Database seeded successfully');
  console.log('');
  console.log('Admin login:');
  console.log('  Email:    admin@silverfoundation.sa');
  console.log('  Password: Admin@1234');
  console.log('');
}

if (require.main === module) {
  seed().catch(console.error);
}

module.exports = { seed };
