import assert from 'node:assert/strict';
import { buildStrictParityStats, assertStrictParityReconciliation, V198_PARITY_EXPORT_VERSION } from '../src/v198UnifiedParityExporter.js';

const range={from:'2026-08-01',to:'2026-08-02'};
const base={status:'Y',statusDesc:'POD',isStore:false,returned:false,pending:false,delivering:false,hasEvidence:true};
const rows=[
  {...base,firstReportDate:'2026-08-01',shipmentCode:'PP-1',area:'金边',pod:true,deliveryDays:1,attemptNo:1,strictPodSource:'POD锁'},
  {...base,firstReportDate:'2026-08-01',shipmentCode:'PP-2',area:'金边',pod:true,deliveryDays:2,attemptNo:2,strictPodSource:'POD终态轨迹'},
  {...base,firstReportDate:'2026-08-01',shipmentCode:'PV-3',area:'外省',pod:true,deliveryDays:3,attemptNo:3,strictPodSource:'扫描终态POD时间',isStore:true},
  {...base,firstReportDate:'2026-08-01',shipmentCode:'PV-U',area:'外省',pod:true,deliveryDays:0,attemptNo:0,strictPodSource:''},
  {...base,firstReportDate:'2026-08-02',shipmentCode:'PV-NP',area:'外省',pod:false,deliveryDays:0,attemptNo:0,status:'P',statusDesc:'Pending',pending:true},
  {...base,firstReportDate:'2026-08-02',shipmentCode:'UNK-1',area:'未识别',pod:false,deliveryDays:0,attemptNo:0,status:'N'}
];
const stats=buildStrictParityStats(rows,range);
const result=assertStrictParityReconciliation(stats);
assert.equal(result.passed,true);
const o=stats.overall;
assert.equal(o.total,6);
assert.equal(o.pp,2);
assert.equal(o.pv,3);
assert.equal(o.unknownRegion,1);
assert.equal(o.pod,4);
assert.equal(o.a1,1);
assert.equal(o.a2,1);
assert.equal(o.a3,1);
assert.equal(o.attemptUnknown,1);
assert.equal(o.days.length,3);
assert.equal(o.ppDays.length,2);
assert.equal(o.pvDays.length,1);
assert.equal(o.store,1);
console.log(`[V198] strict POD-time parity smoke passed · ${V198_PARITY_EXPORT_VERSION}`);
