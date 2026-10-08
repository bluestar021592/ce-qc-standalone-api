import test from 'node:test';
import assert from 'node:assert/strict';

import { progressShape } from '../src/v33RunProgressPatch.js';

test('V33 reports live trajectory progress from the current tiny checkpoint contract', () => {
  const progress = progressShape({
    businessType: 'CCSL',
    reportDate: '2026-08-09',
    lock: {
      status: 'running',
      currentStage: '轨迹查询',
      batchIndex: 2,
      totalBatches: 6,
      runId: 'run-track-001'
    },
    checkpoint: { errorMessage: '轨迹批量 2/6：50票' },
    payload: {
      scanDone: 821,
      scanTotal: 821,
      trackDone: 50,
      trackTotal: 288,
      runStatus: 'running'
    },
    sourceTotal: 821,
    persistedTrackTotal: 288
  });

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
  const progress = progressShape({
    businessType: 'CCSL',
    reportDate: '2026-08-09',
    lock: {
      status: 'running',
      currentStage: '订单扫描',
      batchIndex: 2,
      totalBatches: 3
    },
    payload: {
      scanDone: 350,
      scanTotal: 815,
      trackDone: 0,
      trackTotal: 0,
      runStatus: 'running'
    },
    sourceTotal: 815,
    persistedTrackTotal: 0
  });

  assert.equal(progress.scanDone, 350);
  assert.equal(progress.scanTotal, 815);
  assert.equal(progress.done, 350);
  assert.equal(progress.total, 815);
});

test('V33 completed state is not falsely reported as actively running', () => {
  const progress = progressShape({
    businessType: 'CCSL',
    reportDate: '2026-08-09',
    lock: {
      status: 'finished',
      currentStage: '完成',
      batchIndex: 6,
      totalBatches: 6
    },
    payload: {
      trackDone: 288,
      trackTotal: 288,
      runStatus: 'finished'
    },
    sourceTotal: 288,
    persistedTrackTotal: 288
  });

  assert.equal(progress.running, false);
  assert.equal(progress.trackDone, 288);
  assert.equal(progress.trackTotal, 288);
  assert.equal(progress.runStatus, 'finished');
});

test('V760 persisted finished run lock wins over a stale running checkpoint',()=>{
  const progress=progressShape({
    businessType:'CCSL',reportDate:'2026-07-04',
    lock:{status:'finished',currentStage:'完成',runId:'finished-run'},
    checkpoint:{status:'running',stage:'订单扫描'},
    payload:{runStatus:'running',scanDone:20,scanTotal:20},
    sourceTotal:20
  });
  assert.equal(progress.runStatus,'finished');
  assert.equal(progress.running,false);
});
test('V760 real running lock wins over stale finished checkpoint',()=>{
  const progress=progressShape({
    businessType:'SHOPEE',reportDate:'2026-07-04',
    lock:{status:'running',currentStage:'订单扫描',runId:'active-run'},
    checkpoint:{status:'finished',stage:'完成'},
    payload:{runStatus:'finished',scanDone:1,scanTotal:20},
    sourceTotal:20
  });
  assert.equal(progress.runStatus,'running');
  assert.equal(progress.running,true);
});
