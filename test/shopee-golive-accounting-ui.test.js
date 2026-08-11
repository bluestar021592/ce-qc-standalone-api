import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildShopeeDashboard } from '../src/shopeeReporting.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

function row(shipmentCode, currentState, extra = {}) {
  return {
    shipmentCode,
    reportDate: '2026-08-01',
    recipient_group: 'VN',
    regionCode: 'PV',
    currentState,
    POD状态: currentState === 'POD' ? 'POD' : '未POD',
    是否POD: currentState === 'POD' ? '是' : '否',
    finalRowAvailable: true,
    ...extra
  };
}

test('RETURN_COMPLETED is counted as returned even without the legacy Chinese return flag', () => {
  const rows = [
    row('VN-POD', 'POD', { POD时间: '2026-08-01 14:00:00' }),
    row('VN-RETURN', 'RETURN_COMPLETED', { 退回状态: '' }),
    row('VN-OPEN', 'OPEN_TRACK_REQUIRED')
  ];
  const view = buildShopeeDashboard({
    reportDate: '2026-08-01',
    pnhBills: rows.map(item => item.shipmentCode),
    finalRows: rows
  });
  const metrics = view.recipientGroups.VN.metrics;
  assert.deepEqual(
    { total: metrics.total, pod: metrics.pod, returned: metrics.returned, unresolved: metrics.unresolved, accounted: metrics.accounted, difference: metrics.accountingDifference },
    { total: 3, pod: 1, returned: 1, unresolved: 1, accounted: 3, difference: 0 }
  );
  assert.equal(view.detailTabs.VN_returned.total, 1);
  assert.equal(view.regions.PV.returned, 1);
});

test('dashboard patch keeps percentage subtitles semantic instead of dividing a percent by ticket volume', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'v27-dashboard-fix.js'), 'utf8');
  assert.match(source, /function normalizeRatioText\(model\)/);
  assert.match(source, /当前比率/);
  // Optional chaining is an implementation detail; the regression guard cares
  // that explicit %-unit metrics OR labels ending in 率/百分比 use the semantic path.
  assert.match(source, /item\?\.unit\s*===\s*'%'|item\.unit\s*===\s*'%'/);
  assert.match(source, /\(率\|百分比\)\$\/\.test\(label\)/);
});

test('only the trend mount fix owns Shopee 1/2/3 attempt trend panel creation', () => {
  const dashboardFix = fs.readFileSync(path.join(root, 'public', 'v27-dashboard-fix.js'), 'utf8');
  const trendMount = fs.readFileSync(path.join(root, 'public', 'v27-trend-mount-fix.js'), 'utf8');
  assert.match(dashboardFix, /Attempt trend ownership: v27-trend-mount-fix\.js only/);
  assert.doesNotMatch(dashboardFix, /extra\.innerHTML='<h2>1\/2\/3派成功率趋势/);
  assert.match(trendMount, /id='v27ForcedAttemptTrend'/);
  assert.match(trendMount, /<h2>1\/2\/3派成功率趋势<\/h2>/);
});

test('fast range dashboard and attempt trend both fall back from podAttemptNo to persisted POD timestamp', () => {
  const facade = fs.readFileSync(path.join(root, 'src', 'rangeDashboardStore.js'), 'utf8');
  const v36 = fs.readFileSync(path.join(root, 'src', 'rangeDashboardStoreV36.js'), 'utf8');
  const v33 = fs.readFileSync(path.join(root, 'src', 'rangeDashboardStoreV33.js'), 'utf8');
  const trend = fs.readFileSync(path.join(root, 'src', 'v27TrendPatch.js'), 'utf8');

  assert.match(facade, /rangeDashboardStoreV36\.js/);
  assert.match(v36, /rangeDashboardStoreV33\.js/);

  for (const source of [v33, trend]) {
    assert.match(source, /podAttemptNo/);
    assert.match(source, /POD时间/);
    assert.match(source, /podTime/);
    assert.match(source, /terminalObservedAt/);
    assert.match(source, /julianday/);
    assert.match(source, /attemptDay/);
  }
  assert.match(v33, /dispatchAttemptUnclassifiedPod/);
  assert.match(trend, /attemptUnknownPod/);
});
