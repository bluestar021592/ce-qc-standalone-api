import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve('data/codex_acceptance/shopee_pipeline');
fs.mkdirSync(dataDir, { recursive: true });
process.env.DATA_DIR = dataDir;
process.env.DB_FILE = path.join(dataDir, 'pipeline.db');
process.env.EXPORTS_DIR = path.join(dataDir, 'exports');
const { runQcPipeline } = await import('../src/pipeline.js');

const makeBills = count => Array.from({ length: count }, (_, index) => `SPE${String(index + 1).padStart(12, '0')}`);

async function runFixture(count, failure = null, resumeState = null) {
  const calls = [];
  const bills = makeBills(count);
  const state = resumeState || {
    businessType: 'SHOPEE', reportDate: '2026-07-20', pnhBills: bills, carryBills: [], podLocks: [],
    dailyParseRows: bills.map(shipmentCode => ({ shipmentCode, raw: { deliveryShop: shipmentCode.endsWith('1') ? 'PP001' : 'PV013' } })),
    currentRun: { runId: 'run-test' }, lastRunSummary: { runId: 'run-test' }
  };
  const client = {
    shipmentTrack: async codes => { calls.push({ api: 'shipment', codes: [...codes] }); return codes.map(shipmentCode => ({ shipmentCode, shipmentStatus: '30', shipmentStatusDesc: 'Delivery Assign' })); },
    trackQuery: async codes => {
      calls.push({ api: 'event', codes: [...codes] });
      if (failure?.api === 'event' && codes.some(code => failure.codes.has(code))) throw new Error('fixture timeout');
      return codes.map(shipmentCode => ({ shipmentCode, eventTime: '2026-07-20 09:00:00', trackingEventDescZh: 'Delivery' }));
    },
    exceptionQuery: async codes => { calls.push({ api: 'exception', codes: [...codes] }); return []; }
  };
  let error = null;
  try {
    await runQcPipeline({ state, client, onProgress: async () => {}, onCheckpoint: async () => {}, isPaused: async () => false });
  } catch (caught) { error = caught; }
  return { state, calls, error, bills };
}

const splitEvidence = [];
for (const count of [1, 10, 11, 49, 50, 51, 99, 100, 101]) {
  const fixture = await runFixture(count);
  const shipmentSizes = fixture.calls.filter(call => call.api === 'shipment').map(call => call.codes.length);
  const eventSizes = fixture.calls.filter(call => call.api === 'event').map(call => call.codes.length);
  const exceptionSizes = fixture.calls.filter(call => call.api === 'exception').map(call => call.codes.length);
  const expected = [];
  for (let remaining = count; remaining > 0; remaining -= 50) expected.push(Math.min(50, remaining));
  assert.deepEqual(shipmentSizes, expected);
  assert.deepEqual(eventSizes, expected);
  assert.deepEqual(exceptionSizes, expected);
  splitEvidence.push({ count, expected, shipmentSizes, eventSizes, exceptionSizes });
}

const failedBills = new Set(makeBills(100).slice(50));
const first = await runFixture(100, { api: 'event', codes: failedBills });
assert.equal(first.error?.code, 'SHOPEE_PARTIAL_API_FAILURE');
const firstSuccessfulEventBills = new Set(first.state.eventQueryStatus.filter(row => row.status === 'success').map(row => row.shipmentCode));
assert.equal(firstSuccessfulEventBills.size, 50);

const second = await runFixture(100, null, first.state);
const retriedEventBills = new Set(second.calls.filter(call => call.api === 'event').flatMap(call => call.codes));
assert.equal([...firstSuccessfulEventBills].some(code => retriedEventBills.has(code)), false);
assert.equal(second.error, null);
assert.equal(second.state.finalRows.length, 100);

console.log(JSON.stringify({
  ok: true,
  splitEvidence,
  failedBatchRetry: {
    firstRunSuccessfulBills: firstSuccessfulEventBills.size,
    firstRunFailedBills: failedBills.size,
    resumeEventRequestSizes: second.calls.filter(call => call.api === 'event').map(call => call.codes.length),
    successfulBillsRepeated: [...firstSuccessfulEventBills].filter(code => retriedEventBills.has(code)).length,
    finalRows: second.state.finalRows.length
  }
}, null, 2));
