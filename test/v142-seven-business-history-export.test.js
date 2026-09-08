import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const syntax=file=>{const r=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});assert.equal(r.status,0,`${file}: ${r.stderr||r.stdout}`);};

test('V142 history audit is read-only and covers seven businesses, carry and evidence tables',()=>{
  syntax('src/v142SevenBusinessHistoryAudit.js');const s=read('src/v142SevenBusinessHistoryAudit.js');
  assert.match(s,/\['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'\]/);assert.match(s,/WHPP/);
  assert.match(s,/carryover_open_items/);assert.match(s,/business_track_events/);assert.match(s,/business_scan_results/);assert.match(s,/final_rows/);
  assert.match(s,/exportReady/);assert.match(s,/BLOCKED_UNTIL_REPAIRED/);assert.match(s,/CEAF_SOURCE_MEMBERSHIP_MISMATCH/);assert.match(s,/missingBills/);
  assert.match(s,/2026-09-08-v457-whpp-legacy-metadata-loss-attestation-v1/);
  assert.match(s,/2026-09-08-v460-whpp-history-snapshot-exact-disambiguation-v1/);
  assert.match(s,/business_history_summary/);assert.match(s,/coveredDailyRows/);assert.match(s,/attestedSnapshotCandidateCount/);
  assert.doesNotMatch(s,/\b(?:INSERT|UPDATE|DELETE|REPLACE)\s+(?:INTO|FROM|OR)?/i);
});

test('V142 strict direct exporter includes CEAF and WHPP and cannot silently skip a requested date',()=>{
  syntax('src/v142SevenBusinessPeriodExporter.js');const s=read('src/v142SevenBusinessPeriodExporter.js');
  assert.match(s,/ALL_TYPES=\[\.\.\.CORE_TYPES,'WHPP'\]/);assert.match(s,/CEAF/);assert.match(s,/loadWhppRows/);
  assert.match(s,/auditSevenBusinessHistory/);assert.match(s,/已阻止静默缺日导出/);assert.match(s,/历史完整性校验未通过，已阻止缺数据导出/);
  assert.match(s,/2026-09-08-v457-direct-export-consumes-audited-whpp-authority-v1/);
  assert.match(s,/const snapshots=buildSnapshots\(range,audit\)/,'direct export must pass the exact successful audit into snapshot construction');
  assert.match(s,/dayAudit\.whpp\?\.snapshotId/,'direct export must consume the WHPP snapshot id already certified by the audit');
  assert.doesNotMatch(s,/SELECT snapshotId FROM business_export_snapshots WHERE businessType='WHPP'/,'direct export must not reselect a different same-date WHPP snapshot after the audit');
  assert.match(s,/数据完整性校验/);assert.match(s,/跨日当前未闭环/);assert.match(s,/七业务/);
});

test('V142 direct GET export is strict and read-only audit endpoint is available',()=>{
  syntax('src/v142SevenBusinessExportPatch.js');const s=read('src/v142SevenBusinessExportPatch.js');
  assert.match(s,/\/api\/export-period/);assert.match(s,/\/api\/v142\/history-integrity/);assert.match(s,/V142-SEVEN-BUSINESS-STRICT/);
  assert.match(s,/POST \/api\/export-period\/prepare deliberately remains owned by V84/);
});

test('V142 preflights the existing V84 async prepare route before a background export is accepted',()=>{
  syntax('src/v142AsyncExportPreflightPatch.js');const s=read('src/v142AsyncExportPreflightPatch.js');
  assert.match(s,/\/api\/export-period\/prepare/);assert.match(s,/auditSevenBusinessHistory/);assert.match(s,/SEVEN_BUSINESS_HISTORY_INCOMPLETE/);assert.match(s,/this\.route\(PREPARE_PATH\)\.post\(preflight\)/);
  const boot=read('bootstrap.js');
  assert.ok(boot.indexOf("v84AsyncExportPatch")<boot.indexOf("v142AsyncExportPreflightPatch"));
});

test('V141 and V142 are wired into bootstrap and import-page UI',()=>{
  const boot=read('bootstrap.js');const ui=read('src/v44WhppUiPatch.js');
  assert.match(boot,/v141WhppDailyRetryIsolationPatch/);assert.match(boot,/v142SevenBusinessExportPatch/);assert.match(boot,/v142AsyncExportPreflightPatch/);
  assert.match(ui,/v141-whpp-retry-isolation-ui\.js/);
  assert.match(ui,/v142-history-integrity-audit\.js\?v=20260908-v460-1/,'V460 history audit UI must be cache-busted by the shell loader');
  assert.doesNotMatch(ui,/v142-history-integrity-audit\.js\?v=20260908-v457-1/,'retired V457 cache key must never pin the pre-disambiguation history UI');
  assert.doesNotMatch(ui,/v142-history-integrity-audit\.js\?v=20260902-v419-priority-1/,'retired V419 cache key must never keep the V456 history UI pinned in browsers');
});

test('legacy five-business direct period exporter is no longer the registered GET route authority',()=>{
  const legacy=read('src/periodExporter.js');const patch=read('src/v142SevenBusinessExportPatch.js');
  assert.match(legacy,/五业务/);assert.match(patch,/exportSevenBusinessPeriodReports/);
});