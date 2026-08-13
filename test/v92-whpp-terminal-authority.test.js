import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeWhppShipment } from '../src/whppAnalyzer.js';
import { applyWhppTerminalAuthority, resolveWhppTerminalEvidence } from '../src/v92WhppTerminalAuthority.js';

const repairUrl=new URL('../src/v92WhppTerminalAuthority.js',import.meta.url);
const repairSource=fs.readFileSync(repairUrl,'utf8');
const bootstrap=fs.readFileSync(new URL('../bootstrap.js',import.meta.url),'utf8');

test('CE01072600002 scan85 and trajectory80 is POD closed, never unresolved',()=>{
  const row=analyzeWhppShipment({
    waybill:'CE01072600002',
    scanRow:{shipmentCode:'CE01072600002',orderStatus:'85',pickupShop:'WHPP',deliveryShop:'WHPP'},
    events:[{shipmentCode:'CE01072600002',eventCode:'80',eventTime:'2026-07-01 09:26:43',locationCode:'WHPP',eventShop:'WHPP',trackingEventDesc:'Parcel is signed-off'}],
    reportDate:'2026-07-01',analysisDate:'2026-07-01'
  });
  assert.equal(row.currentState,'POD');
  assert.equal(row.是否POD,'是');
  assert.equal(row.POD状态,'POD');
  assert.equal(row.trackRequired,false);
  assert.equal(row.trackSkippedReason,'POD_COMPLETED');
  assert.equal(row.跨日状态,'已闭环');
  assert.equal(row.carry状态,'closed_pod');
  assert.equal(row.Pending次数,0);
  assert.equal(row.OC天数,0);
  assert.equal(row.盘点天数,0);
});

test('scan terminal wins before track: 85 POD, 100 return, 10 cancel',()=>{
  assert.equal(resolveWhppTerminalEvidence({scanRow:{orderStatus:'85'},latestEvent:{eventCode:'70'}}).terminal,'POD');
  assert.equal(resolveWhppTerminalEvidence({scanRow:{orderStatus:'100'},latestEvent:{eventCode:'80'}}).terminal,'RETURNED');
  assert.equal(resolveWhppTerminalEvidence({scanRow:{orderStatus:'10'},latestEvent:{eventCode:'80'}}).terminal,'ORDER_CANCELLED');
  assert.equal(resolveWhppTerminalEvidence({scanRow:{orderStatus:'70'},latestEvent:{eventCode:'80'}}).terminal,'POD');
  assert.equal(resolveWhppTerminalEvidence({scanRow:{orderStatus:'70'},latestEvent:{eventCode:'86'}}).terminal,'RETURNED');
});

test('historical stale unresolved row is rewritten as terminal POD with all anomaly fields cleared',()=>{
  const stale={shipmentCode:'CE01072600002',currentState:'OPEN_TRACK_REQUIRED',primaryCategory:'当前未闭环',是否POD:'否',POD状态:'未POD',Pending次数:3,Pending当前次数:3,OC天数:2,盘点天数:4,跨日状态:'未闭环',carry状态:'active'};
  const fixed=applyWhppTerminalAuthority(stale,{terminal:'POD',source:'SCAN_85',observedAt:'2026-07-01 09:29:09'});
  assert.equal(fixed.currentState,'POD');
  assert.equal(fixed.是否POD,'是');
  assert.equal(fixed.primaryCategory,'POD');
  assert.equal(fixed.Pending次数,0);
  assert.equal(fixed.OC天数,0);
  assert.equal(fixed.盘点天数,0);
  assert.equal(fixed.跨日状态,'已闭环');
  assert.equal(fixed.carry状态,'closed_pod');
});

test('V92 repairs derived final/current/carry/history/snapshot layers and is loaded before server',()=>{
  const check=spawnSync(process.execPath,['--check',fileURLToPath(repairUrl)],{encoding:'utf8'});
  assert.equal(check.status,0,check.stderr||check.stdout);
  for(const token of ['business_final_rows','shipment_current_state','carryover_open_items','business_history_summary','business_export_snapshots','business_pod_locks']) assert.match(repairSource,new RegExp(token));
  assert.match(repairSource,/orderStatus=85/);
  assert.match(repairSource,/eventCode=80/);
  assert.match(bootstrap,/v92WhppTerminalAuthority/);
  assert.ok(bootstrap.indexOf('v92WhppTerminalAuthority')<bootstrap.indexOf("importPhase('server'"));
});
