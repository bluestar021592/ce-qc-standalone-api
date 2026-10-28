import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planHistoricalTmsReconcile } from '../src/v791HistoricalTmsReconcile.js';

const candidate=(bill,previous={})=>({shipmentCode:bill,businessType:'CEAF',
  sourceReportDate:'2026-07-06',stateJson:JSON.stringify({shipmentCode:bill,
  businessType:'CEAF',currentState:'PENDING_SCAN',orderStatus:'85',...previous})});
const tms=(bill,status,time='')=>({shipmentCode:bill,shipmentStatus:status,
  statusTime:time});
const selected=[candidate('CC06072602913'),candidate('CEAFRETURN1'),
  candidate('CEAFRETURN2'),candidate('CEAFMISSING1')];
const plan=planHistoricalTmsReconcile(selected,[
  tms('CC06072602913','60','2026-07-11T11:00:03'),
  tms('CEAFRETURN1','80'),tms('CEAFRETURN2','81'),
  {shipmentCode:'CEAFMISSING1',orderStatus:'85'}], '2026-10-28T03:00:00Z');
assert.equal(plan.matched,3);
assert.equal(planHistoricalTmsReconcile([candidate('CTIME')],[{shipmentCode:'CTIME',shipmentStatus:'60',creationDate:'2026-07-02'}]).updates[0]['POD时间'],undefined,
  'order creation date is not evidence of POD time');
assert.equal(plan.closedPod,1);
assert.equal(plan.returned,1);
assert.equal(plan.returnInProgress,1);
assert.equal(plan.unverified.length,1);
const pod=plan.updates.find(row=>row.shipmentCode==='CC06072602913');
assert.equal(pod.是否POD,'是');
assert.equal(pod.POD时间,'2026-07-11T11:00:03');
assert.equal(pod.terminalEvidence.source,'TMS_SHIPMENT_STATUS');
assert.equal(pod.terminalEvidence.businessType,'CEAF');
const returning=plan.updates.find(row=>row.shipmentCode==='CEAFRETURN1');
assert.equal(returning.currentState,'RETURN_IN_PROGRESS');
assert.equal(returning.退回状态,'退回处理中');
assert.equal(returning.是否POD,'否');
const ambiguous=planHistoricalTmsReconcile([candidate('A')],[tms('A','60'),tms('A','81')]);
assert.equal(ambiguous.matched,0);
assert.equal(ambiguous.conflicts.length,1);
assert.equal(planHistoricalTmsReconcile([candidate('A',{orderStatus:'85'})],
 [{shipmentCode:'A',eventCode:'80',orderStatus:'85'}]).matched,0,
 'eventCode and orderStatus cannot stand in for TMS shipmentStatus');
const conflict=planHistoricalTmsReconcile([
  {...candidate('X'),closeReason:'POD'}],[tms('X','81')]);
assert.equal(conflict.matched,0);
assert.equal(conflict.conflicts.length,1);
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
assert.match(server,/\/api\/v791\/historical-ceaf-tms-reconcile/);
assert.match(server,/\/api\/v791\/historical-ceaf-tms-context/,
  'selected-date recovery requires its own snapshot');
assert.match(server,/V791_SELECTED_DATE_SNAPSHOT_SUPERSEDED/,
  'a newer valid same-day snapshot blocks stale historical updates');
assert.match(server,/guardOpenAtOrBefore:reportDate/,
  'TMS writer must atomically reject concurrent newer dates');
assert.match(server,/V791_SELECTED_DATE_CHANGED_DURING_TMS/,
  'new valid same-day snapshot during TMS fetch must block application');
assert.match(server,/guardOpenAtOrBefore:reportDate,expectedCarryVersions/,
  'live recovery must pass member version tokens into atomic writer');


assert.match(server,/WHERE o\.status='OPEN' AND o\.businessType='CEAF'/);
assert.match(server,/o\.sourceReportDate<=\? AND o\.lastReportDate<=\?/,
  'historical repair must not rewrite newer-day ledger state');
assert.match(server,/UPPER\(TRIM\(q\.businessType\)\)=UPPER\(TRIM\(o\.businessType\)\)/);
assert.match(server,/status='VALID' LIMIT 1/);
assert.match(server,/const apply=req\.body\?\.apply===true/);
assert.match(server,/await client\.shipmentTrack\(candidates\.map\(row=>row\.shipmentCode\)\)/);
assert.match(server,/rows:plan\.updates,scanResults:plan\.scanResults/);
const ui=fs.readFileSync(new URL('../public/v625-shell.js',import.meta.url),'utf8');
assert.match(ui,/async function v791RefreshHistoricalCeaf\(reportDate,snapshotId\)/);
assert.match(ui,/\/api\/v791\/historical-ceaf-tms-context\?reportDate=/,
  'historic UI must resolve same-date snapshot rather than latest import');
assert.match(ui,/v791RefreshHistoricalCeaf\(reportDate,String\(context\.snapshotId\)\)/,
  'historic CEAF write must use selected report date context');

assert.match(ui,/ceaf=await v791RefreshHistoricalCeaf\(reportDate,String\(context\.snapshotId\)\)/,
  'CEAF must use selected-date snapshot, never latest different-day import');
assert.match(ui,/v791CeafRefreshBusy=true/);
assert.match(ui,/v791CeafRefreshBusy=false/);
assert.match(ui,/await loadOpenPod\(\)/);
assert.match(ui,/const allSourceVerified=v785OpenSourceVerified/);
assert.match(ui,/if\(!allSourceVerified\)\{/,
  'CEAF recovery remains independent but other business refresh still requires full source coverage');
console.log('[V791] historical CEAF TMS preview, exact scope and safe 60/80/81 backfill PASS');
