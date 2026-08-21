import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-next-domain-'));
process.env.DATA_DIR=temp;
process.env.DB_FILE=path.join(temp,'pure-domain.db');
const { classifyScanTerminal }=await import('../../src/scanTerminal.js');
const { analyzeShipment }=await import('../../src/analyzer.js');
const { analyzeShopeeShipment }=await import('../../src/shopeeAnalyzer.js');
const { closeDb }=await import('../../src/db.js');

const ev=(code,time,text='',extra={})=>({eventCode:String(code??''),eventTime:time,trackingEventDesc:text,trackingEventDescZh:text,...extra});

test('QC Next scan contract: 85 POD, 100 returned, 50/60/70 require trajectory',()=>{
  assert.equal(classifyScanTerminal({shipmentCode:'A',orderStatus:'85'}).currentState,'POD');
  assert.equal(classifyScanTerminal({shipmentCode:'A',orderStatus:'85'}).trackRequired,false);
  assert.equal(classifyScanTerminal({shipmentCode:'B',orderStatus:'100'}).currentState,'RETURN_COMPLETED');
  for(const code of ['50','60','70']){const r=classifyScanTerminal({shipmentCode:'C',orderStatus:code});assert.equal(r.currentState,'OPEN_TRACK_REQUIRED');assert.equal(r.trackRequired,true);}
});

test('QC Next special destinations self-pickup, CECN, CEZT and 580 remain normal special states',()=>{
  const fixtures=[
    ['SELF',[ev('99','2026-08-21 10:00:00','Work order:仓库自提')],'SELF_PICKUP'],
    ['CECN',[ev('','2026-08-21 10:00:00','货物到达网点【CEL:CECN】',{locationCode:'CECN'})],'CCSLCN_DIVERSION'],
    ['CEZT',[ev('','2026-08-21 10:00:00','货物到达网点【CEL:CEZT】',{locationCode:'CEZT'})],'CCSLZT_DIVERSION'],
    ['M580',[ev('','2026-08-21 10:00:00','货物到达网点【CEL:CCSL580】',{locationCode:'CCSL580'})],'CCSL580_RETENTION']
  ];
  for(const [waybill,events,expected] of fixtures){const r=analyzeShipment({waybill,scanRow:{orderStatus:'70'},events,reportDate:'2026-08-21'});assert.equal(r.currentState,expected,waybill);}
});

test('QC Next Pending deduplicates repeated events on the same natural day',()=>{
  const events=[ev('150','2026-08-19 09:00:00','Pending A'),ev('150','2026-08-19 18:00:00','Pending B'),ev('32','2026-08-20 09:00:00','Cycle Count'),ev('150','2026-08-21 09:00:00','Pending C')];
  const r=analyzeShipment({waybill:'P-GAP',scanRow:{orderStatus:'70'},events,reportDate:'2026-08-21'});
  assert.equal(r.Pending次数,2);
  assert.equal(r.Pending不连续,'是');
});

test('QC Next latest trajectory event controls current state, not historical terminal evidence',()=>{
  const events=[ev('80','2026-08-20 10:00:00','POD'),ev('150','2026-08-21 10:00:00','Pending: retry')];
  const r=analyzeShipment({waybill:'LATEST',scanRow:{orderStatus:'70'},events,reportDate:'2026-08-21'});
  assert.equal(r.是否POD,'否');
  assert.equal(r.currentState,'PENDING');
});

test('QC Next Shopee attempt increments only after a failure followed by a new real START',()=>{
  const repeatedStart=[ev('70','2026-08-19 08:00:00','out for delivery'),ev('70','2026-08-19 09:00:00','out for delivery'),ev('80','2026-08-19 18:00:00','POD')];
  const first=analyzeShopeeShipment({waybill:'S1',scanRow:{orderStatus:'70'},dailyRow:{},shipmentTrackRow:{},events:repeatedStart,exceptions:[],reportDate:'2026-08-19',analysisDate:'2026-08-19'});
  assert.equal(first.podAttemptNo,1);
  const secondCycle=[ev('70','2026-08-19 08:00:00','out for delivery'),ev('150','2026-08-19 18:00:00','Pending failed'),ev('70','2026-08-20 08:00:00','out for delivery'),ev('80','2026-08-20 18:00:00','POD')];
  const second=analyzeShopeeShipment({waybill:'S2',scanRow:{orderStatus:'70'},dailyRow:{},shipmentTrackRow:{},events:secondCycle,exceptions:[],reportDate:'2026-08-20',analysisDate:'2026-08-20'});
  assert.equal(second.podAttemptNo,2);
});

test.after(()=>{closeDb();fs.rmSync(temp,{recursive:true,force:true});});
