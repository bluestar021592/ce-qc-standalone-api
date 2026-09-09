import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

for (const file of [
  'src/v225ExportReturnTruth.js',
  'src/v419CanonicalExportLedgerTruth.js',
  'src/v484StrictExportEvidenceOwner.js',
  'src/v381ExportEvidenceRepair.js',
  'src/v320DispatchSigningTruth.js',
  'src/v200TemplateDashboardExporter.js'
]) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });

const read = file => fs.readFileSync(file, 'utf8');
const v225 = read('src/v225ExportReturnTruth.js');
const v419 = read('src/v419CanonicalExportLedgerTruth.js');
const v484 = read('src/v484StrictExportEvidenceOwner.js');
const v381 = read('src/v381ExportEvidenceRepair.js');
const v320 = read('src/v320DispatchSigningTruth.js');
const v200 = read('src/v200TemplateDashboardExporter.js');

assert.match(v225, /V489_FORMAL_EXPORT_EVIDENCE_PATH_ID = '2026-09-09-v489-canonical-ledger-then-actual-pod-gap-v1'/);
assert.doesNotMatch(v225, /applyV381LedgerExportTruth\s*\(/, 'formal V200 export must not re-run V381 full-member ledger hydration before V419');
assert.doesNotMatch(v225, /applyV320DispatchSigningTruth\s*\(/, 'formal V200 export must not re-run V320 full-member track hydration before V419');
assert.match(v225, /if\(!STRICT_DELIVERY_TYPES\.has\(businessType\)\)applyV230AttemptSigningTruth\(businessType,rows\)/, 'strict TBKH/CN/VN must skip legacy V230 full-member saved-track hydration');
assert.match(v225, /applyV419CanonicalExportLedgerTruth\(businessType,rows,\{db:getDb\(\),onProgress\}\)/, 'V419 must be the first strict-evidence database owner after historical membership hydration');

const sourceRowsPos = v225.indexOf('collectV320HistoricalExportRows');
const v419Pos = v225.indexOf('applyV419CanonicalExportLedgerTruth(businessType,rows');
assert.ok(sourceRowsPos >= 0 && v419Pos > sourceRowsPos, 'formal export must hydrate historical members before canonical ledger truth');

assert.match(v419, /FROM qc_tracking_ledger WHERE shipmentCode IN \(\$\{marks\}\)/, 'V419 scalar hydration must stay shipmentCode-primary-key driven');
assert.match(v419, /const strictPodBills=STRICT_TYPES\.has\(type\)\?ledger\.filter/, 'V419 evidenceJson must remain strict-POD-only');
assert.match(v419, /onProgress\(\{phase:'hydrateLedgerTruth',completed:0,total:bills\.length/, 'V419 must emit progress before its first ledger batch');

assert.match(v200, /const rows = await collectV200Rows\(businessType, range, onProgress\);[\s\S]*repairV484StrictExportEvidence\(/, 'V484 actual-POD-gap repair must run only after real export members are known');
assert.match(v484, /listV483StrictExportRowGaps\(businessType,rows\)/, 'V484 must remain actual POD gap driven');
assert.match(v484, /savedEventsForGapGroup\(businessType,group,db\)/, 'V484 local SQLite evidence must stay gap-scoped');
assert.match(v484, /repairV483StrictExportRows\(/, 'only residual strict gaps may reach bounded remote repair');

assert.match(v381, /export function applyV381LedgerExportTruth/, 'V381 compatibility function must remain available outside formal workbook hot path');
assert.match(v320, /export function applyV320DispatchSigningTruth/, 'V320 compatibility function must remain available outside formal workbook hot path');

console.log('[V489] formal export hot-path smoke passed · sourceRows → V419 shipmentCode-PK canonical ledger → V484 actual-POD gaps · retired V381/V320/V230 strict full-member scans stay off formal workbook path');
