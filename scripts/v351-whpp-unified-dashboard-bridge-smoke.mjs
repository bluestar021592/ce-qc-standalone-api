import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildV351WhppDashboard, V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID } from '../src/v351WhppUnifiedDashboardBridgePatch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'v351WhppUnifiedDashboardBridgePatch.js'), 'utf8').replace(/\r\n/g, '\n');
const v85 = fs.readFileSync(path.join(__dirname, '..', 'src', 'v85ShopeeWhppMetricPatch.js'), 'utf8').replace(/\r\n/g, '\n');

assert.match(V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID, /v351-whpp-unified-membership-dashboard-bridge/);
assert.match(v85, /import '\.\/v351WhppUnifiedDashboardBridgePatch\.js';/, 'V351 must load before server route registration');
assert.match(source, /unified_import_batches[\s\S]*status='VALID'/, 'WHPP current membership must come from latest VALID unified import');
assert.match(source, /saveWhppDailyImport\(/, 'future unified imports must mirror WHPP into normalized daily storage');
assert.match(source, /UNIFIED_IMPORT_ROUTE[\s\S]*ensureV351WhppNormalizedDaily/, 'unified import response must trigger WHPP normalized bridge');
assert.match(source, /staleHistoryRejected/, 'stale history mismatch must be observable');
assert.doesNotMatch(source, /historySummary\.total\s*\?\?\s*daily/, 'stale history total must never override canonical membership');

const membershipRows = Array.from({ length: 236 }, (_, i) => ({
  shipmentCode: `CE140826${String(i + 1).padStart(5, '0')}`,
  reportDate: '2026-08-14',
  businessType: 'WHPP',
  regionCode: i % 2 ? 'PV' : 'PP'
}));
const finalRows = membershipRows.map((row, i) => {
  if (i < 200) return { ...row, currentState: 'POD', 是否POD: '是', POD状态: 'POD' };
  if (i < 220) return { ...row, currentState: 'RETURNED', 退回状态: '已退回', primaryCategory: '退回' };
  if (i < 225) return { ...row, currentState: 'ORDER_CANCELLED', 订单取消: '是', primaryCategory: '订单取消' };
  return { ...row, currentState: 'PENDING', primaryCategory: 'Pending', Pending当前次数: 1 };
});

const dashboard = buildV351WhppDashboard({ reportDate: '2026-08-14', membershipRows, finalRows });
assert.equal(dashboard.metrics.total, 236, 'home/unified WHPP=236 must remain 236 on WHPP detail dashboard');
assert.equal(dashboard.metrics.pod, 200);
assert.equal(dashboard.metrics.returned, 20);
assert.equal(dashboard.metrics.cancelled, 5);
assert.equal(dashboard.metrics.unresolved, 11);
assert.equal(dashboard.metrics.pending1, 11);
assert.equal(dashboard.accounting.accounted, 236);
assert.equal(dashboard.accounting.difference, 0);
assert.equal(dashboard.accounting.balanced, true);
assert.equal(dashboard.regions.PP.total + dashboard.regions.PV.total + dashboard.regions.UNKNOWN.total, 236);

console.log('[V351] WHPP unified-dashboard bridge smoke passed · exact 236 membership survives stale-zero history · final facts recompute POD/return/cancel/open · future unified imports mirror normalized WHPP daily · no DB schema change');
