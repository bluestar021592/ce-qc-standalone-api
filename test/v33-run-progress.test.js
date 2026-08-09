import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeRunProgressV33 } from '../src/v33RunProgressPatch.js';

test('V33 reports live trajectory progress from checkpointed state', () => {
  const state = {
    reportDate: '2026-08-09',
    processing: {
      running: true,
      paused: false,
      phase: '轨迹查询',
      batchIndex: 2,
      totalBatches: 6,
      runId: 'run-track-001'
    },
    scanPool: Array.from({ length: 821 }, (_, i) => `SCAN${i}`),
    scanResults: Array.from({ length: 821 }, (_, i) => ({ 运单号: `SCAN${i}` })),
    needTrackBills: Array.from({ length: 288 }, (_, i) => `TRACK${i}`),
    trackResults: Array.from({ length: 50 }, (_, i) => ({ 运单号: `TRACK${i}` })),
    logs: ['开始轨迹查询', '轨迹批量 2/6：50票'],
    lastRunSummary: { runStatus: 'running' }
  };

  const progress = summarizeRunProgressV33(state, 'CCSL');
  assert.equal(progress.running, true);
  assert.equal(progress.phase, '轨迹查询');
  assert.equal(progress.batchIndex, 2);
  assert.equal(progress.totalBatches, 6);
  assert.equal(progress.scanDone, 821);
  assert.equal(progress.scanTotal, 821);
  assert.equal(progress.trackDone, 50);
  assert.equal(progress.trackTotal, 288);
  assert.equal(progress.done, 50);
  assert.equal(progress.total, 288);
  assert.equal(progress.lastMessage, '轨迹批量 2/6：50票');
});

test('V33 reports scan progress independently from trajectory totals', () => {
  const state = {
    reportDate: '2026-08-09',
    processing: { running: true, phase: '订单扫描', batchIndex: 2, totalBatches: 3 },
    scanPool: Array.from({ length: 815 }, (_, i) => `S${i}`),
    scanResults: Array.from({ length: 350 }, (_, i) => ({ 运单号: `S${i}` })),
    needTrackBills: [],
    trackResults: []
  };

  const progress = summarizeRunProgressV33(state, 'CCSL');
  assert.equal(progress.scanDone, 350);
  assert.equal(progress.scanTotal, 815);
  assert.equal(progress.done, 350);
  assert.equal(progress.total, 815);
});

test('V33 completed state is not falsely reported as actively running', () => {
  const state = {
    reportDate: '2026-08-09',
    processing: { running: false, paused: false, phase: '完成', batchIndex: 6, totalBatches: 6 },
    needTrackBills: Array.from({ length: 288 }, (_, i) => `T${i}`),
    trackResults: Array.from({ length: 288 }, (_, i) => ({ 运单号: `T${i}` })),
    lastRunSummary: { runStatus: 'finished' }
  };

  const progress = summarizeRunProgressV33(state, 'CCSL');
  assert.equal(progress.running, false);
  assert.equal(progress.trackDone, 288);
  assert.equal(progress.trackTotal, 288);
  assert.equal(progress.runStatus, 'finished');
});
