import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isV484StrictExportEvidenceType } from '../src/v484StrictExportEvidenceOwner.js';

for(const file of ['src/v484StrictExportEvidenceOwner.js','src/v200TemplateDashboardExporter.js','src/v381ExportEvidenceRepair.js']){
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}

assert.equal(isV484StrictExportEvidenceType('TBKH'),true);
assert.equal(isV484StrictExportEvidenceType('SHOPEECN'),true);
assert.equal(isV484StrictExportEvidenceType('SHOPEEVN'),true);
for(const type of ['CE','CEAF','ALI1688','WHPP'])assert.equal(isV484StrictExportEvidenceType(type),false,`${type} must stay outside strict export repair`);

const owner=fs.readFileSync('src/v484StrictExportEvidenceOwner.js','utf8');
const exporter=fs.readFileSync('src/v200TemplateDashboardExporter.js','utf8');
const legacy=fs.readFileSync('src/v381ExportEvidenceRepair.js','utf8');

assert.match(owner,/V484_STRICT_EXPORT_EVIDENCE_OWNER_ID='2026-09-09-v484-actual-export-member-local-first-evidence-v1'/);
assert.match(owner,/listV483StrictExportRowGaps\(businessType,rows\)/,'formal repair must derive candidates from actual export POD rows');
assert.match(owner,/FROM track_events WHERE shipmentCode IN/,'TBKH saved evidence must use shipmentCode-indexed candidate lookup');
assert.match(owner,/FROM business_track_events WHERE shipmentCode IN/,'business saved evidence must use shipmentCode-indexed candidate lookup');
assert.doesNotMatch(owner,/UPPER\s*\(\s*TRIM\s*\(\s*shipmentCode/i,'candidate evidence path must keep indexed shipmentCode bare');
assert.doesNotMatch(owner,/reconcileV246TrackingLedger|backfillV294StrictAttemptsFromSavedEvidence/,'formal owner must not perform selected-range full ledger/history backfill');
assert.match(owner,/repairV483StrictExportRows/,'only residual gaps may use V483 remote owner');
assert.match(owner,/V484_EXPORT_MEMBER_SAVED/,'saved strict evidence must persist through canonical evidence owner when possible');
assert.match(owner,/strictExportEvidenceSaved/,'local saved-evidence phase must be observable');
assert.match(owner,/strictExportEvidenceSavedDone/,'local saved-evidence completion must be observable');

assert.match(exporter,/const rows = await collectV200Rows/,'actual export membership must exist before strict repair');
assert.match(exporter,/await repairV484StrictExportEvidence/,'V200 must use V484 formal owner');
assert.doesNotMatch(exporter,/prepareV482StrictExportEvidence\s*\(/,'V482 full-range preflight is retired from formal export hot path');
const collect=exporter.indexOf('const rows = await collectV200Rows');
const repair=exporter.indexOf('await repairV484StrictExportEvidence');
const stats=exporter.indexOf('const stats = statsOf');
assert.ok(collect>0&&repair>collect&&stats>repair,'order must be actual rows → candidate repair → metrics');

assert.match(legacy,/V381_EXPORT_TRACK_BATCH=50/);
assert.match(legacy,/V381_EXPORT_TRACK_CONCURRENCY=4/);

console.log('[V484] actual-member local-first export evidence smoke passed · no full-range V482 backfill in formal export · bare shipmentCode saved-evidence lookup · actual POD gaps only · V483 residual stays 50x4 · strict TBKH/CN/VN scope unchanged');
