import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dueCarryRefreshReason, loadOpenCarryRows } from '../src/carryoverRefreshScheduler.js';
import { ensureV246TrackingSchema } from '../src/v246TrackingLedgerCore.js';
import { repairV294CarryoverLifecycle } from '../src/v294CarryoverLifecycleTruth.js';

const db=new DatabaseSync(':memory:');
try{
  db.exec(`
    CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT,updatedAt TEXT);
    CREATE TABLE carryover_open_items(
      shipmentCode TEXT PRIMARY KEY,businessType TEXT,sourceReportDate TEXT,lastReportDate TEXT,status TEXT,apiStatus TEXT,closeReason TEXT,stateJson TEXT,updatedAt TEXT
    );
    CREATE TABLE shipment_current_state(
      shipmentCode TEXT PRIMARY KEY,businessType TEXT,reportDate TEXT,snapshotId TEXT,state TEXT,apiStatus TEXT,lastEventTime TEXT,stateJson TEXT,updatedAt TEXT
    );
  `);
  ensureV246TrackingSchema(db);

  db.prepare(`INSERT INTO carryover_open_items VALUES('TBKH-OPEN','TBKH','2026-08-24','2026-08-24','OPEN','SUCCESS','','{}','2026-08-24T12:00:00Z')`).run();
  db.prepare(`INSERT INTO carryover_open_items VALUES('SPE-CLOSED','SHOPEECN','2026-08-24','2026-08-24','CLOSED','SUCCESS','POD','{}','2026-08-24T12:00:00Z')`).run();
  const open=loadOpenCarryRows(db);
  assert.deepEqual(open.map(row=>row.shipmentCode),['TBKH-OPEN'],'only OPEN carry is eligible for next-day automatic refresh');

  const rolloverDate=new Date('2026-08-25T00:05:00+07:00');
  assert.equal(dueCarryRefreshReason(db,rolloverDate),'CAMBODIA_DAY_ROLLOVER_0005','new Cambodia date must trigger rollover refresh even without new daily upload');
  const meta=db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`);
  meta.run('carry_refresh_last_rollover_date','2026-08-25','x');
  meta.run('carry_refresh_last_success_at','2026-08-24T18:00:00.000Z','x');
  assert.equal(dueCarryRefreshReason(db,new Date('2026-08-25T03:05:00+07:00')),'TWO_HOUR_OPEN_REFRESH','OPEN carry must be eligible again after two hours');

  const falseReturn={currentState:'RETURN_IN_PROGRESS',退回状态:'退回处理中',primaryCategory:'退回处理中',latestTrackStatusCode:'84'};
  db.prepare(`INSERT INTO carryover_open_items VALUES('SPE-RETURNING','SHOPEECN','2026-08-24','2026-08-25','CLOSED','SUCCESS','RETURNED',?,'x')`).run(JSON.stringify(falseReturn));
  db.prepare(`INSERT INTO shipment_current_state VALUES('SPE-RETURNING','SHOPEECN','2026-08-25','S','RETURNED','SUCCESS','',?,'x')`).run(JSON.stringify(falseReturn));
  db.prepare(`INSERT INTO qc_tracking_ledger(shipmentCode,businessType,firstReportDate,lastImportedDate,trackingStatus,terminalReason,currentState,currentCategory,lastCheckedAt,createdAt,updatedAt)
    VALUES('SPE-RETURNING','SHOPEECN','2026-08-24','2026-08-25','TERMINAL','RETURNED','RETURNED','退回处理中','x','x','x')`).run();

  const exactReturn={currentState:'RETURN_COMPLETED',退回状态:'已退回',primaryCategory:'退回',latestTrackStatusCode:'86'};
  db.prepare(`INSERT INTO carryover_open_items VALUES('SPE-RETURNED','SHOPEEVN','2026-08-24','2026-08-25','CLOSED','SUCCESS','RETURNED',?,'x')`).run(JSON.stringify(exactReturn));
  db.prepare(`INSERT INTO shipment_current_state VALUES('SPE-RETURNED','SHOPEEVN','2026-08-25','S','RETURNED','SUCCESS','',?,'x')`).run(JSON.stringify(exactReturn));
  db.prepare(`INSERT INTO qc_tracking_ledger(shipmentCode,businessType,firstReportDate,lastImportedDate,trackingStatus,terminalReason,currentState,currentCategory,lastCheckedAt,createdAt,updatedAt)
    VALUES('SPE-RETURNED','SHOPEEVN','2026-08-24','2026-08-25','TERMINAL','RETURNED','RETURNED','退回','x','x','x')`).run();

  const normalTransit={currentState:'NORMAL_FINAL',primaryCategory:'正常分流节点',latestTrackStatusCode:'72',latestEventDesc:'到达正常中转节点'};
  db.prepare(`INSERT INTO carryover_open_items VALUES('CE-NORMAL-TRANSIT','CE','2026-08-24','2026-08-25','CLOSED','SUCCESS','NORMAL_FINAL',?,'x')`).run(JSON.stringify(normalTransit));
  db.prepare(`INSERT INTO shipment_current_state VALUES('CE-NORMAL-TRANSIT','CE','2026-08-25','S','NORMAL_FINAL','SUCCESS','',?,'x')`).run(JSON.stringify(normalTransit));
  db.prepare(`INSERT INTO qc_tracking_ledger(shipmentCode,businessType,firstReportDate,lastImportedDate,trackingStatus,terminalReason,currentState,currentCategory,lastCheckedAt,createdAt,updatedAt)
    VALUES('CE-NORMAL-TRANSIT','CE','2026-08-24','2026-08-25','TERMINAL','NORMAL_FINAL','NORMAL_FINAL','正常分流节点','x','x','x')`).run();

  const repaired=repairV294CarryoverLifecycle({reportDate:'2026-08-25',db,reason:'SMOKE'});
  assert.equal(repaired.reopened,2,'return-in-progress and false NORMAL_FINAL closures must both be reopened');
  assert.equal(repaired.returnInProgressReopened,1);
  assert.equal(repaired.normalTransitReopened,1);
  assert.equal(db.prepare(`SELECT status FROM carryover_open_items WHERE shipmentCode='SPE-RETURNING'`).get().status,'OPEN');
  assert.equal(db.prepare(`SELECT state FROM shipment_current_state WHERE shipmentCode='SPE-RETURNING'`).get().state,'RETURN_IN_PROGRESS');
  assert.equal(db.prepare(`SELECT trackingStatus FROM qc_tracking_ledger WHERE shipmentCode='SPE-RETURNING'`).get().trackingStatus,'OPEN');
  assert.equal(db.prepare(`SELECT terminalReason FROM qc_tracking_ledger WHERE shipmentCode='SPE-RETURNING'`).get().terminalReason,'');
  assert.equal(db.prepare(`SELECT status FROM carryover_open_items WHERE shipmentCode='SPE-RETURNED'`).get().status,'CLOSED','real code86/completed return must stay terminal');
  assert.equal(db.prepare(`SELECT status FROM carryover_open_items WHERE shipmentCode='CE-NORMAL-TRANSIT'`).get().status,'OPEN','normal routing/transit must continue next-day tracking');
  assert.equal(db.prepare(`SELECT state FROM shipment_current_state WHERE shipmentCode='CE-NORMAL-TRANSIT'`).get().state,'OPEN');
  assert.equal(db.prepare(`SELECT trackingStatus FROM qc_tracking_ledger WHERE shipmentCode='CE-NORMAL-TRANSIT'`).get().trackingStatus,'OPEN');

  const activation=fs.readFileSync(new URL('../src/v294CarryoverSchedulerActivation.js',import.meta.url),'utf8');
  const v147=fs.readFileSync(new URL('../src/v147TrackTimeoutConfig.js',import.meta.url),'utf8');
  const importStore=fs.readFileSync(new URL('../src/unifiedImportStore.js',import.meta.url),'utf8');
  const scheduler=fs.readFileSync(new URL('../src/carryoverRefreshScheduler.js',import.meta.url),'utf8');
  const businessStore=fs.readFileSync(new URL('../src/businessStore.js',import.meta.url),'utf8');
  const whppStore=fs.readFileSync(new URL('../src/whppStore.js',import.meta.url),'utf8');
  assert.match(activation,/startCarryoverRefreshScheduler\(\)/,'formal listen patch must actually start carry scheduler');
  assert.match(activation,/server\.once\('listening', activate\)/,'scheduler must not begin until the HTTP server is actually listening');
  assert.match(v147,/v294CarryoverSchedulerActivation\.js/,'startup chain must install carry scheduler activation before server routes run');
  assert.match(importStore,/HISTORICAL_CARRY/,'next daily processing queue must retain prior OPEN shipments as historical carry');
  assert.match(importStore,/FROM carryover_open_items c WHERE c\.status='OPEN'/,'processing queue must source unresolved carry independently of whether the shipment appears in next-day Excel');
  assert.match(scheduler,/V294_KEEP_OPEN_NORMAL_TRANSIT/,'automatic carry refresh must normalize normal routing nodes so legacy NORMAL_FINAL closure cannot remove it from tracking');
  assert.match(scheduler,/KEEP_OPEN_NORMAL_TRANSIT_UNTIL_TRUE_TERMINAL/);
  assert.match(businessStore,/SELECT rawJson FROM business_carry_bills WHERE businessType=\? AND status='active' ORDER BY updatedAt DESC/,'SHOPEE state hydration must read only indexed active carry, never months of closed carry history');
  assert.doesNotMatch(businessStore,/SELECT rawJson FROM business_carry_bills WHERE businessType=\? ORDER BY updatedAt DESC/,'unbounded SHOPEE carry-history hydration must stay retired');
  assert.match(whppStore,/JOIN shipment_current_state s ON s\.shipmentCode=d\.shipmentCode/,'WHPP import POD locks must be resolved from current daily membership');
  assert.doesNotMatch(whppStore,/SELECT shipmentCode FROM shipment_current_state WHERE businessType='WHPP' AND state='POD'/,'WHPP import must never full-scan all historical POD shipment state');

  console.log('[V294] carryover next-day smoke passed · OPEN survives next day · daily import hydration is bounded to active/current membership · 00:05 + 2h scheduler remains intact');
}finally{db.close();}

await import('./v294-final-qc-contract-smoke.mjs');
