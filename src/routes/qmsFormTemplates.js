const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db/schema');
const { requireAuth, requireProjectPermission } = require('../middleware/auth');
const { requireRole } = require('../middleware/auth');
const { generatePdfBuffer } = require('../services/pdfService');
const { renderTemplateRecord } = require('../services/qmsTemplateEngine');
const { DEFAULT_VISUAL_CONFIG } = require('../templates/controlledTransmittalTemplate');

const router = express.Router();
const adminOnly = requireRole(['system_admin']);

router.get('/', requireAuth, requireProjectPermission('documents:read'), (req,res)=>{
  const db=getDb();
  res.json(db.prepare('SELECT id,template_key,document_type,title,revision,status,is_active,updated_at FROM qms_form_templates ORDER BY document_type, is_active DESC, datetime(updated_at) DESC').all());
});
router.get('/:id', requireAuth, requireProjectPermission('documents:read'), (req,res)=>{
  const row=getDb().prepare('SELECT * FROM qms_form_templates WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({error:'Template not found'});
  res.json(row);
});
router.put('/:id', requireAuth, adminOnly, (req,res)=>{
  const {title,template_key,revision,status,html_template,css_template,is_active,placeholders_json}=req.body;
  const db=getDb();
  db.prepare("UPDATE qms_form_templates SET title=?, template_key=?, revision=?, status=?, html_template=?, css_template=?, placeholders_json=?, is_active=?, updated_at=datetime('now') WHERE id=?")
    .run(title,template_key,revision,status,html_template,css_template,placeholders_json || null,is_active?1:0,req.params.id);
  if(is_active){db.prepare('UPDATE qms_form_templates SET is_active=0 WHERE document_type=(SELECT document_type FROM qms_form_templates WHERE id=?) AND id<>?').run(req.params.id,req.params.id);}
  const updated = db.prepare('SELECT * FROM qms_form_templates WHERE id=?').get(req.params.id);
  if (updated?.document_type === 'Transmittal' && updated?.status === 'Approved' && Number(updated?.is_active) === 1) {
    db.prepare('UPDATE qms_form_templates SET is_active=0 WHERE document_type=\'Transmittal\' AND id<>?').run(req.params.id);
    const merged = { ...DEFAULT_VISUAL_CONFIG, ...(updated.placeholders_json ? JSON.parse(updated.placeholders_json) : {}) };
    db.prepare("UPDATE qms_form_templates SET template_key='controlled_transmittal_a4_v5', revision='R4', status='Approved', is_active=1, placeholders_json=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(merged), req.params.id);
  }
  res.json({ok:true});
});
router.post('/:id/sample-pdf', requireAuth, requireProjectPermission('documents:read'), async (req,res)=>{
  const db = getDb();
  const selected=db.prepare('SELECT * FROM qms_form_templates WHERE id=?').get(req.params.id);
  const tpl = selected?.document_type === 'TR'
    ? db.prepare("SELECT * FROM qms_form_templates WHERE document_type IN ('TR','Transmittal') AND status='Approved' AND is_active=1 ORDER BY datetime(updated_at) DESC LIMIT 1").get()
    : selected;
  if(!tpl) return res.status(404).json({error:'Template not found'});
  const sampleRows = [
    ['1', 'SFCC-TR-CIV-001', 'R1', 'Shop Drawing Package', '2', 'For review'],
    ['2', 'SFCC-TR-CIV-002', 'R0', 'Material Submittal Package', '2', 'For approval'],
    ['3', 'SFCC-TR-STR-003', 'R1', 'Method Statement', '1', 'For review and comment'],
    ['4', 'SFCC-TR-QA-004', 'R0', 'Inspection Checklist', '1', 'For approval'],
    ['5', 'SFCC-TR-MAT-005', 'R2', 'Test Report', '1', 'Urgent review'],
    ['6', 'SFCC-TR-ARC-006', 'R1', 'Manufacturer Data Sheet', '2', 'For coordination'],
    ['7', 'SFCC-TR-MEP-007', 'R0', 'Compliance Statement', '1', 'For consultant review'],
    ['8', 'SFCC-TR-PLN-008', 'R3', 'As-Built Drawing Package', '2', 'Supersedes R2'],
    ['9', 'SFCC-TR-QS-009', 'R0', 'O&M Manual', '1', 'For records'],
    ['10', 'SFCC-TR-HSE-010', 'R1', 'Warranty Certificate', '1', 'Closeout evidence']
  ];
  const transmitted_docs = sampleRows
    .map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('');

  const context={project:{name:'ZIMMER HEAD OFFICE',code:'SFCC-2026-001',client:'ZIMMER',consultant:'BA',main_contractor:'Silver Foundation Contracting Co.',location:'RIYADH',contract_no:'CNT-2026-TR-001',pmc:'BARRY'},document:{reference_no:'SFCC-TR-2026-001',revision:'R1',discipline:'Civil & Structural',area_zone:'HQ Zone A',date_issued:'2026-05-22',response_due:'2026-05-29',workflow_status:'Issued',approval_status:'Submitted'},form:{subject:'Sample Transmittal Submission',purpose:'For Review',urgency:'Routine',from_company:'Silver Foundation Contracting Co.',to_company:'BA',attention:'Project Engineer',remarks:'Please provide feedback within due date.',description:'Sample transmitted document',transmitted_docs}};
  const pdf=await generatePdfBuffer(renderTemplateRecord(tpl,context));
  res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','inline; filename="sample-template.pdf"');return res.end(pdf);
});
module.exports=router;
