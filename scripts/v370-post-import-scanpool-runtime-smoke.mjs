import assert from 'node:assert/strict';
import { runQcPipeline } from '../src/v314PipelineThroughput.js';
import { runWhppPipeline } from '../src/whppPipeline.js';

function fakeClient(counter) {
  return {
    async confirmQuery(codes) {
      counter.confirm.push([...codes]);
      return codes.map(shipmentCode => ({ shipmentCode, orderStatus: '85', shipmentStatus: 'POD' }));
    },
    async trackQuery(codes) {
      counter.track.push([...codes]);
      return codes.map(shipmentCode => ({ shipmentCode }));
    },
    async exceptionQuery(codes) {
      counter.exception.push([...codes]);
      return codes.map(shipmentCode => ({ shipmentCode }));
    }
  };
}

const noop = async () => {};

// V42 intentionally stores scanPool=[] at import time. CCSL must rebuild from the
// committed pnhBills/carry membership when processing actually starts.
{
  const counter = { confirm: [], track: [], exception: [] };
  const bills = ['CC260816700001','CC260816700002'];
  const state = {
    businessType: 'CCSL', reportDate: '2026-08-16', dailyReportReady: true,
    pnhBills: bills, dailyParseRows: bills.map((shipmentCode, i) => ({ shipmentCode, 运单号: shipmentCode, reportDate: '2026-08-16', rowNumber: i + 2 })),
    carryBills: [], nextCarryBills: [], podLocks: [], scanPool: [], scanResults: [], scanQueryStatus: [],
    trackResults: [], trackEvents: [], trackQueryStatus: [], finalRows: [], processing: { running: false, paused: false, phase: '待处理' }
  };
  const result = await runQcPipeline({ state, client: fakeClient(counter), onProgress: noop, onCheckpoint: noop, isPaused: async () => false });
  assert.deepEqual(state.scanPool, bills, 'CCSL must rebuild the scan pool from committed daily membership');
  assert.equal(counter.confirm.length, 1, 'CCSL must actually call confirm-query after import even when saved scanPool was empty');
  assert.deepEqual(counter.confirm[0], bills);
  assert.equal(counter.track.length, 0, 'POD terminal fixture must not query trajectory');
  assert.equal(result.state.processing.phase, '完成');
}

// SHOPEE uses the same post-import rebuild contract, with CN/VN membership carried
// by dailyParseRows rather than relying on an import-time scanPool snapshot.
{
  const counter = { confirm: [], track: [], exception: [] };
  const bills = ['SPE260816700001','SPE260816700002'];
  const state = {
    businessType: 'SHOPEE', reportDate: '2026-08-16', dailyReportReady: true,
    pnhBills: bills,
    dailyParseRows: [
      { shipmentCode: bills[0], 运单号: bills[0], reportDate: '2026-08-16', recipient_group: 'CN', recipient_group_reason: 'UNIFIED_BUSINESS_TYPE', rowNumber: 2 },
      { shipmentCode: bills[1], 运单号: bills[1], reportDate: '2026-08-16', recipient_group: 'VN', recipient_group_reason: 'UNIFIED_BUSINESS_TYPE', rowNumber: 3 }
    ],
    priorCarryRows: [], carryBills: [], nextCarryBills: [], podLocks: [], scanPool: [], scanRetryBills: [], scanResults: [], scanQueryStatus: [],
    trackResults: [], trackEvents: [], eventQueryStatus: [], exceptionItems: [], exceptionQueryStatus: [], finalRows: [], apiBatchStatus: [],
    processing: { running: false, paused: false, phase: '待处理' }
  };
  const result = await runQcPipeline({ state, client: fakeClient(counter), onProgress: noop, onCheckpoint: noop, isPaused: async () => false });
  assert.deepEqual(state.scanPool, bills, 'SHOPEE must rebuild the scan pool from committed CN/VN daily membership');
  assert.equal(counter.confirm.length, 1, 'SHOPEE must actually call confirm-query after import even when saved scanPool was empty');
  assert.deepEqual(counter.confirm[0], bills);
  assert.equal(counter.track.length, 0);
  assert.equal(counter.exception.length, 0);
  assert.equal(result.state.processing.phase, '完成');
}

// WHPP is the independent third stage. Its start must rebuild allBills/scanPool from
// the target-date dedicated WHPP membership and cannot inherit an empty prior-day pool.
{
  const counter = { confirm: [], track: [], exception: [] };
  const bills = ['CE260816700001','CE260816700002'];
  const state = {
    businessType: 'WHPP', reportDate: '2026-08-16', dailyReportReady: true,
    pnhBills: bills,
    dailyParseRows: bills.map((shipmentCode, i) => ({ shipmentCode, 运单号: shipmentCode, businessType: 'WHPP', reportDate: '2026-08-16', regionCode: i ? 'PV' : 'PP', rowNumber: i + 2 })),
    carryBills: [], nextCarryBills: [], podLocks: [], scanPool: [], scanResults: [], scanQueryStatus: [],
    trackEvents: [], eventQueryStatus: [], exceptionItems: [], exceptionQueryStatus: [], finalRows: [],
    processing: { running: false, paused: false, phase: '待处理' }
  };
  const result = await runWhppPipeline({ state, client: fakeClient(counter), onProgress: noop, onCheckpoint: noop, isPaused: async () => false });
  assert.deepEqual(state.scanPool, bills, 'WHPP third stage must rebuild scanPool from its committed target-date membership');
  assert.equal(counter.confirm.length, 1, 'WHPP must actually call confirm-query after import even when saved scanPool was empty');
  assert.deepEqual(counter.confirm[0], bills);
  assert.equal(counter.track.length, 0);
  assert.equal(counter.exception.length, 0);
  assert.equal(result.state.processing.phase, '完成');
}

console.log('[V370] post-import scanPool runtime smoke passed · CCSL/SHOPEE/WHPP all rebuild an empty saved scanPool from committed daily membership and actually invoke confirm-query · POD terminal fixture correctly skips trajectory');

// Full-dependency continuation: once V370 proves the real three pipeline entries,
// immediately run the exact historical 08-15 -> 08-16 production Excel parser gate.
await import('./v372-historical-0815-0816-classification-runtime-smoke.mjs');
