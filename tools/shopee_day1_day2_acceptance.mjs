import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve('data/codex_acceptance/shopee_day1_day2');
fs.mkdirSync(dataDir, { recursive: true });
const dbFile = path.join(dataDir, 'day1_day2.db');
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbFile}${suffix}`, { force: true });
process.env.DATA_DIR = dataDir;
process.env.DB_FILE = dbFile;
process.env.EXPORTS_DIR = path.join(dataDir, 'exports');

const { runQcPipeline } = await import('../src/pipeline.js');
const { loadBusinessState, saveBusinessState } = await import('../src/businessStore.js');
const { closeDb, getDb } = await import('../src/db.js');

const bill = 'SPE260713000655';
const allEvents = [
  { shipmentCode: bill, eventTime: '2026-07-19 20:27:16', trackingEventDescZh: 'Pending OC' },
  { shipmentCode: bill, eventTime: '2026-07-19 20:44:08', trackingEventDescZh: 'Inbound' },
  { shipmentCode: bill, eventTime: '2026-07-20 08:32:51', trackingEventDescZh: 'Delivery Assign' },
  { shipmentCode: bill, eventTime: '2026-07-20 08:57:14', trackingEventDescZh: 'Delivery' },
  { shipmentCode: bill, eventTime: '2026-07-20 13:02:07', trackingEventDescZh: 'POD' }
];
const exceptions = [{ shipmentCode: bill, exceptionDesc: 'oc', reportTime: '2026-07-19 20:27:16', statusCode: '30', fileId: 'fixture' }];
const calls = [];
const client = {
  shipmentTrack: async codes => { calls.push({ day: currentDay, api: 'shipment', codes: [...codes] }); return codes.map(shipmentCode => ({ shipmentCode, shipmentStatus: '30', shipmentStatusDesc: 'Delivery Assign' })); },
  trackQuery: async codes => { calls.push({ day: currentDay, api: 'event', codes: [...codes] }); return allEvents.filter(row => codes.includes(row.shipmentCode)); },
  exceptionQuery: async codes => { calls.push({ day: currentDay, api: 'exception', codes: [...codes] }); return exceptions.filter(row => codes.includes(row.shipmentCode)); }
};
let currentDay = 'DAY1';

const day1 = {
  businessType: 'SHOPEE', reportDate: '2026-07-19', dailyReportReady: true, sourceName: 'day1.xls',
  pnhBills: [bill], carryBills: [], podLocks: [], dailyParseRows: [{ shipmentCode: bill, reportDate: '2026-07-19', raw: { deliveryShop: 'PP001' } }],
  currentRun: { runId: 'run-day1' }, lastRunSummary: { runId: 'run-day1' }
};
await runQcPipeline({ state: day1, client, onProgress: async () => {}, onCheckpoint: async () => {}, isPaused: async () => false });
assert.equal(day1.finalRows[0].primaryCategory, 'OC1天');
assert.deepEqual(day1.carryBills, [bill]);
assert.equal(day1.podLocks.includes(bill), false);
saveBusinessState(day1, 'SHOPEE');

const restoredDay1 = loadBusinessState('SHOPEE');
assert.deepEqual(restoredDay1.carryBills, [bill]);
assert.equal(getDb().prepare("SELECT count(*) AS count FROM business_carry_bills WHERE businessType='SHOPEE' AND status='active'").get().count, 1);

currentDay = 'DAY2';
const day2 = {
  ...restoredDay1,
  reportDate: '2026-07-20', sourceName: 'day2.xls', dailyReportReady: true,
  pnhBills: [], dailyParseRows: [], priorCarryRows: restoredDay1.finalRows,
  scanPool: [], scanResults: [], shipmentTrackResults: [], shipmentQueryStatus: [], needTrackBills: [],
  trackEvents: [], eventQueryStatus: [], exceptionItems: [], exceptionQueryStatus: [], apiBatchStatus: [], trackResults: [], finalRows: [], nextCarryBills: [],
  currentRun: { runId: 'run-day2' }, lastRunSummary: { runId: 'run-day2' }
};
await runQcPipeline({ state: day2, client, onProgress: async () => {}, onCheckpoint: async () => {}, isPaused: async () => false });
assert.equal(day2.finalRows[0].是否POD, '是');
assert.equal(day2.carryBills.includes(bill), false);
assert.equal(day2.podLocks.includes(bill), true);
saveBusinessState(day2, 'SHOPEE');

closeDb();
const { loadBusinessState: reloadAfterRestart } = await import(`../src/businessStore.js?restart=${Date.now()}`);
const restarted = reloadAfterRestart('SHOPEE');
assert.equal(restarted.reportDate, '2026-07-20');
assert.equal(restarted.podLocks.includes(bill), true);
assert.equal(restarted.carryBills.includes(bill), false);

const day2Calls = calls.filter(row => row.day === 'DAY2');
assert.equal(day2Calls.some(row => row.api === 'shipment' && row.codes.includes(bill)), true);
assert.equal(day2Calls.some(row => row.api === 'event' && row.codes.includes(bill)), true);

console.log(JSON.stringify({
  ok: true,
  sample: bill,
  day1: { category: day1.finalRows[0].primaryCategory, carry: day1.carryBills, podLocks: day1.podLocks },
  day2: { category: day2.finalRows[0].primaryCategory, carry: day2.carryBills, podLocks: day2.podLocks, podTime: day2.finalRows[0].POD时间 },
  calls: day2Calls,
  restart: { reportDate: restarted.reportDate, carry: restarted.carryBills, podLocks: restarted.podLocks },
  integrity: getDb().prepare('PRAGMA integrity_check').get().integrity_check
}, null, 2));
closeDb();
