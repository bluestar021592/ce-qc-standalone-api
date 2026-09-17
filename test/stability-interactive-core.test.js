import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const facade = fs.readFileSync(path.join(root, 'src', 'rangeDashboardStore.js'), 'utf8');
const interactive = fs.readFileSync(path.join(root, 'src', 'rangeDashboardStoreInteractive.js'), 'utf8');
const finalStore = fs.readFileSync(path.join(root, 'src', 'rangeDashboardStoreFinal.js'), 'utf8');
const v320 = fs.readFileSync(path.join(root, 'src', 'rangeDashboardStoreV320.js'), 'utf8');

test('interactive facade uses the bounded interactive range owner', () => {
  assert.match(facade, /export \{ loadRangeDashboard \} from '\.\/rangeDashboardStoreInteractive\.js';/);
  assert.doesNotMatch(facade, /export \{ loadRangeDashboard \} from '\.\/rangeDashboardStoreFinal\.js';/);
});

test('V386 dirty-cache safety remains intact while business facts stay outside the invalidation scope', () => {
  const statusBlock = facade.match(/export function getDashboardCacheStatus\(\) \{[\s\S]*?\n\}/);
  assert.ok(statusBlock, 'getDashboardCacheStatus block must exist');
  assert.match(statusBlock[0], /invalidateV386DirtyDashboardCaches\(\);/);
  assert.match(statusBlock[0], /return getDashboardCacheStatusLegacy\(\);/);
  assert.match(facade, /DELETE FROM dashboard_cache_dates/);
  assert.match(facade, /DELETE FROM dashboard_daily_cache/);
  assert.doesNotMatch(facade, /DELETE FROM (?:final_rows|business_final_rows|unified_import_rows|scan_results|track_events|business_scan_results|business_track_events)/);
});

test('single-day interactive read uses V320 cache-only path and never enters row-level final normalization', () => {
  assert.match(interactive, /if \(from && to && from === to\)/);
  assert.match(interactive, /loadRangeDashboardV320\(from, to\)/);
  assert.match(interactive, /PRECOMPUTED_DASHBOARD_CACHE_ONLY/);
  assert.match(interactive, /requestTimeShipmentScan: false/);
  const singleDayBlock = interactive.match(/if \(from && to && from === to\) \{[\s\S]*?\n  \}/);
  assert.ok(singleDayBlock, 'single-day branch must exist');
  assert.doesNotMatch(singleDayBlock[0], /loadRangeDashboardFinal/);
  assert.doesNotMatch(singleDayBlock[0], /getDb\(/);
});

test('V320 single-day source remains cacheOnly and the heavyweight final owner stays isolated to explicit range reads', () => {
  assert.match(v320, /readV236CurrentSummary\(date,\{cacheOnly:true\}\)/);
  assert.match(v320, /singleDayCacheOnly:true/);
  assert.match(finalStore, /queryCcslAdjustments\(range\.fromDate, range\.toDate\)/);
  assert.match(finalStore, /queryShopeeAdjustments\(range\.fromDate, range\.toDate\)/);
  assert.match(interactive, /loadRangeDashboardFinal\(fromDate, toDate\)/);
});

test('interactive stability owner is read-only and never rewrites business facts or schema', () => {
  assert.doesNotMatch(interactive, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i);
});
