import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildV351WhppDashboard, loadV351UnifiedWhppMembership, V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID } from '../src/v351WhppUnifiedDashboardBridgePatch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'v351WhppUnifiedDashboardBridgePatch.js'), 'utf8').replace(/\r\n/g, '\n');
const v85 = fs.readFileSync(path.join(__dirname, '..', 'src', 'v85ShopeeWhppMetricPatch.js'), 'utf8').replace(/\r\n/g, '\n');

assert.match(V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID, /v351-whpp-unified-membership-dashboard-bridge/);
assert.match(v85, /import '\.\/v351WhppUnifiedDashboardBridgePatch\.js';/, 'V351 must load before server route registration');
assert.match(source, /unified_import_batches[\s\S]*status='VALID'/, 'WHPP current membership must inspect the latest VALID unified import');
assert.match(source, /if \(rows\.length\)[\s\S]*LATEST_VALID_UNIFIED_MEMBERSHIP/, 'only a non-empty WHPP unified partition may become authoritative');
assert.match(source, /UNIFIED_WHPP_EMPTY_KEEP_STANDARD/, 'an empty unified WHPP partition must never erase preserved standard membership');
assert.match(source, /WHPP_STANDARD_DAILY_ROWS/, 'zero unified WHPP must first preserve existing standard WHPP daily members');
assert.match(source, /WHPP_FINAL_FACTS_MATCH_HISTORY_TOTAL/, 'a previously erased standard membership may self-heal only from a full fact set matching completed history total');
assert.match(source, /factRows\.length !== expected/, 'partial final facts must never be promoted to membership');
assert.match(source, /business_scan_results/, 'fact-based membership recovery must reuse saved scan region evidence when available');
assert.match(source, /INSERT INTO business_daily_reports/, 'future unified imports must mirror WHPP normalized daily header');
assert.match(source, /INSERT INTO business_daily_parse_rows/, 'future unified imports must mirror WHPP normalized daily members');
assert.match(source, /UNIFIED_IMPORT_ROUTE[\s\S]*ensureV351WhppNormalizedDaily/, 'unified import response must trigger WHPP normalized bridge');
assert.match(source, /DETAIL_ROUTES[\s\S]*\/api\/whpp\/metric-detail/, 'WHPP card drilldown must use the same V351 canonical truth');
assert.match(source, /summary\.dashboard\?\.detailTabs/, 'detail rows must come from the same dashboard used for cards');
assert.match(source, /staleHistoryRejected/, 'stale history mismatch must be observable');
assert.match(source, /MEMBERSHIP_TABLES_ONLY/, 'existing-date repair must be membership-only');
assert.doesNotMatch(source, /saveWhppDailyImport\(/, 'V351 repair must not reset WHPP business state');
const ensureStart = source.indexOf('export function ensureV351WhppNormalizedDaily');
const ensureEnd = source.indexOf('function scheduleNormalizedRepair', ensureStart);
assert.ok(ensureStart >= 0 && ensureEnd > ensureStart, 'V351 normalized repair source must exist');
const ensureSource = source.slice(ensureStart, ensureEnd);
assert.doesNotMatch(ensureSource, /carryover_open_items|shipment_current_state|business_final_rows|business_states|business_export_snapshots|business_run_locks/, 'membership repair must never mutate current/carry/final/snapshot/run truth');
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
assert.equal(dashboard.detailTabs.all.total, 236, 'WHPP 236 card must drill into the same 236 membership rows');
assert.equal(dashboard.detailTabs.pod.total, 200);
assert.equal(dashboard.detailTabs.returned.total, 20);
assert.equal(dashboard.detailTabs.cancelled.total, 5);
assert.equal(dashboard.detailTabs.unresolved.total, 11);
assert.equal(dashboard.accounting.accounted, 236);
assert.equal(dashboard.accounting.difference, 0);
assert.equal(dashboard.accounting.balanced, true);
assert.equal(dashboard.regions.PP.total + dashboard.regions.PV.total + dashboard.regions.UNKNOWN.total, 236);

function fakeDb({ standard = membershipRows, facts = membershipRows, scans = membershipRows, history = 236 } = {}) {
  return {
    prepare(sql) {
      const text = String(sql || '');
      return {
        get(...args) {
          if (/MAX\(reportDate\)/.test(text)) return { reportDate: '2026-08-14' };
          if (/FROM unified_import_batches/.test(text)) return { batchId: 'BATCH-ZERO-WHPP', snapshotId: 'SNAP-ZERO-WHPP', reportDate: '2026-08-14', sourceName: '8-14.xlsx' };
          if (/FROM business_history_summary/.test(text)) return { summaryJson: JSON.stringify({ total: history }) };
          return undefined;
        },
        all(...args) {
          if (/FROM unified_import_rows/.test(text)) return [];
          if (/FROM business_daily_parse_rows/.test(text)) return standard.map(row => ({ shipmentCode: row.shipmentCode, rowJson: JSON.stringify(row) }));
          if (/FROM business_scan_results/.test(text)) return scans.map(row => ({ shipmentCode: row.shipmentCode, rawJson: JSON.stringify({ regionCode: row.regionCode }) }));
          if (/FROM business_final_rows/.test(text)) return facts.map(row => ({ shipmentCode: row.shipmentCode, rawJson: JSON.stringify({ shipmentCode: row.shipmentCode }) }));
          return [];
        }
      };
    }
  };
}

const preservedStandard = loadV351UnifiedWhppMembership('2026-08-14', fakeDb());
assert.equal(preservedStandard.present, true);
assert.equal(preservedStandard.rows.length, 236);
assert.equal(preservedStandard.membershipSource, 'WHPP_STANDARD_DAILY_ROWS');
assert.equal(preservedStandard.recoveredFromPreservedWhpp, true);

const recoveredFacts = loadV351UnifiedWhppMembership('2026-08-14', fakeDb({ standard: [] }));
assert.equal(recoveredFacts.present, true);
assert.equal(recoveredFacts.rows.length, 236);
assert.equal(recoveredFacts.membershipSource, 'WHPP_FINAL_FACTS_MATCH_HISTORY_TOTAL');
assert.equal(recoveredFacts.rows.filter(row => row.regionCode === 'PP').length, 118);
assert.equal(recoveredFacts.rows.filter(row => row.regionCode === 'PV').length, 118);

const partialFacts = loadV351UnifiedWhppMembership('2026-08-14', fakeDb({ standard: [], facts: membershipRows.slice(0, 235), scans: membershipRows.slice(0, 235) }));
assert.equal(partialFacts.present, false, '235/236 preserved facts must not be promoted to WHPP membership');
assert.equal(partialFacts.rows.length, 0);
assert.equal(partialFacts.membershipSource, 'UNIFIED_WHPP_EMPTY_KEEP_STANDARD');

console.log('[V351] WHPP unified-dashboard bridge smoke passed · zero unified WHPP can no longer erase standard membership · erased membership recovers only from complete 236/236 preserved facts with PP/PV region evidence · 235/236 partial facts fail closed · exact 236 cards/drilldowns remain one truth · membership repair only · no DB schema change');
await import('./v352-whpp-visible-single-truth-smoke.mjs');