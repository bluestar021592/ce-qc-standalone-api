import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyUnifiedBusiness, classifyUnifiedMatches } from '../src/unifiedExcelParser.js';
import { classifyScanTerminal } from '../src/scanTerminal.js';
import { destinationFromNodeText, ROUTING_DESTINATIONS } from '../src/routingDestinationV48.js';
import { reconcileCoreScanOnlyState } from '../src/pipelineV137.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const syntax=p=>{const r=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(r.status,0,`${p}: ${r.stderr||r.stdout}`);};
const typeOf=(bill,recipient='',customer='',sender='')=>classifyUnifiedBusiness(bill,recipient,customer,sender)?.businessType||'';

test('V137 runtime files are syntax valid',()=>{
  for(const file of [
    'src/unifiedExcelParser.js','src/v102UnifiedImportSafetyGatePatch.js','src/scanTerminal.js','src/v86StrictTrackStatusGate.js','src/analyzerFinal.js','src/pipelineV137.js',
    'src/routingDestinationV48.js','src/specialNode.js','src/unifiedImportStoreV137.js','src/carryoverRefreshScheduler.js','src/v136CcslForegroundDailyPatch.js','src/v136ShopeeForegroundDailyPatch.js',
    'src/rangeDashboardStoreV136TerminalOverlay.js','src/v108PerformanceIndexPatch.js','src/v108PerformanceIndexWorker.js',
    'src/v137TrendTruthPatch.js','public/v137-range-trends.js','src/v44WhppUiPatch.js','bootstrap.js'
  ])syntax(file);
});

test('seven-business classification uses recipient sender customer and prefix with conflict blocking evidence',()=>{
  assert.equal(typeOf('CC137001','SHOPEEVN','',''),'SHOPEEVN');
  assert.equal(typeOf('CC137002','','','SHOPEEVN'),'SHOPEEVN');
  assert.equal(typeOf('CC137003','','','SHOPEECN'),'SHOPEECN');
  assert.equal(typeOf('CC137004','','','CCAF'),'CEAF');
  assert.equal(typeOf('CC137005','','','ALI1688'),'ALI1688');
  assert.equal(typeOf('CC137006','','','TBKH'),'TBKH');
  assert.equal(typeOf('CC137007','','','WHPP'),'WHPP');
  assert.equal(typeOf('CC137008'),'CE');
  assert.equal(typeOf('CE137009'),'WHPP');
  assert.deepEqual(classifyUnifiedMatches('CC137010','SHOPEEVN','','SHOPEECN'),['SHOPEEVN','SHOPEECN']);
  const safety=read('src/v102UnifiedImportSafetyGatePatch.js');
  assert.match(safety,/CLASSIFICATION_CONFLICT_BLOCKED/);
  assert.match(safety,/columns\.sender/);
  assert.match(safety,/classifyUnifiedBusiness\(bill, recipient, customerName, sender\)/);
});

test('scan first gate closes cancellation POD and return and sends only 50 60 70 to trajectory',()=>{
  for(const status of ['50','60','70'])assert.equal(classifyScanTerminal({shipmentCode:`A${status}`,orderStatus:status}).trackRequired,true);
  const expected=[['10','ORDER_CANCELLED'],['85','POD'],['100','RETURN_COMPLETED']];
  for(const [status,state] of expected){const r=classifyScanTerminal({shipmentCode:`A${status}`,orderStatus:status});assert.equal(r.currentState,state);assert.equal(r.trackRequired,false);}
  const unknown=classifyScanTerminal({shipmentCode:'A99',orderStatus:'99'});assert.equal(unknown.currentState,'SCAN_STATUS_HOLD');assert.equal(unknown.trackRequired,false);
  const gate=read('src/v86StrictTrackStatusGate.js');
  assert.match(gate,/OPEN_TRACK_STATUSES = new Set\(\['50', '60', '70'\]\)/);
  assert.match(gate,/GLOBAL_TERMINAL_STATUSES = new Set\(\['10', '85', '100'\]\)/);
  assert.match(gate,/originalTrackQuery\.call\(this, allowed\)/);
  assert.match(gate,/originalShipmentTrack\.call\(this, allowed\)/);
  assert.match(gate,/originalExceptionQuery\.call\(this, allowed\)/);
  assert.doesNotMatch(gate,/evidence\.businessType === 'WHPP'/);
});

test('core scan-only cancellation and unknown statuses remain in final state without false trajectory anomalies',()=>{
  const state={reportDate:'2026-08-15',businessType:'CCSL',dailyParseRows:[
    {shipmentCode:'CC-CANCEL',businessType:'CE',recipientRaw:'A'},
    {shipmentCode:'CC-HOLD',businessType:'TBKH',recipientRaw:'B'}
  ],scanResults:[
    {运单号:'CC-CANCEL',orderStatus:'10',currentState:'ORDER_CANCELLED',scanNormalizedState:'ORDER_CANCELLED',trackRequired:false},
    {运单号:'CC-HOLD',orderStatus:'99',currentState:'SCAN_STATUS_HOLD',scanNormalizedState:'SCAN_STATUS_HOLD',trackRequired:false}
  ],finalRows:[],carryBills:[],nextCarryBills:[],lastRunSummary:{}};
  reconcileCoreScanOnlyState(state);
  const cancel=state.finalRows.find(row=>row.运单号==='CC-CANCEL');
  const hold=state.finalRows.find(row=>row.运单号==='CC-HOLD');
  assert.equal(cancel.currentState,'ORDER_CANCELLED');
  assert.equal(cancel.primaryCategory,'订单取消');
  assert.equal(cancel.trackRequired,false);
  assert.equal(cancel.carry状态,'closed_cancelled');
  assert.equal(hold.currentState,'SCAN_STATUS_HOLD');
  assert.equal(hold.primaryCategory,'扫描状态待识别');
  assert.equal(hold.trackRequired,false);
  assert.equal(hold.Pending次数,0);
  assert.equal(hold.OC天数,0);
  assert.ok(state.nextCarryBills.includes('CC-HOLD'));
  assert.ok(!state.nextCarryBills.includes('CC-CANCEL'));
});

test('final trajectory routing recognizes CECN CEZT and all 580 aliases from final node only',()=>{
  assert.equal(destinationFromNodeText('CEL:CECN'),ROUTING_DESTINATIONS.CCSLCN);
  assert.equal(destinationFromNodeText('CE:CCSLCN'),ROUTING_DESTINATIONS.CCSLCN);
  assert.equal(destinationFromNodeText('CEL:CEZT'),ROUTING_DESTINATIONS.CCSLZT);
  assert.equal(destinationFromNodeText('CE:CCSLZT'),ROUTING_DESTINATIONS.CCSLZT);
  for(const node of ['CE:580','CEL:580','CE:CCSL580','CEL:CCSL580','CE580','CCSL580'])assert.equal(destinationFromNodeText(node),ROUTING_DESTINATIONS.CCSL580,node);
  const route=read('src/routingDestinationV48.js');
  const special=read('src/specialNode.js');
  assert.match(route,/FINAL-NODE ONLY/);
  assert.match(route,/last routing token is the target/);
  assert.match(special,/\['CE580', \{ state: 'CCSL580_RETENTION'/);
});

test('special normal destinations are closed in current and carry persistence in foreground and background paths',()=>{
  const store=read('src/unifiedImportStoreV137.js');
  const ccsl=read('src/v136CcslForegroundDailyPatch.js');
  const shopee=read('src/v136ShopeeForegroundDailyPatch.js');
  const carry=read('src/carryoverRefreshScheduler.js');
  for(const marker of ['SELF_PICKUP','CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION'])assert.match(store,new RegExp(marker));
  assert.match(store,/status='CLOSED'/);
  assert.match(store,/CLOSE_SPECIAL_NORMAL/);
  assert.match(ccsl,/unifiedImportStoreV137\.js/);
  assert.match(shopee,/unifiedImportStoreV137\.js/);
  assert.match(carry,/unifiedImportStoreV137\.js/);
  assert.match(carry,/pipelineV137\.js/);
});

test('selected-range terminal overlay is scoped to selected bills instead of scanning whole database',()=>{
  const source=read('src/rangeDashboardStoreV136TerminalOverlay.js');
  assert.match(source,/collectRangeBills\(range\)/);
  assert.match(source,/LOOKUP_CHUNK=350/);
  assert.match(source,/shipmentCode IN \(\$\{placeholders\}\)/);
  assert.match(source,/terminalLookupBills:bills\.length/);
  assert.doesNotMatch(source,/FROM shipment_current_state c LEFT JOIN carryover_open_items o/);
  assert.doesNotMatch(source,/FROM final_rows ORDER BY updatedAt/);
});

test('range lookup indexes are connected after first paint without startup full-scan maintenance',()=>{
  const worker=read('src/v108PerformanceIndexWorker.js');
  const bootstrap=read('bootstrap.js');
  const patch=read('src/v108PerformanceIndexPatch.js');
  for(const name of ['idx_v137_current_bill','idx_v137_carry_bill_status','idx_v137_final_bill_updated','idx_v137_business_final_bill_updated'])assert.match(worker,new RegExp(name));
  assert.match(bootstrap,/v108PerformanceIndexPatch/);
  assert.match(patch,/setTimeout/);
  assert.match(patch,/unref/);
});

test('all seven dashboards and home use V137 truthful selected-range trends including WHPP',()=>{
  const backend=read('src/v137TrendTruthPatch.js');
  const frontend=read('public/v137-range-trends.js');
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(backend,/WHPP/);
  assert.match(backend,/TOTAL/);
  assert.match(backend,/\/api\/v137\/trends/);
  assert.match(backend,/FULL_SELECTED_VALID_DAYS/);
  assert.match(backend,/LAST_7_VALID_DAYS/);
  assert.match(backend,/ORDER_CANCELLED/);
  assert.match(frontend,/\['\/whpp','WHPP'\]/);
  assert.match(frontend,/今日票数趋势/);
  assert.match(frontend,/POD率趋势/);
  assert.match(frontend,/OC率趋势/);
  assert.match(frontend,/首次妥投率趋势/);
  assert.match(frontend,/RateTrendCardV18\.render/);
  assert.match(frontend,/本期 \$\{n\} 个有效日报日/);
  assert.match(injector,/import '\.\/v137TrendTruthPatch\.js'/);
  assert.match(injector,/v137-range-trends\.js\?v=20260815-1/);
  assert.ok(injector.indexOf('v56-trend-truth.js')<injector.indexOf('v137-range-trends.js'));
});

test('current-day V136 split remains connected while V137 adds read correctness',()=>{
  const injector=read('src/v44WhppUiPatch.js');
  for(const module of ['v136CcslForegroundDailyPatch','v136ShopeeForegroundDailyPatch','v136WhppForegroundDailyPatch'])assert.match(injector,new RegExp(module));
  assert.match(injector,/v137-system-truth-v25/);
  assert.match(read('src/v136CcslForegroundDailyPatch.js'),/pipelineV137\.js/);
});
