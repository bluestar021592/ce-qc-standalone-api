import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { normalizeV485TrackRows } from '../src/v485StrictTrackEvidence.js';
import { analyzeV246ShopeeAttemptCycle, findV246PodDate, v246PositivePodText, V486_STRICT_TRACK_SEMANTIC_ID } from '../src/shopeeAttemptCycleV246.js';

for(const file of ['src/shopeeAttemptCycleV246.js','src/v485StrictTrackEvidence.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});

const nestedTextOnly=[{
  shipmentCode:'TBKH-V486-001',
  events:[
    {eventTime:'2026-07-01 08:30:00',trackingEventDescZh:'派件分配'},
    {eventTime:'2026-07-01 09:00:00',trackingEventDesc:'Parcel start to deliver'},
    {eventTime:'2026-07-01 18:00:00',trackingEventDescZh:'Pending 客户无人接听'},
    {eventTime:'2026-07-02 08:10:00',trackingEventDescZh:'正在为您派送'},
    {eventTime:'2026-07-02 15:30:00',trackingEventDesc:'Delivered to recipient'}
  ]
}];
const normalized=normalizeV485TrackRows(nestedTextOnly);
assert.equal(normalized.length,5,'V485 nested normalizer must preserve all text-only track events');
const strict=analyzeV246ShopeeAttemptCycle(normalized);
assert.equal(strict.attemptNo,2,'canonical delivery text → failure → canonical delivery text must resolve to attempt 2');
assert.equal(strict.podDate,'2026-07-02','generic delivered text must resolve the real POD date after negative guard');
assert.equal(strict.startMode,'TRACK_DELIVERY_TEXT');
assert.equal(strict.startSemanticVersion,V486_STRICT_TRACK_SEMANTIC_ID);
assert.equal(strict.starts.length,2);
assert.equal(strict.failures.length,1);

const assignOnly=analyzeV246ShopeeAttemptCycle([
  {eventTime:'2026-07-03 08:00:00',trackingEventDesc:'Assigning courier'},
  {eventTime:'2026-07-03 17:00:00',trackingEventDesc:'delivery failed recipient unavailable'},
  {eventTime:'2026-07-04 08:00:00',trackingEventDescZh:'即将为您派送'},
  {eventTime:'2026-07-04 16:00:00',trackingEventDescZh:'签收'}
]);
assert.equal(assignOnly.attemptNo,2,'canonical assigning-courier text is allowed only as the no-delivery-START fallback');
assert.equal(assignOnly.startMode,'TRACK_ASSIGN_TEXT_FALLBACK');
assert.equal(assignOnly.podDate,'2026-07-04');

const failureMustNotStart=analyzeV246ShopeeAttemptCycle([
  {eventTime:'2026-07-05 10:00:00',trackingEventDescZh:'派送中异常 Pending 客户无人接听'},
  {eventTime:'2026-07-05 18:00:00',trackingEventDesc:'NOT DELIVERED'}
]);
assert.equal(failureMustNotStart.attemptNo,0,'Pending/delivery-failure text must never be promoted to a semantic START');
assert.equal(failureMustNotStart.podDate,'','negative delivered text must never become POD');
assert.equal(v246PositivePodText('NOT DELIVERED'),false);
assert.equal(v246PositivePodText('Delivered to recipient'),true);
assert.equal(v246PositivePodText('签收'),true);

const numericCompat=analyzeV246ShopeeAttemptCycle([
  {eventCode:'70',eventTime:'2026-07-06 08:00:00'},
  {eventCode:'150',eventTime:'2026-07-06 18:00:00'},
  {eventCode:'70',eventTime:'2026-07-07 08:00:00'},
  {eventCode:'80',eventTime:'2026-07-07 12:00:00'}
]);
assert.equal(numericCompat.attemptNo,2,'existing numeric 70/150/70 behavior must remain unchanged');
assert.equal(numericCompat.startMode,'TRACK_70');
assert.equal(findV246PodDate([{eventTime:'2026-07-08 12:00:00',trackingEventDesc:'signed off'}]),'2026-07-08');

console.log('[V486] strict CE track semantic smoke passed · canonical delivery/assign text becomes real START only when non-failure · numeric 70/60 compatibility preserved · delivered/签收 POD aliases are negative-safe');
