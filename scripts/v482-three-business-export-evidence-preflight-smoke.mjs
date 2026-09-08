import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

for(const file of ['src/v381ExportEvidenceRepair.js','src/v200TemplateDashboardExporter.js','src/v84ExportBusinessWorker.js','src/v183SingleBusinessExportJobWorker.js']){
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}

const repair=fs.readFileSync('src/v381ExportEvidenceRepair.js','utf8');
const exporter=fs.readFileSync('src/v200TemplateDashboardExporter.js','utf8');
const allWorker=fs.readFileSync('src/v84ExportBusinessWorker.js','utf8');
const singleWorker=fs.readFileSync('src/v183SingleBusinessExportJobWorker.js','utf8');
const workbook=fs.readFileSync('src/v200ReferenceWorkbook.js','utf8');

assert.match(repair,/V482_STRICT_EXPORT_EVIDENCE_REPAIR_ID='2026-09-08-v482-three-business-export-scoped-evidence-repair-v1'/,'V482 strict evidence owner id missing');
assert.match(repair,/V294_ATTEMPT_TYPES/,'V482 must inherit the canonical V294 strict business scope instead of inventing another list');
assert.match(repair,/const STRICT_TYPES=new Set\(V294_ATTEMPT_TYPES\)/,'V482 strict scope must be TBKH + SHOPEECN + SHOPEEVN from V294');
assert.match(repair,/export function isV482StrictExportEvidenceType/,'V200 must have one reusable strict-business predicate');
assert.match(repair,/V381_EXPORT_TRACK_BATCH=50/,'strict export trajectory repair must stay 50 per request');
assert.match(repair,/V381_EXPORT_TRACK_CONCURRENCY=4/,'strict export trajectory repair must stay x4 concurrent groups');
assert.match(repair,/backfillV294StrictAttemptsFromSavedEvidence/,'saved SQLite strict trajectory must be reused before any CE repair query');
assert.match(repair,/ce\.trackQuery\(bills\)/,'only remaining incomplete terminal POD candidates may use the trajectory endpoint');
assert.match(repair,/applyV246StrictAttemptEvidence/,'repaired strict truth must persist through the canonical V246 evidence owner');
assert.match(repair,/export async function prepareV381ShopeeExportEvidence[\s\S]*return prepareV482StrictExportEvidence\(options\)/,'legacy V381 caller must delegate to the V482 owner');

const firstCandidate=repair.indexOf('let todo=listV381ExportEvidenceCandidates');
const savedBackfill=repair.indexOf('backfillV294StrictAttemptsFromSavedEvidence({',firstCandidate);
assert.ok(firstCandidate>0&&savedBackfill>firstCandidate,'V482 must candidate-check before historical saved-evidence backfill');
const firstReturn=repair.indexOf("if(!todo.length)return{ok:true,version:V482_STRICT_EXPORT_EVIDENCE_REPAIR_ID",firstCandidate);
assert.ok(firstReturn>firstCandidate&&firstReturn<savedBackfill,'already-complete strict evidence must short-circuit before a second historical backfill');

assert.match(exporter,/prepareV482StrictExportEvidence/,'the common V200 workbook owner must invoke V482 preflight');
assert.match(exporter,/isV482StrictExportEvidenceType/,'the common V200 owner must limit preflight to canonical strict businesses');
assert.match(exporter,/V482_STRICT_EXPORT_EVIDENCE_REPAIR_ID/,'V200 progress must expose the V482 evidence owner');
const preflight=exporter.indexOf('await prepareV482StrictExportEvidence');
const collect=exporter.indexOf('const rows = await collectV200Rows');
const write=exporter.indexOf('await writeV200ReferenceWorkbook');
assert.ok(preflight>0&&collect>preflight&&write>collect,'strict evidence preflight must finish before export hydration and workbook writing');

assert.match(allWorker,/createV200ReferenceDashboardWorkbook/,'ALL export child must continue through the one common V200 owner');
assert.match(singleWorker,/createV200ReferenceDashboardWorkbook/,'single-business export must continue through the same V200 owner');
assert.match(workbook,/STRICT_VERIFIED_METRIC_TYPES=new Set\(\['TBKH','SHOPEECN','SHOPEEVN'\]\)/,'workbook fail-closed strict scope must match V482/V294');
assert.doesNotMatch(workbook,/STRICT_VERIFIED_METRIC_TYPES=new Set\(\[[^\]]*(?:'CE'|'CEAF'|'ALI1688'|'WHPP')/,'non-strict CE/CEAF/ALI1688/WHPP must not enter the strict metric gate');

console.log('[V482] three-business export evidence preflight smoke passed · TBKH/CN/VN share candidate-first saved-evidence→50x4 repair in common V200 owner · ALL + single paths covered · non-strict four businesses excluded');
