const { resolveControlledHeaderParties } = require('../src/templates/qmsPdfTemplates');

function runCase(name, { project, logos, stakeholders, expectedParties, expectedCount }) {
  const resolved = resolveControlledHeaderParties(project, logos, stakeholders || []);
  const keys = resolved.map((p) => (p.key === 'sfcc' ? 'contractor' : p.key));
  const pass = JSON.stringify(keys) === JSON.stringify(expectedParties) && resolved.length === expectedCount;
  console.log(`${pass ? 'PASS' : 'FAIL'} - ${name}`);
  if (!pass) {
    console.log('  expected parties:', expectedParties, 'count:', expectedCount);
    console.log('  got parties     :', keys, 'count:', resolved.length);
  }
  return pass;
}

const cases = [
  { name: 'Case 1 RainReport no stakeholders, client logo exists', project: { name: 'RAINREPORT', code: 'SFCC-RR-001', client: 'RAINREPORT', consultant: 'NA', pmc: 'NA' }, logos: { sfcc: 'data:image/png;base64,test', client: 'data:image/png;base64,test', consultant: null, pmc: null }, stakeholders: [], expectedParties: ['client', 'contractor'], expectedCount: 2 },
  { name: 'Case 2 QSAS client + PMC stakeholders, consultant NA (logo-only consultant must not appear)', project: { name: 'QSAS', code: 'SFCC-QSAS-A26-004', client: 'QSAS', consultant: 'NA', pmc: 'TAKAMUL' }, logos: { sfcc: 'x', client: 'x', consultant: 'x', pmc: 'x' }, stakeholders: [{ role: 'Client / Employer', company_name: 'QSAS', active: 1, is_default_for_role: 0 }, { role: 'PMC', company_name: 'Takamul', active: 1, is_default_for_role: 0 }], expectedParties: ['client', 'contractor', 'pmc'], expectedCount: 3 },
  { name: 'Case 3 QSAS client + consultant + pmc stakeholders', project: { name: 'QSAS', code: 'SFCC-QSAS-A26-004', client: 'QSAS', consultant: 'NA', pmc: 'NA' }, logos: { sfcc: 'x', client: 'x', consultant: 'x', pmc: 'x' }, stakeholders: [{ role: 'Client / Employer', company_name: 'QSAS', active: 1, is_default_for_role: 0 }, { role: 'Consultant / Engineer', company_name: 'Consult Co', active: 1, is_default_for_role: 0 }, { role: 'PMC', company_name: 'Takamul', active: 1, is_default_for_role: 0 }], expectedParties: ['client', 'contractor', 'consultant', 'pmc'], expectedCount: 4 },
  { name: 'Case 4 logo-only consultant should not appear', project: { name: 'P', code: 'C', client: 'ACME', consultant: 'NA', pmc: 'NA' }, logos: { sfcc: 'x', client: 'x', consultant: 'x', pmc: null }, stakeholders: [{ role: 'Client / Employer', company_name: 'ACME', active: 1, is_default_for_role: 1 }], expectedParties: ['client', 'contractor'], expectedCount: 2 },
  { name: 'Case 5 only contractor', project: { name: 'Proj', code: 'P-1', client: '', consultant: 'NA', pmc: 'NA' }, logos: { sfcc: 'x', client: null, consultant: null, pmc: null }, stakeholders: [], expectedParties: ['contractor'], expectedCount: 1 },
];

const allPass = cases.every((testCase) => runCase(testCase.name, testCase));
if (!allPass) process.exit(1);
