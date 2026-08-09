import fs from 'node:fs';

function patchFile(file, replacements) {
  let source = fs.readFileSync(file, 'utf8');
  let changed = false;
  for (const { before, after, label } of replacements) {
    if (source.includes(after)) continue;
    const count = source.split(before).length - 1;
    if (count !== 1) throw new Error(`${file} ${label}: expected exactly one match, got ${count}`);
    source = source.replace(before, after);
    changed = true;
  }
  if (changed) fs.writeFileSync(file, source, 'utf8');
}

patchFile('server.js', [
  {
    before: "app.get(['/ce', '/tbkh', '/ali1688', '/shopeecn', '/shopeevn', '/ccsl', '/shopee', '/tracking', '/exceptions', '/reports', '/import', '/settings', '/logs', '/data-management'], (req, res) => {",
    after: "app.get(['/ce', '/ceaf', '/tbkh', '/ali1688', '/shopeecn', '/shopeevn', '/ccsl', '/shopee', '/tracking', '/exceptions', '/reports', '/import', '/settings', '/logs', '/data-management'], (req, res) => {",
    label: 'CEAF page route'
  },
  {
    before: "if (!['CE','TBKH','ALI1688','SHOPEECN','SHOPEEVN'].includes(type)) return null;",
    after: "if (!['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'].includes(type)) return null;",
    label: 'fast business state allowlist'
  },
  {
    before: "for (const type of ['CE','TBKH','ALI1688','SHOPEECN','SHOPEEVN']) {",
    after: "for (const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN']) {",
    label: 'bootstrap business list'
  },
  {
    before: "const ccslRows = parsed.rows.filter(row => ['CE', 'TBKH', 'ALI1688'].includes(row.businessType));",
    after: "const ccslRows = parsed.rows.filter(row => ['CE', 'CEAF', 'TBKH', 'ALI1688'].includes(row.businessType));",
    label: 'unified import CCSL rows'
  },
  {
    before: "const historicalCcsl = processingQueue.rows.filter(row => row.sourceType === 'HISTORICAL_CARRY' && ['CE', 'TBKH', 'ALI1688'].includes(row.businessType));",
    after: "const historicalCcsl = processingQueue.rows.filter(row => row.sourceType === 'HISTORICAL_CARRY' && ['CE', 'CEAF', 'TBKH', 'ALI1688'].includes(row.businessType));",
    label: 'historical CCSL carry rows'
  },
  {
    before: "if (snapshotId) states = ['CE', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'].map(type => loadLightweightUnifiedBusinessState(type, snapshotId));",
    after: "if (snapshotId) states = ['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'].map(type => loadLightweightUnifiedBusinessState(type, snapshotId));",
    label: 'tracking workspace business list'
  }
]);

patchFile('src/lightweightDashboardStore.js', [
  {
    before: "const BUSINESS_TYPES = Object.freeze(['CE', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN']);",
    after: "const BUSINESS_TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN']);",
    label: 'business types'
  },
  {
    before: "    : ['CE', 'TBKH', 'ALI1688'];",
    after: "    : ['CE', 'CEAF', 'TBKH', 'ALI1688'];",
    label: 'CCSL aggregate types'
  }
]);

patchFile('src/rangeDashboardStoreV31.js', [
  {
    before: "const CCSL_TYPES = Object.freeze(['CE', 'TBKH', 'ALI1688']);",
    after: "const CCSL_TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688']);",
    label: 'CCSL types'
  },
  {
    before: "    CE: buildCcslState('CE', ccslDaily.filter(row => row.businessType === 'CE'), range, dates),\n    TBKH:",
    after: "    CE: buildCcslState('CE', ccslDaily.filter(row => row.businessType === 'CE'), range, dates),\n    CEAF: buildCcslState('CEAF', ccslDaily.filter(row => row.businessType === 'CEAF'), range, dates),\n    TBKH:",
    label: 'CEAF state'
  },
  {
    before: "      WHERE u.businessType IN ('CE','TBKH','ALI1688')",
    after: "      WHERE u.businessType IN ('CE','CEAF','TBKH','ALI1688')",
    label: 'CCSL SQL types'
  }
]);

patchFile('src/rangeDashboardStoreLegacy.js', [
  {
    before: "const CCSL_TYPES = Object.freeze(['CE', 'TBKH', 'ALI1688']);",
    after: "const CCSL_TYPES = Object.freeze(['CE', 'CEAF', 'TBKH', 'ALI1688']);",
    label: 'legacy cache CCSL types'
  }
]);
