import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {v788IsCurrentSpecialNonDelivery as special,v788ResolveCarryCurrentState as resolveState} from '../src/v788SpecialOpenTruth.js';
const terminal=['CCSL580_RETENTION','CCSL580_DIVERSION','CCSLZT_DIVERSION',
  'CCSLCN_DIVERSION','SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION'];
for(const currentState of terminal){
  assert.equal(special({currentState}),true,currentState+' excludes from unfinished delivery');
  assert.equal(special({currentState:'PENDING',specialState:currentState}),false,'new Pending overrides stale '+currentState);
  assert.equal(special({currentState:'OC',specialState:currentState}),false,'new OC overrides stale '+currentState);
  assert.equal(special({currentState:'DELIVERING',specialState:currentState}),false,'new delivering overrides stale '+currentState);
  assert.equal(special({currentState,shipmentStatus:'80'}),false,'real returning 80 remains OPEN '+currentState);
}
assert.equal(special({specialState:'CE:CCSL580'}),true,'legacy 580 alias');
assert.equal(special({currentState:'OTHER_NORMAL',specialState:'CCSLZT_DIVERSION'}),true);
assert.equal(special({currentState:'RETURN_IN_PROGRESS'}),false);
assert.equal(special({currentState:'PENDING'}),false);
assert.equal(special({currentState:'POD'}),false);
assert.equal(special({currentState:'SHOP_OC'}),false);
const savedSpecial=resolveState('OPEN','CCSL580_RETENTION','');
assert.equal(savedSpecial,'CCSL580_RETENTION','generic ledger OPEN cannot shadow a specific persisted 580 state');
assert.equal(special({currentState:savedSpecial,specialState:'CCSL580_RETENTION'}),true);
assert.equal(resolveState('OPEN','CCSLZT_DIVERSION',''),'CCSLZT_DIVERSION');
assert.equal(resolveState('PENDING','CCSL580_RETENTION',''),'PENDING','newer ledger Pending wins');
assert.equal(resolveState('OC','CCSLZT_DIVERSION',''),'OC','newer ledger OC wins');
assert.equal(resolveState('RETURN_IN_PROGRESS','CCSL580_RETENTION',''),'RETURN_IN_PROGRESS');
assert.equal(resolveState('PENDING_VERIFICATION','CCSL580_RETENTION',''),'PENDING_VERIFICATION','uncertain ledger review must not be concealed');
assert.equal(resolveState('OPEN','OPEN','CECN_RETENTION'),'CECN_RETENTION','scan state is specific when both saved/ledger are generic');
assert.equal(resolveState('OPEN','OPEN','OPEN'),'OPEN','generic source stays open without fabricated special evidence');
const server=fs.readFileSync('server.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const start=server.indexOf('function workspaceRows('),end=server.indexOf('function persistReconciliationDiagnostics(',start);
assert.ok(start>0&&end>start,'actual server workspace builder found');
const convert=new Function('billOfWorkspace','workspacePendingNonContinuous','workspaceStoreArrived','workspaceOcDays','v788IsCurrentSpecialNonDelivery',
  server.slice(start,end)+'\nreturn workspaceRows;')(
    row=>String(row.shipmentCode||'').trim().toUpperCase(),()=>false,()=>false,()=>0,special
  );
const row=(code,other={})=>({shipmentCode:code,businessType:'CE',reportDate:'2026-07-02',...other});
const classified=convert({businessType:'CE',reportDate:'2026-07-02',finalRows:[
  row('CC0001',{currentState:'CCSL580_RETENTION',specialState:'CCSL580_RETENTION'}),
  row('CC0002',{currentState:'CCSLZT_DIVERSION',specialState:'CCSLZT_DIVERSION'}),
  row('CC0003',{currentState:'PENDING',specialState:'CCSL580_RETENTION'}),
  row('CC0004',{currentState:'CCSL580_RETENTION',shipmentStatus:'80'}),
  row('CC0005',{currentState:'OC',specialState:'CCSLZT_DIVERSION'}),
  row('CC0006',{specialState:'CE:CCSL580'})
]});
assert.equal(classified.length,6,'membership is immutable');
assert.deepEqual(classified.filter(r=>r.isClosed).map(r=>r.shipmentCode),['CC0001','CC0002','CC0006']);
assert.deepEqual(classified.filter(r=>!r.isClosed).map(r=>r.shipmentCode),['CC0003','CC0004','CC0005']);
assert.ok(classified.find(r=>r.shipmentCode==='CC0002').queryStatus==='特殊节点跳过');
assert.match(server,/historicalCarryRows\.push\(\{[\s\S]*?isClosed:specialExcluded,isActionable:!specialExcluded/,'history OPEN must be read-only normalized');
assert.match(server,/v788ResolveCarryCurrentState\(row\.currentState,state\.currentState,state\.scanNormalizedState\)/,'historical OPEN must use specific saved current state without overriding newer Pending');
assert.match(server,/excludedCurrentSpecialCarry:historicalCarryRows\.filter\(row=>row\.isClosed\)\.length/,'special exclusions must be auditable');
assert.match(server,/WHERE o\.status='OPEN' AND o\.sourceReportDate</,'persistent OPEN ledger query unchanged');
assert.match(shell,/row\.sourceReportDate\|\|row\.reportDate/,'open POD must preserve its actual source date');
assert.match(shell,/&businessType='\+encodeURIComponent\(type\)/,'open POD must preserve seven-business owner');
assert.match(shell,/&reportDate='\+encodeURIComponent\(date\)/,'open POD must preserve date');
assert.match(shell,/单号\/日期\/业务待核验/,'no empty/wrong-context waybill link');
console.log('[V788 OPEN POD] PASS special 580/CEZT/CECN excluded, newer Pending/OC/return80 retained, dated historical OPEN read-only and waybill links scoped');
