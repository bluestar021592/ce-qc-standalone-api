import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-ccsl-resume-'));
process.env.DATA_DIR = tempRoot;
process.env.DB_FILE = path.join(tempRoot, 'resume.db');
process.env.TRACK_CONCURRENCY = '1';

const { runQcPipeline } = await import('../src/pipeline.js');
const { closeDb } = await import('../src/db.js');

const A = 'CC01082600001';
const B = 'CC01082600002';

function baseState() {
  return {
    businessType: 'CCSL',
    reportDate: '2026-08-09',
    sourceName: 'resume-test.xlsx',
    pnhBills: [A, B],
    carryBills: [],
    nextCarryBills: [],
    podLocks: [],
    dailyParseRows: [
      { shipmentCode: A, 运单号: A, reportDate: '2026-08-09' },
      { shipmentCode: B, 运单号: B, reportDate: '2026-08-09' }
    ],
    scanResults: [],
    trackResults: [],
    trackEvents: [],
    logs: [],
    processing: { running: false, paused: false, phase: '' }
  };
}

function runtimeOptions(state, client) {
  return {
    state,
    client,
    onProgress: async () => {},
    onCheckpoint: async () => {},
    isPaused: async () => false
  };
}

function podRows(codes) {
  return codes.map(shipmentCode => ({ shipmentCode, orderStatus: '85' }));
}

function openRows(codes) {
  return codes.map(shipmentCode => ({ shipmentCode, orderStatus: '70' }));
}

test('CCSL scan resume retries only failed waybills and preserves successful POD work', async () => {
  const state = baseState();
  const firstCalls = [];
  const firstClient = {
    async confirmQuery(codes) {
      firstCalls.push([...codes]);
      if (codes.includes(B)) {
        const error = new Error('socket hang up');
        error.code = 'ECONNRESET';
        throw error;
      }
      return podRows(codes);
    },
    async trackQuery() { throw new Error('track should not run for POD/scan failure case'); }
  };

  await runQcPipeline(runtimeOptions(state, firstClient));
  assert.equal(state.scanQueryStatus.find(row => row.shipmentCode === A)?.status, 'success');
  assert.equal(state.scanQueryStatus.find(row => row.shipmentCode === B)?.status, 'failed');
  assert.ok(state.podLocks.includes(A));
  assert.ok(!state.podLocks.includes(B));

  const secondCalls = [];
  const secondClient = {
    async confirmQuery(codes) {
      secondCalls.push([...codes]);
      return podRows(codes);
    },
    async trackQuery() { throw new Error('track should not run after retry becomes POD'); }
  };

  await runQcPipeline(runtimeOptions(state, secondClient));
  assert.deepEqual(secondCalls, [[B]], 'successful A must never be rescanned; only failed B is retried');
  assert.equal(state.scanQueryStatus.find(row => row.shipmentCode === B)?.status, 'success');
  assert.ok(state.podLocks.includes(A));
  assert.ok(state.podLocks.includes(B));
  assert.equal(new Set(state.finalRows.map(row => row.运单号)).size, 2);
});

test('CCSL track resume reuses successful track results and retries only the failed waybill', async () => {
  const state = baseState();
  const firstTrackCalls = [];
  const firstClient = {
    async confirmQuery(codes) { return openRows(codes); },
    async trackQuery(codes) {
      firstTrackCalls.push([...codes]);
      if (codes.includes(B)) {
        const error = new Error('socket hang up');
        error.code = 'ECONNRESET';
        throw error;
      }
      return [];
    }
  };

  await runQcPipeline(runtimeOptions(state, firstClient));
  assert.equal(state.scanQueryStatus.find(row => row.shipmentCode === A)?.status, 'success');
  assert.equal(state.scanQueryStatus.find(row => row.shipmentCode === B)?.status, 'success');
  assert.equal(state.trackQueryStatus.find(row => row.shipmentCode === A)?.status, 'success');
  assert.equal(state.trackQueryStatus.find(row => row.shipmentCode === B)?.status, 'failed');

  const secondConfirmCalls = [];
  const secondTrackCalls = [];
  const secondClient = {
    async confirmQuery(codes) {
      secondConfirmCalls.push([...codes]);
      return openRows(codes);
    },
    async trackQuery(codes) {
      secondTrackCalls.push([...codes]);
      return [];
    }
  };

  await runQcPipeline(runtimeOptions(state, secondClient));
  assert.deepEqual(secondConfirmCalls, [], 'successful scan results must be reused on resume');
  assert.deepEqual(secondTrackCalls, [[B]], 'successful A track must be reused; only failed B is retried');
  assert.equal(state.trackQueryStatus.find(row => row.shipmentCode === A)?.status, 'success');
  assert.equal(state.trackQueryStatus.find(row => row.shipmentCode === B)?.status, 'success');
  assert.equal(new Set(state.trackResults.map(row => row.运单号)).size, 2);
});

test.after(() => {
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
