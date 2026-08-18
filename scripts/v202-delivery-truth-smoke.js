import { resolveV202AttemptCycle, v202NaturalDays, V202_DELIVERY_TRUTH_VERSION } from '../src/v202DeliveryTruth.js';
import { bucketRows, statsOf } from '../src/v200Metrics.js';

function must(condition,message){if(!condition)throw new Error(message);}

let r=resolveV202AttemptCycle([
  {kind:'START',time:'2026-08-01 08:00:00',source:'4003'},
  {kind:'START',time:'2026-08-01 09:00:00',source:'70 duplicate same attempt'},
  {kind:'POD',time:'2026-08-01 15:00:00',source:'80'}
]);
must(r.attemptNo===1,'same-attempt repeated START must remain first-attempt POD');

r=resolveV202AttemptCycle([
  {kind:'START',time:'2026-08-01 08:00:00',source:'4003'},
  {kind:'FAIL',time:'2026-08-01 18:00:00',source:'150 Pending'},
  {kind:'FAIL',time:'2026-08-01 18:05:00',source:'duplicate Pending'},
  {kind:'START',time:'2026-08-02 08:30:00',source:'70 redispatch'},
  {kind:'POD',time:'2026-08-02 14:00:00',source:'80'}
]);
must(r.attemptNo===2,'new real START after failed attempt must become second-attempt POD');

r=resolveV202AttemptCycle([
  {kind:'START',time:'2026-08-01 08:00:00',source:'4003'},
  {kind:'FAIL',time:'2026-08-01 18:00:00',source:'150 Pending'},
  {kind:'START',time:'2026-08-02 08:30:00',source:'70 redispatch'},
  {kind:'FAIL',time:'2026-08-02 18:10:00',source:'150 Pending'},
  {kind:'START',time:'2026-08-03 09:00:00',source:'70 third dispatch'},
  {kind:'POD',time:'2026-08-03 13:00:00',source:'80'}
]);
must(r.attemptNo===3,'two failed delivery cycles followed by a real new START must be third-attempt POD');

r=resolveV202AttemptCycle([
  {kind:'START',time:'2026-08-01 08:00:00',source:'4003'},
  {kind:'FAIL',time:'2026-08-01 18:00:00',source:'150 Pending'},
  {kind:'POD',time:'2026-08-02 13:00:00',source:'80 without redispatch evidence'}
]);
must(r.attemptNo===0,'elapsed day or POD after a failed cycle without new dispatch evidence must not fabricate second attempt');

must(v202NaturalDays('2026-07-23 14:23:01','2026-07-24 15:03:02')===2,'order-to-POD natural-day rule must be inclusive');
must(v202NaturalDays('2026-07-23 14:23:01','2026-07-23 15:03:02')===1,'same-day order-to-POD must equal one day');

const rows=[
  {shipmentCode:'POD1',firstReportDate:'2026-08-01',area:'金边',pod:true,returned:false,cancelled:false,terminalNormal:true,openUnpod:false,attemptNo:1,orderTime:'2026-08-01',podTime:'2026-08-01',deliveryDays:1},
  {shipmentCode:'RET1',firstReportDate:'2026-08-01',area:'外省',pod:false,returned:true,cancelled:false,terminalNormal:true,openUnpod:false},
  {shipmentCode:'CAN1',firstReportDate:'2026-08-01',area:'外省',pod:false,returned:false,cancelled:true,terminalNormal:true,openUnpod:false},
  {shipmentCode:'OPEN1',firstReportDate:'2026-08-01',area:'金边',pod:false,returned:false,cancelled:false,terminalNormal:false,openUnpod:true,pending:true},
  {shipmentCode:'MANUAL1',firstReportDate:'2026-08-01',area:'外省',pod:false,returned:false,cancelled:false,terminalNormal:false,openUnpod:true,metricEligible:false,manualEvidence:true}
];
const bucket=bucketRows(rows);
must(bucket['未POD明细'].some(row=>row.shipmentCode==='MANUAL1'),'manual evidence must be included in exported open-unPOD detail');
const stats=statsOf(rows,{from:'2026-08-01',to:'2026-08-01'}).overall;
must(stats.total===4,'manual evidence-only row must not inflate official daily denominator');
must(stats.evidenceOnly===1,'manual evidence-only row must be counted separately');
must(stats.notPod===1 && stats.returned===1 && stats.cancelled===1,'terminal and official open-unPOD counts must be mutually exclusive');
must(V202_DELIVERY_TRUTH_VERSION==='2026-08-18-v203-real-delivery-cycle-manual-evidence-v3','unexpected V203 delivery truth version');
console.log('[V203] real delivery cycles, order-to-POD average, terminal exclusion and manual-evidence KPI isolation smoke passed');
