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
const v319 = fs.readFileSync(path.join(root, 'src', 'v319TrendCacheFastPatch.js'), 'utf8');
const homeTrendOwner = fs.readFileSync(path.join(root, 'public', 'v253-dashboard-fast-owner.js'), 'utf8');
const shopeeTrendOwner = fs.readFileSync(path.join(root, 'public', 'v244-shopee-trend-owner.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const v263GenericOwner = fs.readFileSync(path.join(root, 'public', 'v263-generic-trend-hydrator.js'), 'utf8');
const v272VisibleOwner = fs.readFileSync(path.join(root, 'public', 'v272-layout-trend-finalizer.js'), 'utf8');
const firstAttemptUi = fs.readFileSync(path.join(root, 'public', 'v295-first-attempt-ui.js'), 'utf8');
const firstAttemptInjection = fs.readFileSync(path.join(root, 'src', 'v295FirstAttemptUiInjectionPatch.js'), 'utf8');

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


test('browser auto-trends never enter V263/V246 evidence paths', () => {
  assert.match(homeTrendOwner, /\/api\/v319\/trends\?businessType=SHOPEECN/);
  assert.match(homeTrendOwner, /\/api\/v319\/trends\?businessType=SHOPEEVN/);
  assert.doesNotMatch(homeTrendOwner, /\/api\/v263\/delivery-trends/);
  assert.match(shopeeTrendOwner, /\/api\/v319\/trends\?businessType=/);
  assert.doesNotMatch(shopeeTrendOwner, /\/api\/v246\/shopee-trends\?/);
});

test('V319 three-business browser route is a saved-cache SELECT path with no repair scheduling', () => {
  assert.match(v319, /readV236CurrentSummary\(date,\{cacheOnly:true\}\)/);
  assert.match(v319, /v329_three_business_daily_cache/);
  assert.doesNotMatch(v319, /readV308DeliveryDaily/);
  assert.doesNotMatch(v319, /requestV328EvidenceRepair|requestV263DeliveryEvidenceBackfill/);
  assert.match(v319, /GET不建表、不修复证据、不扫描历史大表、不跑轨迹/);
});

test('ordinary navigation never requests non-compact aggregate state', () => {
  assert.match(appJs, /const needsFullAggregate = false/);
  assert.match(appJs, /api\('\/api\/state\?compact=1'\)/);
  assert.match(appJs, /api\('\/api\/shopee\/state\?compact=1'\)/);
  const hydration = appJs.match(/async function hydratePageData\(page\) \{[\s\S]*?\n\}/);
  assert.ok(hydration, 'hydratePageData must exist');
  assert.doesNotMatch(hydration[0], /api\('\/api\/state'\)/);
  assert.doesNotMatch(hydration[0], /api\('\/api\/shopee\/state'\)/);
});


test('all active visible trend owners read V319 saved caches instead of delayed heavy truth routes', () => {
  assert.match(v263GenericOwner, /\/api\/v319\/trends\?businessType=/);
  assert.doesNotMatch(v263GenericOwner, /\/api\/v253\/trends\?businessType=/);
  assert.match(v272VisibleOwner, /function fastUrl\(type,rg\)\{return`\/api\/v319\/trends/);
  assert.match(v272VisibleOwner, /function strictUrl\(type,rg\)\{return`\/api\/v319\/trends/);
  assert.doesNotMatch(v272VisibleOwner, /\/api\/v263\/delivery-trends/);
  assert.doesNotMatch(v272VisibleOwner, /\/api\/v273\/trends\?businessType=/);
});

test('automatic first-attempt UI never enters V295 row-level truth SQL', () => {
  assert.match(firstAttemptUi, /const FIRST_ATTEMPT_API='\/api\/v319\/trends'/);
  assert.match(firstAttemptUi, /if\(!HISTORY_TYPES\.has\(type\)\).*lastPayload=null;return;/);
  assert.doesNotMatch(firstAttemptUi, /\/api\/v295\/first-attempt-trends/);
  assert.match(firstAttemptInjection, /v295-first-attempt-ui\.js\?v=20260918-stability-cache-1/);
  assert.match(v319, /firstAttemptEligible/);
  assert.match(v319, /firstAttemptEvidenceComplete/);
});
