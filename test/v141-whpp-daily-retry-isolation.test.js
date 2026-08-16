import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const syntax=file=>{const result=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});assert.equal(result.status,0,`${file}: ${result.stderr||result.stdout}`);};

test('V141 isolates WHPP daily automatic runs from historical carry without deleting evidence',()=>{
  syntax('src/v141WhppDailyRetryIsolationPatch.js');
  const source=read('src/v141WhppDailyRetryIsolationPatch.js');
  assert.match(source,/v141-whpp-daily-retry-isolation-v2/);
  assert.match(source,/v165WhppRunStateRecoveryPatch/);
  assert.match(source,/v143WhppRetryQueuePatch/);
  assert.match(source,/\/api\/whpp\/run\/start/);
  assert.match(source,/\/api\/whpp\/run\/resume/);
  assert.match(source,/state\.carryBills = \[\]/);
  assert.match(source,/state\.nextCarryBills = \[\]/);
  assert.match(source,/historicalDetached/);
  assert.match(source,/retryPendingBefore/);
});

test('V165 rebuilds missing WHPP run state from normalized current-day SQLite membership before V141 isolation',()=>{
  syntax('src/v165WhppRunStateRecoveryPatch.js');
  const source=read('src/v165WhppRunStateRecoveryPatch.js');
  assert.match(source,/v165-whpp-run-state-recovery-v1/);
  assert.match(source,/business_daily_reports/);
  assert.match(source,/business_daily_parse_rows/);
  assert.match(source,/WHPP_NORMALIZED_DAILY_MISMATCH/);
  assert.match(source,/pnhBills: normalized\.bills/);
  assert.match(source,/carryBills: \[\]/);
  assert.match(source,/nextCarryBills: \[\]/);
  assert.match(source,/reportDate: normalized\.daily\.reportDate/);
  assert.doesNotMatch(source,/DELETE FROM/);
});

test('WHPP resume path still queries only per-waybill statuses that are not already successful',()=>{
  const pipeline=read('src/whppPipeline.js');
  assert.match(pipeline,/const scanPending = allBills\.filter\(bill => scanStatuses\.get\(bill\)\?\.status !== 'success'\)/);
  assert.match(pipeline,/const pending = cleanCodes\(bills\)\.filter\(bill => statuses\.get\(bill\)\?\.status !== 'success'\)/);
  assert.match(pipeline,/仅重试失败运单/);
});

test('V145 presents one seven-business retry center with visible polling and inline CE relogin',()=>{
  syntax('public/v141-whpp-retry-isolation-ui.js');
  const ui=read('public/v141-whpp-retry-isolation-ui.js');
  assert.match(ui,/v145-seven-business-retry-center-v1/);
  assert.match(ui,/七业务接口失败 \/ 失效重试中心/);
  assert.match(ui,/后台重试处理中/);
  assert.match(ui,/schedulePoll/);
  assert.match(ui,/普通未POD和普通跨日遗留不会进入这里/);
  assert.match(ui,/重新登录CE并继续重试/);
});

test('V141 backend isolation stays before WHPP run routes and V145 UI is force-refreshed after V135 runner',()=>{
  const injector=read('src/v44WhppUiPatch.js');
  assert.ok(injector.indexOf("import './v141WhppDailyRetryIsolationPatch.js'")<injector.indexOf("import './v135WhppPartialSnapshotPatch.js'"));
  assert.match(injector,/import '\.\/v145SevenBusinessRetryCenterPatch\.js'/);
  assert.match(injector,/v141-whpp-retry-isolation-ui\.js\?v=20260816-7/);
  assert.match(injector,/v145-seven-business-retry-center-v1/);
  assert.ok(injector.indexOf('v135-whpp-retry-aware-run.js')<injector.indexOf('v141-whpp-retry-isolation-ui.js'));
});
