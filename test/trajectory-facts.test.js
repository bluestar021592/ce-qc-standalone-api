import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-trajectory-facts-'));
process.env.DATA_DIR = tempRoot;
process.env.DB_FILE = path.join(tempRoot, 'facts.db');

const {
  buildTrajectoryFacts,
  terminalFromLatestEvent,
  TRAJECTORY_FACT_VERSION
} = await import('../src/trajectoryFacts.js');
const { closeDb } = await import('../src/db.js');

function event({ code = '', time, text = '', locationCode = '', eventShop = '', id = '' }) {
  return {
    id,
    shipmentCode: 'CCFACT001',
    eventCode: code,
    eventTime: time,
    trackingEventDescZh: text,
    locationCode,
    eventShop
  };
}

test('trajectory fact layer uses only the last effective track event for track terminal state', () => {
  const facts = buildTrajectoryFacts({
    shipmentCode: 'CCFACT001',
    reportDate: '2026-08-09',
    scanRow: { shipmentCode: 'CCFACT001', orderStatus: '70' },
    events: [
      event({ code: '80', time: '2026-08-07 12:00:00', text: '历史签收节点' }),
      event({ code: '150', time: '2026-08-09 09:00:00', text: 'Pending 最新有效节点' })
    ]
  });

  assert.equal(facts.factVersion, TRAJECTORY_FACT_VERSION);
  assert.equal(facts.lastCode, '150');
  assert.equal(facts.latestTrackTerminal, null, 'historical POD must not override a later valid trajectory event');
  assert.equal(facts.isPod, false);
  assert.equal(facts.isReturned, false);
});

test('historical return-complete does not override a later valid trajectory event', () => {
  const facts = buildTrajectoryFacts({
    shipmentCode: 'CCFACT001',
    reportDate: '2026-08-09',
    scanRow: { shipmentCode: 'CCFACT001', orderStatus: '70' },
    events: [
      event({ code: '86', time: '2026-08-07 12:00:00', text: '历史退回完成' }),
      event({ code: '150', time: '2026-08-09 09:00:00', text: 'Pending 最新有效节点' })
    ]
  });

  assert.equal(facts.lastCode, '150');
  assert.equal(facts.isReturned, false);
  assert.equal(facts.latestTrackTerminal, null);
});

test('latest track code 80/86 are terminal while scan 85/100 remain independently authoritative', () => {
  const pod = buildTrajectoryFacts({
    shipmentCode: 'CCFACT001',
    scanRow: { orderStatus: '70' },
    events: [event({ code: '80', time: '2026-08-09 10:00:00', text: '签收' })]
  });
  assert.equal(pod.isPod, true);
  assert.equal(pod.terminalSource, 'LATEST_TRACK_CODE_80');

  const returned = buildTrajectoryFacts({
    shipmentCode: 'CCFACT002',
    scanRow: { orderStatus: '70' },
    events: [event({ code: '86', time: '2026-08-09 10:00:00', text: '退回完成' })]
  });
  assert.equal(returned.isReturned, true);
  assert.equal(returned.terminalSource, 'LATEST_TRACK_CODE_86');

  const scanPod = buildTrajectoryFacts({
    shipmentCode: 'CCFACT003',
    scanRow: { orderStatus: '85' },
    events: [event({ code: '150', time: '2026-08-09 10:00:00', text: '轨迹仍有Pending文本' })]
  });
  assert.equal(scanPod.isPod, true);
  assert.equal(scanPod.terminalSource, 'SCAN_ORDER_STATUS_85');

  const scanReturn = buildTrajectoryFacts({
    shipmentCode: 'CCFACT004',
    scanRow: { orderStatus: '100' },
    events: [event({ code: '150', time: '2026-08-09 10:00:00', text: '旧轨迹内容' })]
  });
  assert.equal(scanReturn.isReturned, true);
  assert.equal(scanReturn.terminalSource, 'SCAN_ORDER_STATUS_100');
});

test('580 aliases are special only when they are the latest effective destination', () => {
  for (const alias of ['CE:580', 'CEL:580', 'CE:CCSL580', 'CEL:CCSL580']) {
    const facts = buildTrajectoryFacts({
      shipmentCode: 'CCFACT001',
      scanRow: { orderStatus: '70' },
      events: [event({ code: '26', time: '2026-08-09 10:00:00', text: `货物到达网点【${alias}】` })]
    });
    assert.equal(facts.special?.specialState, 'CCSL580_RETENTION', alias);
    assert.equal(facts.special?.label, '580滞留包裹', alias);
  }

  const historicalOnly = buildTrajectoryFacts({
    shipmentCode: 'CCFACT001',
    scanRow: { orderStatus: '70' },
    events: [
      event({ code: '26', time: '2026-08-08 10:00:00', text: '货物到达网点【CE:580】' }),
      event({ code: '150', time: '2026-08-09 10:00:00', text: '后续Pending' })
    ]
  });
  assert.equal(historicalOnly.special, null, 'historical 580 must not suppress a later current state');
});

test('CECN, CEZT and warehouse self-pickup are latest-node normal diversion facts', () => {
  const cecn = buildTrajectoryFacts({
    shipmentCode: 'CCFACT001', scanRow: { orderStatus: '70' },
    events: [event({ code: '26', time: '2026-08-09 10:00:00', text: '货物到达网点【CEL:CECN】' })]
  });
  assert.equal(cecn.special?.specialState, 'CCSLCN_DIVERSION');
  assert.equal(cecn.special?.label, 'CCSLCN分流');

  const cezt = buildTrajectoryFacts({
    shipmentCode: 'CCFACT002', scanRow: { orderStatus: '70' },
    events: [event({ code: '26', time: '2026-08-09 10:00:00', text: '货物到达网点【CE:CEZT】' })]
  });
  assert.equal(cezt.special?.specialState, 'CCSLZT_DIVERSION');
  assert.equal(cezt.special?.label, 'CCSLZT分流');

  const pickup = buildTrajectoryFacts({
    shipmentCode: 'CCFACT003', scanRow: { orderStatus: '70' },
    events: [event({ code: '99', time: '2026-08-09 10:00:00', text: 'Work order:仓库自提' })]
  });
  assert.equal(pickup.special?.specialState, 'SELF_PICKUP');
  assert.equal(pickup.special?.label, '仓库自提件');
});

test('pending factual dates de-duplicate same-day events before continuity calculation', () => {
  const facts = buildTrajectoryFacts({
    shipmentCode: 'CCFACT001',
    scanRow: { orderStatus: '70' },
    events: [
      event({ code: '150', time: '2026-08-07 09:00:00', text: 'Pending A' }),
      event({ code: '150', time: '2026-08-07 18:00:00', text: 'Pending B same day' }),
      event({ code: '150', time: '2026-08-09 09:00:00', text: 'Pending gap day' })
    ]
  });

  assert.equal(facts.pendingRawEventCount, 3);
  assert.deepEqual(facts.pendingDates, ['2026-08-07', '2026-08-09']);
  assert.equal(facts.pendingDistinctDayCount, 2);
  assert.equal(facts.pendingDateContinuity, false);
});

test('terminal helper never searches historical events by itself', () => {
  assert.equal(terminalFromLatestEvent(event({ code: '150', time: '2026-08-09 10:00:00' })), null);
  assert.equal(terminalFromLatestEvent(event({ code: '80', time: '2026-08-09 10:00:00' }))?.type, 'POD');
});

test.after(() => {
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
