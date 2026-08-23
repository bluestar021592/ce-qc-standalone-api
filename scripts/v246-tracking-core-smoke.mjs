import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { classifyV246Terminal, v246InclusiveDays } from '../src/v246TrackingLedgerCore.js';
import { analyzeV246ShopeeAttemptCycle, findV246PodDate, v246PositivePodText } from '../src/shopeeAttemptCycleV246.js';

const terminal = stateJson => classifyV246Terminal({ stateJson });

for (const stateJson of [
  { currentState:'NORMAL_FINAL', latestEventDesc:'正常分流节点，未签收' },
  { currentState:'SELF_PICKUP', primaryCategory:'仓库自提' },
  { currentState:'CCSL580_RETENTION', primaryCategory:'580滞留包裹' },
  { currentState:'SHOP_ARRIVED_CURRENT', primaryCategory:'门店入库' },
  { currentState:'RETURN_IN_PROGRESS', 退回状态:'退回处理中', latestEventDesc:'正在退回' },
  { currentState:'OPEN_TRACK_REQUIRED', latestEventDesc:'未妥投，继续派送' }
]) {
  assert.equal(terminal(stateJson).terminal,false,`must stay OPEN: ${JSON.stringify(stateJson)}`);
}
assert.equal(classifyV246Terminal({closeReason:'RETURNED',stateJson:{currentState:'RETURN_IN_PROGRESS',退回状态:'退回处理中'}}).terminal,false,'legacy broad RETURNED closeReason must not close return-in-progress');
assert.equal(terminal({orderStatus:'85'}).reason,'POD');
assert.equal(terminal({latestTrackStatusCode:'80',latestEventDesc:'POD'}).reason,'POD');
assert.equal(terminal({currentState:'POD'}).reason,'POD');
assert.equal(terminal({orderStatus:'100'}).reason,'RETURNED');
assert.equal(terminal({latestTrackStatusCode:'86'}).reason,'RETURNED');
assert.equal(terminal({currentState:'RETURN_COMPLETED'}).reason,'RETURNED');
assert.equal(terminal({orderStatus:'10'}).reason,'ORDER_CANCELLED');
assert.equal(v246PositivePodText('未签收状态(70)'),false);
assert.equal(v246PositivePodText('未妥投'),false);
assert.equal(v246PositivePodText('Successfully delivered'),true);
assert.equal(v246InclusiveDays('2026-08-01','2026-08-01'),1);
assert.equal(v246InclusiveDays('2026-08-01','2026-08-03'),3,'signing days must remain first report -> POD inclusive');

const e=(code,time,desc='')=>({eventCode:String(code),eventTime:time,trackingEventDescZh:desc});
let cycle=analyzeV246ShopeeAttemptCycle([
  e(70,'2026-08-01 09:00:00','开始派送'),
  e(70,'2026-08-01 09:05:00','重复派送节点'),
  e(80,'2026-08-01 15:00:00','POD')
],{podDate:'2026-08-01'});
assert.equal(cycle.attemptNo,1,'duplicate START must stay attempt 1');

cycle=analyzeV246ShopeeAttemptCycle([
  e(70,'2026-08-01 09:00:00','开始派送'),
  e(150,'2026-08-01 18:00:00','Pending 无人接听'),
  e(70,'2026-08-02 09:00:00','再次开始派送'),
  e(80,'2026-08-02 16:00:00','POD')
],{podDate:'2026-08-02'});
assert.equal(cycle.attemptNo,2,'new START after failure/Pending must become attempt 2');

cycle=analyzeV246ShopeeAttemptCycle([
  e(70,'2026-08-01 09:00:00'),e(150,'2026-08-01 18:00:00','Pending'),
  e(70,'2026-08-02 09:00:00'),e(150,'2026-08-02 18:00:00','派送失败'),
  e(70,'2026-08-03 09:00:00'),e(80,'2026-08-03 17:00:00','已签收')
],{podDate:'2026-08-03'});
assert.equal(cycle.attemptNo,3,'two failure-separated restarts must become attempt 3+');

cycle=analyzeV246ShopeeAttemptCycle([
  e(70,'2026-08-01 09:00:00'),
  e(70,'2026-08-02 09:00:00'),
  e(80,'2026-08-02 17:00:00','已签收')
],{podDate:'2026-08-02'});
assert.equal(cycle.attemptNo,1,'different-day START without failure evidence must not fabricate attempt 2');

cycle=analyzeV246ShopeeAttemptCycle([
  e(60,'2026-08-01 08:00:00','分配快递员'),e(150,'2026-08-01 18:00:00','Pending'),e(60,'2026-08-02 08:00:00','重新分配'),e(80,'2026-08-02 17:00:00','POD')
],{podDate:'2026-08-02'});
assert.equal(cycle.attemptNo,2,'code 60 must be fallback when no code 70 exists');
assert.equal(cycle.startMode,'TRACK_60_FALLBACK');

assert.equal(findV246PodDate([e(70,'2026-08-02 10:00:00','未签收'),e(80,'2026-08-03 17:00:00','POD')]),'2026-08-03');
assert.equal(findV246PodDate([e(70,'2026-08-02 10:00:00','未签收')]),'','negative POD wording must never fabricate POD date');

console.log('[V246] tracking core smoke passed: true-terminal-only + immutable signing start + strict START/failure attempts + negative POD guards');
execFileSync(process.execPath,['scripts/v252-lifecycle-smoke.mjs'],{stdio:'inherit'});
