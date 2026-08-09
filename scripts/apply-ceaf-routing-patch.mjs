import fs from 'node:fs';

const file = 'server.js';
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  source = source.replace(before, after);
}

replaceOnce(
  "app.get(['/ce', '/tbkh', '/ali1688', '/shopeecn', '/shopeevn', '/ccsl', '/shopee', '/tracking', '/exceptions', '/reports', '/import', '/settings', '/logs', '/data-management'], (req, res) => {",
  "app.get(['/ce', '/ceaf', '/tbkh', '/ali1688', '/shopeecn', '/shopeevn', '/ccsl', '/shopee', '/tracking', '/exceptions', '/reports', '/import', '/settings', '/logs', '/data-management'], (req, res) => {",
  'CEAF page route'
);

replaceOnce(
  "if (!['CE','TBKH','ALI1688','SHOPEECN','SHOPEEVN'].includes(type)) return null;",
  "if (!['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'].includes(type)) return null;",
  'fast business state allowlist'
);

replaceOnce(
  "for (const type of ['CE','TBKH','ALI1688','SHOPEECN','SHOPEEVN']) {",
  "for (const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN']) {",
  'bootstrap business list'
);

replaceOnce(
  "const ccslRows = parsed.rows.filter(row => ['CE', 'TBKH', 'ALI1688'].includes(row.businessType));",
  "const ccslRows = parsed.rows.filter(row => ['CE', 'CEAF', 'TBKH', 'ALI1688'].includes(row.businessType));",
  'unified import CCSL rows'
);

replaceOnce(
  "const historicalCcsl = processingQueue.rows.filter(row => row.sourceType === 'HISTORICAL_CARRY' && ['CE', 'TBKH', 'ALI1688'].includes(row.businessType));",
  "const historicalCcsl = processingQueue.rows.filter(row => row.sourceType === 'HISTORICAL_CARRY' && ['CE', 'CEAF', 'TBKH', 'ALI1688'].includes(row.businessType));",
  'historical CCSL carry rows'
);

replaceOnce(
  "if (snapshotId) states = ['CE', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'].map(type => loadLightweightUnifiedBusinessState(type, snapshotId));",
  "if (snapshotId) states = ['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'].map(type => loadLightweightUnifiedBusinessState(type, snapshotId));",
  'tracking workspace business list'
);

fs.writeFileSync(file, source, 'utf8');
