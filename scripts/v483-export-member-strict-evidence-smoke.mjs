import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { listV483StrictExportRowGaps, applyV483StrictTruthToExportRows } from '../src/v381ExportEvidenceRepair.js';

for (const file of ['src/v381ExportEvidenceRepair.js','src/v484StrictExportEvidenceOwner.js','src/v200TemplateDashboardExporter.js']) {
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
const owner=fs.readFileSync('src/v484StrictExportEvidenceOwner.js','utf8');
const exporter=fs.readFileSync('src/v200TemplateDashboardExporter.js','utf8');
assert.match(repair,/V483_EXPORT_MEMBER_EVIDENCE_ID='2026-09-08-v483-export-member-driven-strict-evidence-v1'/,'V483 residual owner id missing');
assert.match(repair,/export function listV483StrictExportRowGaps/,'V483 must diagnose actual export POD members');
assert.match(repair,/export async function repairV483StrictExportRows/,'V483 residual 50x4 repair owner missing');
assert.match(repair,/ce\.trackQuery\(bills\)/,'V483 must query only residual export-member gaps through the bounded trajectory client');
assert.match(repair,/V381_EXPORT_TRACK_BATCH=50/,'V483 must retain 50-ticket trajectory batches');
assert.match(repair,/V381_EXPORT_TRACK_CONCURRENCY=4/,'V483 must retain x4 bounded trajectory concurrency');
assert.match(repair,/V483_STRICT_EXPORT_EVIDENCE_INCOMPLETE:[^`]*missingAttempt=/,'remaining strict gaps must fail with explicit diagnostics');

assert.match(owner,/repairV483StrictExportRows/,'V484 must delegate only remaining gaps to V483');
assert.match(exporter,/repairV484StrictExportEvidence/,'common V200 owner must invoke V484 wrapper instead of calling V483 directly');
assert.doesNotMatch(exporter,/repairV483StrictExportRows\s*\(/,'V200 must not bypass V484 local-saved-evidence phase');
const collect=exporter.indexOf('const rows = await collectV200Rows');
const v484=exporter.indexOf('await repairV484StrictExportEvidence');
const stats=exporter.indexOf('const stats = statsOf');
const write=exporter.indexOf('await writeV200ReferenceWorkbook');
assert.ok(collect>0&&v484>collect&&stats>v484&&write>stats,'V200 order must be actual export rows → V484(saved local→V483 residual) → metrics → workbook');

console.log('[V484/V483] export-member strict evidence smoke passed · V483 remains bounded 50x4 residual owner under V484 · proven attempt/signing mutates actual export rows · non-strict businesses excluded · unresolved gaps fail with exact diagnostics');
