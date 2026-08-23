import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
const {normalizeV262TrackPayload,v262ShouldRetryStrictRow,V262_SHOPEE_STRICT_EVIDENCE_ID}=await import('../src/v262ShopeeStrictEvidenceBackfill.js');

const nested=[{
  shipmentCode:'SPE-CN-001',
  data:{events:[
    {eventCode:'70',eventTime:'2026-08-21 09:00:00',trackingEventDescZh:'开始派送'},
    {eventCode:'150',eventTime:'2026-08-21 18:00:00',trackingEventDescZh:'Pending'},
    {eventCode:'70',eventTime:'2026-08-22 09:00:00',trackingEventDescZh:'再次开始派送'},
    {eventCode:'80',eventTime:'2026-08-22 16:00:00',trackingEventDescZh:'POD'}
  ]}
}];
const events=normalizeV262TrackPayload(nested);
assert.equal(events.length,4,'nested CE event wrapper must be flattened into individual trajectory events');
assert.ok(events.every(row=>row.shipmentCode==='SPE-CN-001'),'wrapper shipmentCode must be inherited by every nested event');
assert.equal(events[0].eventCode,'70');
assert.equal(events[3].eventCode,'80');
assert.equal(v262ShouldRetryStrictRow({terminalReason:'POD',businessType:'SHOPEECN',attemptNo:0}),true,'unknown POD attempt must remain eligible for future strict backfill');
assert.equal(v262ShouldRetryStrictRow({terminalReason:'POD',businessType:'SHOPEEVN',attemptNo:0,attemptSource:'V246_STRICT_TRACK:无真实派次START证据'}),true,'previous strict-unknown result must be retried instead of permanently excluded');
assert.equal(v262ShouldRetryStrictRow({terminalReason:'POD',businessType:'SHOPEECN',attemptNo:1}),false,'known strict attempt must stay locked');
assert.equal(v262ShouldRetryStrictRow({terminalReason:'RETURNED',businessType:'SHOPEECN',attemptNo:0}),false,'non-POD terminal must not enter attempt backfill');
assert.match(V262_SHOPEE_STRICT_EVIDENCE_ID,/v262-shopee-unknown-attempt-retry/);
console.log('[V262] strict evidence smoke passed: nested CE trajectory normalization + retry unknown POD + preserve known attempts');
