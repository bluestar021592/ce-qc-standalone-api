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
assert.match(server,/WHERE status='OPEN' AND businessType='CEAF'/);
assert.match(server,/status='VALID' LIMIT 1/);
assert.match(server,/const apply=req\.body\?\.apply===true/);
assert.match(server,/await client\.shipmentTrack\(candidates\.map\(row=>row\.shipmentCode\)\)/);
assert.match(server,/rows:plan\.updates,scanResults:plan\.scanResults/);
console.log('[V791] historical CEAF TMS preview, exact scope and safe 60/80/81 backfill PASS');
