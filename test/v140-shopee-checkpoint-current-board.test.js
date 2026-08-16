import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const syntax=file=>{
  const result=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});
  assert.equal(result.status,0,`${file}: ${result.stderr||result.stdout}`);
};

test('V140 recovers SHOPEE per-waybill query checkpoints before start or resume without deleting business evidence',()=>{
  syntax('src/v140ShopeeCheckpointRecoveryPatch.js');
  const source=read('src/v140ShopeeCheckpointRecoveryPatch.js');
  assert.match(source,/v140-shopee-per-waybill-checkpoint-recovery-v2/);
  assert.match(source,/RUN_ROUTES = new Set\(\['\/api\/shopee\/run\/start', '\/api\/shopee\/run\/resume'\]\)/);
  assert.match(source,/business_api_batches/);
  assert.match(source,/business_scan_results/);
  assert.match(source,/business_track_events/);
  assert.match(source,/business_exception_items/);
  assert.match(source,/scanQueryStatus/);
  assert.match(source,/eventQueryStatus/);
  assert.match(source,/exceptionQueryStatus/);
  assert.match(source,/current\?\.status === 'success'/);
  assert.match(source,/key === 'scanQueryStatus' && status === 'success'/);
  assert.match(source,/ONLY recovered scan-success authority/);
  assert.match(source,/UPDATE business_states SET valueJson=/);
  assert.doesNotMatch(source,/DELETE FROM/i);
  assert.doesNotMatch(source,/UPDATE (?:unified_import_rows|final_rows|business_final_rows|business_scan_results|business_track_events|business_exception_items)/i);
});

test('V140 carry isolation runs first and checkpoint recovery runs immediately before SHOPEE handler',()=>{
  const retry=read('src/v70ConfirmQueryResiliencePatch.js');
  const v140=read('src/v140ShopeeCheckpointRecoveryPatch.js');
  const v139=read('src/v139DailyCarryIsolationPatch.js');
  assert.ok(retry.indexOf("import './v140ShopeeCheckpointRecoveryPatch.js'")<retry.indexOf("import './v139DailyCarryIsolationPatch.js'"));
  assert.match(v139,/SHOPEE_RUN_ROUTES/);
  assert.match(v139,/return previousPost\.apply\(this, \[args\[0\], isolateShopeeCarry, \.\.\.args\.slice\(1\)\]\)/);
  assert.match(v140,/recoveryMiddleware, finalHandler/);
  assert.match(v140,/restores the checkpoint/);
});

test('V140 progress is phase-aware unique-waybill evidence and bounded by target total',()=>{
  syntax('src/v33RunProgressPatch.js');
  const source=read('src/v33RunProgressPatch.js');
  assert.match(source,/function uniqueBills/);
  assert.match(source,/function statusEvidence/);
  assert.match(source,/function boundedCounts/);
  assert.match(source,/Math\.min\(total, success\)/);
  assert.match(source,/Math\.min\(Math\.max\(0, total - Math\.min\(total, success\)\), failed\)/);
  assert.match(source,/%confirm-query%/);
  assert.match(source,/allowBatchSuccess: false/);
  assert.match(source,/%shipment-event%/);
  assert.match(source,/%exception-item%/);
  assert.match(source,/V140_UNIQUE_WAYBILL_ACTIVE_API_STATUS/);
  assert.doesNotMatch(source,/trackObserved = countRows\(state\.trackResults\)/);
});

test('V140 current business board bypasses completed-only compact cache when latest source has nonzero membership but board is empty',()=>{
  syntax('public/v140-current-business-truth.js');
  const ui=read('public/v140-current-business-truth.js');
  const server=read('server.js');
  assert.match(ui,/v140-current-business-truth-v1/);
  assert.match(ui,/sourceTotal > 0/);
  assert.match(ui,/currentTotal > 0 \|\| sourceTotal <= 0/);
  assert.match(ui,/\/api\/v89\/instant-dashboard\?date=/);
  assert.match(ui,/\/api\/business-state\/\$\{encodeURIComponent\(type\)\}\?snapshotId=/);
  assert.match(ui,/Deliberately omit compact=1/);
  assert.match(server,/if \(!batch \|\| batch\.snapshotStatus !== 'COMPLETED'/);
  assert.match(server,/loadLightweightUnifiedBusinessState\(req\.params\.businessType, requestedSnapshotId\)/);
});

test('V140 current business truth is injected after V139 carry UI and before lazy render layers',()=>{
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(injector,/v140-current-business-truth\.js\?v=20260816-1/);
  assert.match(injector,/v140-current-business-truth-v1/);
  assert.ok(injector.indexOf('v139-carry-manual-window.js')<injector.indexOf('v140-current-business-truth.js'));
  assert.ok(injector.indexOf('v140-current-business-truth.js')<injector.indexOf('v108-route-lazy-features.js'));
});

test('CEAF source rules remain exact and stronger than WHPP CE-prefix fallback',()=>{
  const parser=read('src/unifiedExcelParser.js');
  const normalizer=read('src/v75CeafUploadNormalizerPatch.js');
  assert.match(parser,/BUSINESS_PRIORITY = Object\.freeze\(\['CEAF'/);
  assert.match(parser,/customerName\.includes\('CCAF'\).*businessType: 'CEAF'/);
  assert.ok(parser.indexOf("customerName.includes('CCAF')")<parser.indexOf("shipmentCode.startsWith('CE')"));
  assert.match(normalizer,/token === 'CCAF' \|\| token === 'CEAF'/);
});
