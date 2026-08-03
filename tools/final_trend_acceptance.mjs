import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const testDir = path.resolve('data/codex_final_lock/trend');
fs.mkdirSync(testDir, { recursive: true });
process.env.DATA_DIR = testDir;
process.env.DB_FILE = path.join(testDir, 'trend_acceptance.db');
process.env.EXPORTS_DIR = path.join(testDir, 'exports');

const { getMetricTrend } = await import('../src/reporting.js');

const dates = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06'];
const statuses = ['正常', '需跟进', '重点关注', '正常', '需跟进', '重点关注'];
const historySummary = dates.map((reportDate, index) => ({
  reportDate,
  summary: {
    metrics: { 'Pending1次': index + 1, '今日PNH': 100 + index },
    metricStatuses: { 'Pending1次': statuses[index], '今日PNH': '正常' }
  }
}));
const state = { reportDate: '2026-07-07', historySummary };
const anomaly = getMetricTrend('Pending1次', state.reportDate, 7, state, 7, '正常');
const volume = getMetricTrend('今日PNH', state.reportDate, 7, state, 107, '正常');

assert.deepEqual(anomaly.map(item => item.date), [...dates, '2026-07-07']);
assert.equal(anomaly.at(-1).date, state.reportDate);
assert.deepEqual([...new Set(anomaly.map(item => item.status))].sort(), ['danger', 'normal', 'warning']);
assert.deepEqual([...new Set(volume.map(item => item.status))], ['volume']);

const result = {
  ok: true,
  dates: anomaly.map(item => item.date),
  anomalyStatuses: anomaly.map(item => item.status),
  volumeStatuses: volume.map(item => item.status),
  currentDateAtRight: anomaly.at(-1).date === state.reportDate
};
fs.writeFileSync(path.join(testDir, 'trend_acceptance_results.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
