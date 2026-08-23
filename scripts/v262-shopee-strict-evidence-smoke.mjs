import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
const {normalizeV262TrackPayload,v262ShouldRetryStrictRow,V262_SHOPEE_STRICT_EVIDENCE_ID,V263_DELIVERY_KPI_TYPES}=await import('../src/v262ShopeeStrictEvidenceBackfill.js');

const nested=[{
  shipmentCode:'TBKH-001',
  data:{events:[
    {eventCode:'70',eventTime:'2026-08-21 09:00:00',trackingEventDescZh:'开始派送'},
    {eventCode:'150',eventTime:'2026-08-21 18:00:00',trackingEventDescZh:'Pending'},
    {eventCode:'70',eventTime:'2026-08-22 09:00:00',trackingEventDescZh:'再次开始派送'},
    {eventCode:'80',eventTime:'2026-08-22 16:00:00',trackingEventDescZh:'POD'}
  ]}
}];
const events=normalizeV262TrackPayload(nested);
assert.equal(events.length,4,'nested CE event wrapper must be flattened into individual trajectory events');
assert.ok(events.every(row=>row.shipmentCode==='TBKH-001'),'wrapper shipmentCode must be inherited by every nested event');
assert.deepEqual([...V263_DELIVERY_KPI_TYPES],['TBKH','SHOPEECN','SHOPEEVN'],'attempt/signing tracking scope must be exactly TBKH + SHOPEECN + SHOPEEVN');
for(const type of V263_DELIVERY_KPI_TYPES)assert.equal(v262ShouldRetryStrictRow({terminalReason:'POD',businessType:type,attemptNo:0,podDate:'',signingDays:null}),true,`${type} unknown POD attempt must remain eligible for evidence retry`);
for(const type of ['CE','CEAF','ALI1688','WHPP'])assert.equal(v262ShouldRetryStrictRow({terminalReason:'POD',businessType:type,attemptNo:0,podDate:'',signingDays:null}),false,`${type} must not enter 1/2/3-attempt or signing-day tracking`);
assert.equal(v262ShouldRetryStrictRow({terminalReason:'POD',businessType:'SHOPEECN',attemptNo:1,podDate:'2026-08-21',signingDays:1}),false,'known attempt with complete signing evidence must stay locked');
assert.equal(v262ShouldRetryStrictRow({terminalReason:'POD',businessType:'SHOPEECN',attemptNo:1,podDate:'',signingDays:null}),true,'known attempt with missing POD/signing evidence must still backfill signing days without dropping the locked attempt');
assert.equal(v262ShouldRetryStrictRow({terminalReason:'RETURNED',businessType:'TBKH',attemptNo:0,podDate:'',signingDays:null}),false,'non-POD terminal must not enter delivery evidence backfill');
assert.match(V262_SHOPEE_STRICT_EVIDENCE_ID,/v263-three-business-attempt-signing-retry/);
console.log('[V263] delivery evidence smoke passed: exact three-business scope + independent attempt/signing evidence retry + preserve complete known attempts');
