import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolveV320DispatchSigningDays } from '../src/v320DispatchSigningTruth.js';

const checked=['src/v320EvidenceAutoBackfill.js','src/v319TrendCacheFastPatch.js','src/v320DispatchMetricOverlay.js','src/v294AttemptSigningTruth.js','src/v225ExportReturnTruth.js','src/v200TemplateDashboardExporter.js','src/v183SingleBusinessExportJobWorker.js','public/v194-export-token-ui.js','public/v308-dashboard-read-bridge.js'];
for(const file of checked)execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const backfill=fs.readFileSync('src/v320EvidenceAutoBackfill.js','utf8');
const route=fs.readFileSync('src/v319TrendCacheFastPatch.js','utf8');
const overlay=fs.readFileSync('src/v320DispatchMetricOverlay.js','utf8');
const ledgerBridge=fs.readFileSync('src/v294AttemptSigningTruth.js','utf8');
const exportTruth=fs.readFileSync('src/v225ExportReturnTruth.js','utf8');
const exporter=fs.readFileSync('src/v200TemplateDashboardExporter.js','utf8');
const worker=fs.readFileSync('src/v183SingleBusinessExportJobWorker.js','utf8');
const exportUi=fs.readFileSync('public/v194-export-token-ui.js','utf8');
const ui=fs.readFileSync('public/v308-dashboard-read-bridge.js','utf8');

assert.doesNotMatch(route,/import '\.\/v320EvidenceAutoBackfill\.js';/,'web trend runtime must not auto-load evidence backfill during startup');
assert.match(backfill,/const CHUNK=50,CONCURRENCY=4/,'export evidence repair must remain bounded at 50 tickets x 4 concurrency');
assert.match(backfill,/runV320EvidenceBackfillNow\(options=\{\}\)/,'repair capability must be explicitly callable with a scoped export selection');
assert.match(backfill,/COALESCE\(l\.signingDays,0\)<=0/,'missing signing evidence must enter repair candidates');
assert.match(backfill,/TRIM\(COALESCE\(l\.podDate,''\)\)=''/,'missing real POD date must enter repair candidates');
assert.match(backfill,/shipmentCodes/,'export repair must be limited to the exact missing shipment set when supplied');
assert.match(backfill,/applyV246EvidenceRows/,'a trajectory-proven POD date must be persisted before strict attempt evidence');
assert.match(backfill,/applyV246StrictAttemptEvidence/,'repaired START/attempt truth must persist through strict evidence owner');
assert.match(backfill,/processingBusy\(db\)/,'repair must still yield while foreground QC processing is active');
assert.match(backfill,/json_valid\(l\.evidenceJson\)/,'candidate selection must tolerate malformed legacy evidence');

assert.match(ledgerBridge,/evidenceJson,currentStateJson/,'V294 export bridge must read persisted strict evidence JSON');
assert.match(ledgerBridge,/ledgerEvidence\?\.starts\?\.\[0\]\?\.time/,'V294 must expose the persisted strict START time to the dispatch signing owner');
assert.match(ledgerBridge,/if\(persistedStart&&!text\(row\.firstAttemptAt\)\)row\.firstAttemptAt=persistedStart/,'saved strict START may fill only a missing export START');
assert.match(exportTruth,/applyV294ExportAttemptSigningTruth\(businessType,rows,\{db:getDb\(\),range\}\)/,'export must hydrate persisted ledger truth before final strict signing calculation');
assert.match(exportTruth,/applyV320DispatchSigningTruth/,'strict START-to-POD remains the final signing-days owner');

const dispatch=resolveV320DispatchSigningDays({events:[],firstAttemptAt:'2026-07-13 09:00:00',podDate:'2026-07-15'});
assert.equal(dispatch.days,3,'persisted strict START + real POD date must calculate inclusive START-to-POD days');
assert.equal(dispatch.dispatchDate,'2026-07-13');

assert.match(exporter,/missingShopeeEvidenceBills/,'Shopee complete export must detect exact missing evidence bills before writing');
assert.match(exporter,/runV320EvidenceBackfillNow\(\{businessType,fromDate:dateKey\(range\.from\),toDate:dateKey\(range\.to\),shipmentCodes:gaps/,'export must repair only the selected business/range missing bills');
assert.match(exporter,/rows=await collectV200Rows\(businessType,range,onProgress\);assertV200ExportRange/,'export must rebuild rows after repair before applying completeness gate');
assert.match(exporter,/assertShopeeExportTruth/,'strict completeness gate must remain active after repair');
assert.match(worker,/phase==='evidenceRepair'/,'worker must expose real evidence-repair progress instead of a frozen generating label');

assert.match(exportUi,/error\.jobTerminal=true/,'terminal FAILED/CANCELLED jobs must be marked as terminal UI errors');
assert.match(exportUi,/if\(error\?\.jobTerminal\|\|/,'terminal job errors must stop the reconnect loop regardless of custom error code');
assert.match(exportUi,/仅网络\/状态通道故障才重连/,'reconnect text must be reserved for actual transport failures');

assert.match(overlay,/json_valid\(f\.attemptHistoryJson\)/,'historical metric reads must tolerate malformed attempt history');
assert.match(overlay,/RECONCILED_COMPLETED_DASHBOARD_CACHE_MATCHED_DENOMINATOR/,'current cards keep denominator-reconciled cache truth');
assert.doesNotMatch(ui,/setInterval\(\(\)=>\{if\(activeShopeeType\(\)\)loadTable\(true\);\},10000\)/,'visible page must not poll every 10s');
assert.doesNotMatch(ui,/\/api\/v315\/evidence-recheck/,'user-facing table must not force manual recheck just to render');

console.log('[V380/V321] export evidence repair gate passed · missing POD/signing/START evidence is scoped and repaired 50x4 · persisted strict START bridges into real START-to-POD signing · strict fail-closed remains · FAILED jobs stop fake 5178 reconnect loops');
