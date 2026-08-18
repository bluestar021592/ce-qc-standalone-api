import assert from 'node:assert/strict';
import { buildParityStats, assertParityReconciliation, V197_PARITY_EXPORT_VERSION } from '../src/v197UnifiedParityExporter.js';

const range={from:'2026-08-01',to:'2026-08-02'};
const base={status:'Y',statusDesc:'POD',isStore:false,returned:false,pending:false,delivering:false,hasEvidence:true};
const rows=[
  {...base,firstReportDate:'2026-08-01',shipmentCode:'PP-A1',area:'金边',pod:true,deliveryDays:1,attemptNo:1},
  {...base,firstReportDate:'2026-08-01',shipmentCode:'PP-A2',area:'金边',pod:true,deliveryDays:2,attemptNo:2},
  {...base,firstReportDate:'2026-08-01',shipmentCode:'PV-A3',area:'外省',pod:true,deliveryDays:3,attemptNo:3,isStore:true},
  {...base,firstReportDate:'2026-08-01',shipmentCode:'PV-NP',area:'外省',pod:false,deliveryDays:0,attemptNo:0,status:'P',statusDesc:'Pending',pending:true},
  {...base,firstReportDate:'2026-08-02',shipmentCode:'PV-A1',area:'外省',pod:true,deliveryDays:1,attemptNo:1},
  {...base,firstReportDate:'2026-08-02',shipmentCode:'PP-U',area:'金边',pod:true,deliveryDays:0,attemptNo:0}
];
const stats=buildParityStats(rows,range);
assertParityReconciliation(stats);
const o=stats.overall;
assert.equal(o.total,6);
assert.equal(o.pp,3);
assert.equal(o.pv,3);
assert.equal(o.pod,5);
assert.equal(o.a1,2);
assert.equal(o.a2,1);
assert.equal(o.a3,1);
assert.equal(o.attemptUnknown,1);
assert.equal(o.ppPod,3);
assert.equal(o.ppA1,1);
assert.equal(o.ppA2,1);
assert.equal(o.ppAttemptUnknown,1);
assert.equal(o.pvPod,2);
assert.equal(o.pvA1,1);
assert.equal(o.pvA3,1);
assert.equal(o.store,1);
assert.deepEqual(o.days.sort((a,b)=>a-b),[1,1,2,3]);
console.log(`[V197] parity metric smoke passed · ${V197_PARITY_EXPORT_VERSION}`);
