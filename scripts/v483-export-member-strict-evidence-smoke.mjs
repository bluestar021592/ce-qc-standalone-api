import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { listV483StrictExportRowGaps, applyV483StrictTruthToExportRows } from '../src/v381ExportEvidenceRepair.js';

for (const file of ['src/v381ExportEvidenceRepair.js','src/v200TemplateDashboardExporter.js']) {
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}

const rows=[{
  shipmentCode:'TBKH-V483-001',businessType:'TBKH',pod:true,podDate:'2026-07-02',podTime:'2026-07-02',
  attemptNo:0,trackAttemptNo:0,podAttemptNo:0,currentAttemptNo:0,signingDays:0,deliveryDays:0
}];
let gaps=listV483StrictExportRowGaps('TBKH',rows);
assert.equal(gaps.length,1,'TBKH actual export POD row with no strict attempt/signing evidence must be a V483 gap');
assert.equal(gaps[0].attemptKnown,false);
assert.equal(gaps[0].signingKnown,false);

const applied=applyV483StrictTruthToExportRows(gaps[0],{
  attemptNo:2,source:'TEST_START_FAILURE_START',startMode:'TRACK_70',podDate:'2026-07-02',
  starts:[{time:'2026-07-01 09:00:00'},{time:'2026-07-02 08:00:00'}],failures:[{time:'2026-07-01 18:00:00'}]
});
assert.equal(applied.resolved,true,'real strict START evidence must resolve the export-member gap');
assert.equal(rows[0].attemptNo,2,'V483 must publish the proven strict attempt onto the actual export row');
assert.equal(rows[0].signingDays,2,'V483 signing must be inclusive real START→POD days');
assert.equal(rows[0].dispatchSigningEvidenceComplete,true);
assert.equal(rows[0].attemptEvidenceComplete,true);
assert.equal(listV483StrictExportRowGaps('TBKH',rows).length,0,'resolved export row must leave no V483 gap');
assert.equal(listV483StrictExportRowGaps('CE',[{shipmentCode:'CE-1',pod:true}]).length,0,'non-strict CE must never enter V483 strict evidence repair');

const repair=fs.readFileSync('src/v381ExportEvidenceRepair.js','utf8');
const exporter=fs.readFileSync('src/v200TemplateDashboardExporter.js','utf8');
assert.match(repair,/V483_EXPORT_MEMBER_EVIDENCE_ID='2026-09-08-v483-export-member-driven-strict-evidence-v1'/,'V483 owner id missing');
assert.match(repair,/export function listV483StrictExportRowGaps/,'V483 must diagnose actual export POD members, not only ledger candidates');
assert.match(repair,/export async function repairV483StrictExportRows/,'V483 residual repair owner missing');
assert.match(repair,/ce\.trackQuery\(bills\)/,'V483 must query only residual export-member gaps through the bounded trajectory client');
assert.match(repair,/V381_EXPORT_TRACK_BATCH=50/,'V483 must retain 50-ticket trajectory batches');
assert.match(repair,/V381_EXPORT_TRACK_CONCURRENCY=4/,'V483 must retain x4 bounded trajectory concurrency');
assert.match(repair,/applyV246StrictAttemptEvidence\(evidenceRows/,'V483 must persist strict evidence whenever a canonical ledger row already exists');
assert.match(repair,/V483_STRICT_EXPORT_EVIDENCE_INCOMPLETE:[^`]*missingAttempt=/,'remaining strict gaps must fail with explicit attempt/signing diagnostics instead of generic metric missing');

assert.match(exporter,/repairV483StrictExportRows/,'common V200 owner must invoke V483 residual repair');
const preflight=exporter.indexOf('await prepareV482StrictExportEvidence');
const collect=exporter.indexOf('const rows = await collectV200Rows');
const residual=exporter.indexOf('await repairV483StrictExportRows');
const stats=exporter.indexOf('const stats = statsOf');
const write=exporter.indexOf('await writeV200ReferenceWorkbook');
assert.ok(preflight>0&&collect>preflight&&residual>collect&&stats>residual&&write>stats,'V200 order must be V482 ledger prep → actual export rows → V483 residual repair → metrics → workbook');

console.log('[V483] export-member strict evidence smoke passed · actual TBKH POD gaps drive residual 50x4 START→POD repair · proven attempt/signing mutates export rows · non-strict businesses excluded · unresolved gaps fail with exact diagnostics');
