import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { analyzeShopeeShipment } from '../src/shopeeAnalyzer.js';
import { analyzeShipment } from '../src/analyzer.js';
import './v241-readonly-canonical-audit.test.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const shopeeBase = {
  waybill:'V239-SHOP-1', reportDate:'2026-08-01', analysisDate:'2026-08-05',
  dailyRow:{recipient_group:'VN'}, scanRow:{shipmentCode:'V239-SHOP-1',orderStatus:70},
  apiStatus:{shipment:'success',event:'success',exception:'success'}
};

test('V239 current Pending counts only the active code150 episode after latest progress',()=>{
  const row=analyzeShopeeShipment({...shopeeBase,events:[
    {eventCode:'150',eventTime:'2026-08-01 09:00:00',trackingEventDescZh:'Pending'},
    {eventCode:'70',eventTime:'2026-08-02 09:00:00',trackingEventDescZh:'派送中'},
    {eventCode:'150',eventTime:'2026-08-04 09:00:00',trackingEventDescZh:'Pending'},
    {eventCode:'150',eventTime:'2026-08-04 12:00:00',trackingEventDescZh:'Pending duplicate'}
  ]});
  assert.equal(row.currentState,'PENDING');
  assert.equal(row.Pending当前次数,1);
  assert.equal(row.Pending日期,'2026-08-04');
  assert.equal(row.Pending不连续,'否');
  assert.equal(row.primaryCategory,'Pending1次');
});

test('V239 special normal destinations close ordinary carry while WHPP remains a separate active responsibility',()=>{
  for(const place of ['CE:CECN','CEL:CEZT','CE:580']){
    const row=analyzeShopeeShipment({...shopeeBase,events:[{eventTime:'2026-08-05 10:00:00',place}]});
    assert.equal(row.跨日状态,'已闭环',place);
    assert.equal(row.carry状态,'closed_normal',place);
    assert.equal(row.trackRequired,false,place);
    assert.equal(row.Pending当前次数,0,place);
    assert.equal(row.OC天数,0,place);
  }
  const whpp=analyzeShopeeShipment({...shopeeBase,events:[{eventCode:'50',eventTime:'2026-08-05 10:00:00',trackingEventDescZh:'货物到达网点【CE:WHPP】'}]});
  assert.equal(whpp.WHPP滞留,'是');
  assert.notEqual(whpp.carry状态,'closed_normal');
});

test('V239 real Shopee attempt requires fail then new START; repeated START alone stays attempt 1',()=>{
  const repeated=analyzeShopeeShipment({...shopeeBase,events:[
    {eventCode:'70',eventTime:'2026-08-02 08:00:00',trackingEventDescZh:'派送中'},
    {eventCode:'70',eventTime:'2026-08-03 08:00:00',trackingEventDescZh:'派送中'}
  ]});
  assert.equal(repeated.currentAttemptNo,1);
  const second=analyzeShopeeShipment({...shopeeBase,events:[
    {eventCode:'70',eventTime:'2026-08-02 08:00:00',trackingEventDescZh:'派送中'},
    {eventCode:'150',eventTime:'2026-08-02 18:00:00',trackingEventDescZh:'Pending'},
    {eventCode:'70',eventTime:'2026-08-03 08:00:00',trackingEventDescZh:'派送中'}
  ]});
  assert.equal(second.currentAttemptNo,2);
});

test('V239 range/history Shopee truth uses V202 real cycle, never distinct delivery dates or elapsed days',()=>{
  const facade=read('src/rangeDashboardStore.js');
  const v191=read('src/rangeDashboardStoreV191.js');
  const truth=read('src/v191ShopeeTruth.js');
  assert.match(facade,/rangeDashboardStoreV191\.js/);
  assert.match(v191,/rangeDashboardStoreV55Compact\.js/);
  assert.match(truth,/resolveV202AttemptCycle/);
  assert.match(truth,/TRACK_REAL_DELIVERY_CYCLE/);
  assert.doesNotMatch(truth,/deliveryDates\.size/);
  assert.doesNotMatch(truth,/julianday/);
});

test('V239 code26 remains pickup success, while real CCSL inbound-no-scan requires inbound-node evidence',()=>{
  const general=analyzeShipment({waybill:'V239-CE-26',scanRow:{shipmentCode:'V239-CE-26',orderStatus:70},events:[{eventCode:'26',eventTime:'2026-08-05 09:00:00'}],reportDate:'2026-08-05'});
  assert.equal(general.currentState,'PICKUP_SUCCESS');
  assert.equal(general.入库无扫描节点,'否');
  const shopee=analyzeShopeeShipment({...shopeeBase,events:[{eventCode:'26',eventTime:'2026-08-05 09:00:00'}]});
  assert.equal(shopee.currentState,'PICKUP_SUCCESS');
  assert.equal(shopee.入库无扫描节点,'否');
});

test('V239 export contract is seven businesses, one complete workbook each, V193 resumable UI',()=>{
  const job=read('src/v84ExportJobWorker.js');
  const child=read('src/v84ExportBusinessWorker.js');
  const ui=read('public/v84-async-export-ui.js');
  assert.match(job,/ALL_TYPES=Object\.freeze\(\['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'\]\)/);
  assert.match(job,/ONE_WORKBOOK_PER_BUSINESS/);
  assert.doesNotMatch(job,/splitRange\(/);
  assert.match(child,/createV200ReferenceDashboardWorkbook/);
  assert.match(child,/partCount>1\|\|partIndex!==1/);
  assert.match(ui,/ce_qc_active_export_job_v193/);
  assert.match(ui,/resumeActiveJob/);
});

test('V239 bootstrap contract compares patches with the real interactive server-start call',()=>{
  const bootstrap=read('bootstrap.js');
  const start=bootstrap.indexOf('await importServerInteractiveFirst()');
  assert.ok(start>0);
  for(const token of ['v27ServerPatch','v28ResumeGuardPatch','v55DashboardReconciliationPatch','v90FastDashboardReadPatch','v94ShopeeWhppSourceTruthPatch','v92WhppTerminalAuthority']){
    assert.ok(bootstrap.indexOf(token)>=0&&bootstrap.indexOf(token)<start,`${token} must load before actual server start`);
  }
});
