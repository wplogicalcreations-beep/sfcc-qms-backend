const {
  renderMaterialSubmittalPdf,
  renderDrawingSubmittalPdf,
  renderRfiPdf,
  renderInspectionRequestPdf,
  renderNcrPdf,
  renderTransmittalPdf,
  renderSiteInstructionPdf,
  renderVariationOrderPdf,
} = require('../src/templates/qmsPdfTemplates');

const sample = {
  document: { ref: 'SFCC-TEST-001', type: 'MS', revision: 'R0', discipline: 'CIV', form_data: '{}' },
  project: { name: 'Demo', code: 'PRJ', client: 'Client', consultant: 'Consultant', location: 'Site' },
  attachments: [],
  project_logos: {},
  project_stakeholders: { rows: [] },
};

const checks = {
  MS: renderMaterialSubmittalPdf,
  DS: renderDrawingSubmittalPdf,
  RFI: renderRfiPdf,
  IR: renderInspectionRequestPdf,
  NCR: renderNcrPdf,
  TR: renderTransmittalPdf,
  SI: renderSiteInstructionPdf,
  VO: renderVariationOrderPdf,
};

Object.entries(checks).forEach(([k, fn]) => {
  const out = fn(sample);
  if (typeof out !== 'string' || !out.includes('<html')) throw new Error(`${k} renderer failed`);
  if (!out.toUpperCase().includes(k === 'MS' ? 'MATERIAL SUBMITTAL' : k === 'RFI' ? 'REQUEST FOR INFORMATION' : k === 'IR' ? 'INSPECTION REQUEST' : 'SECTION')) {
    throw new Error(`${k} renderer missing expected document label`);
  }
  console.log(`[Renderer QA] type=${k} renderer=${fn.name} htmlLength=${out.length}`);
});

console.log('QMS renderer smoke test passed for:', Object.keys(checks).join(', '));
