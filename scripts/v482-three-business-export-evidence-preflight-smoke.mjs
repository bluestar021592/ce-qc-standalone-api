import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

for(const file of ['src/v381ExportEvidenceRepair.js','src/v484StrictExportEvidenceOwner.js','src/v200TemplateDashboardExporter.js','src/v84ExportBusinessWorker.js','src/v183SingleBusinessExportJobWorker.js']){
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}

const repair=fs.readFileSync('src/v381ExportEvidenceRepair.js','utf8');
const owner=fs.readFileSync('src/v484StrictExportEvidenceOwner.js','utf8');
const exporter=fs.readFileSync('src/v200TemplateDashboardExporter.js','utf8');
const allWorker=fs.readFileSync('src/v84ExportBusinessWorker.js','utf8');
const singleWorker=fs.readFileSync('src/v183SingleBusinessExportJobWorker.js','utf8');
const workbook=fs.readFileSync('src/v200ReferenceWorkbook.js','utf8');

assert.match(repair,/V482_STRICT_EXPORT_EVIDENCE_REPAIR_ID='2026-09-08-v482-three-business-export-scoped-evidence-repair-v1'/,'V482 compatibility owner id missing');
assert.match(repair,/V294_ATTEMPT_TYPES/,'legacy V482 compatibility scope must continue to inherit canonical V294 types');
assert.match(repair,/V381_EXPORT_TRACK_BATCH=50/,'legacy/residual remote trajectory repair must stay 50 per request');
assert.match(repair,/V381_EXPORT_TRACK_CONCURRENCY=4/,'legacy/residual remote trajectory repair must stay x4');
assert.match(repair,/export async function prepareV381ShopeeExportEvidence[\s\S]*return prepareV482StrictExportEvidence\(options\)/,'legacy V381 caller must still delegate to V482 compatibility owner');

assert.match(owner,/V484_STRICT_EXPORT_EVIDENCE_OWNER_ID='2026-09-09-v492-shopee-only-strict-export-evidence-v1'/,'V492 formal export owner id missing');
assert.match(owner,/V484_STRICT_EXPORT_EVIDENCE_TYPES=new Set\(\['SHOPEECN','SHOPEEVN'\]\)/,'formal strict evidence scope must be Shopee CN/VN only');
assert.match(owner,/listV483StrictExportRowGaps/,'V484/V492 must start from actual export POD gaps');
assert.match(owner,/FROM track_events WHERE shipmentCode IN/,'legacy TBKH saved evidence branch may remain compatibility-only but must be unreachable from formal strict gate');
assert.match(owner,/FROM business_track_events WHERE shipmentCode IN/,'business saved evidence must use bare shipmentCode candidate lookup');
assert.doesNotMatch(owner,/reconcileV246TrackingLedger|backfillV294StrictAttemptsFromSavedEvidence/,'formal V484/V492 export must never run full-range ledger reconcile/backfill');
assert.match(owner,/repairV483StrictExportRows/,'only residual Shopee gaps may delegate to V483 50x4 remote repair');
assert.match(owner,/applyV246StrictAttemptEvidence/,'proven saved/remote evidence must still persist through canonical V246 owner where ledger rows exist');

assert.match(exporter,/repairV484StrictExportEvidence/,'common V200 workbook owner must invoke V484/V492 actual-member evidence owner');
assert.match(exporter,/if \(isV484StrictExportEvidenceType\(businessType\)\)/,'formal V200 export must guard repair with Shopee-only gate');
assert.doesNotMatch(exporter,/prepareV482StrictExportEvidence\s*\(/,'formal V200 export must not invoke V482 full-range preflight');
const collect=exporter.indexOf('const rows = await collectV200Rows');
const gate=exporter.indexOf('if (isV484StrictExportEvidenceType(businessType))');
const v484=exporter.indexOf('await repairV484StrictExportEvidence');
const write=exporter.indexOf('await writeV200ReferenceWorkbook');
assert.ok(collect>0&&gate>collect&&v484>gate&&write>v484,'formal order must be actual export rows → Shopee-only gate → V484/V492 local-first residual repair → workbook');

assert.match(allWorker,/createV200ReferenceDashboardWorkbook/,'ALL export child must continue through the one common V200 owner');
assert.match(singleWorker,/createV200ReferenceDashboardWorkbook/,'single-business export must continue through the same V200 owner');
assert.match(workbook,/STRICT_VERIFIED_METRIC_TYPES=new Set\(\['SHOPEECN','SHOPEEVN'\]\)/,'strict metric fail-closed scope must be Shopee CN/VN only');
assert.doesNotMatch(workbook,/STRICT_VERIFIED_METRIC_TYPES=new Set\(\[[^\]]*'TBKH'/,'TBKH must stay outside Shopee-only metric fail-closed gate');
assert.doesNotMatch(workbook,/STRICT_VERIFIED_METRIC_TYPES=new Set\(\[[^\]]*(?:'CE'|'CEAF'|'ALI1688'|'WHPP')/,'non-strict CE/CEAF/ALI1688/WHPP must stay outside strict metric gate');

console.log('[V492/V482] export owner smoke passed · V482 compatibility retained but retired from formal hot path · formal strict evidence/metric scope is Shopee CN/VN only · TBKH cannot be blocked by Shopee attempt/signing semantics · residual Shopee gaps stay V483 50x4');
