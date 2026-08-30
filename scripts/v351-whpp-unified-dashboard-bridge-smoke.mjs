import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildV351WhppDashboard, loadV351UnifiedWhppMembership, V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID } from '../src/v351WhppUnifiedDashboardBridgePatch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'v351WhppUnifiedDashboardBridgePatch.js'), 'utf8').replace(/\r\n/g, '\n');
const v85 = fs.readFileSync(path.join(__dirname, '..', 'src', 'v85ShopeeWhppMetricPatch.js'), 'utf8').replace(/\r\n/g, '\n');
const v132 = fs.readFileSync(path.join(__dirname, '..', 'src', 'v132WhppFastIntegrationPatch.js'), 'utf8').replace(/\r\n/g, '\n');
const v161 = fs.readFileSync(path.join(__dirname, '..', 'src', 'v161UnifiedImportRuntimeTruthPatch.js'), 'utf8').replace(/\r\n/g, '\n');
const v42 = fs.readFileSync(path.join(__dirname, '..', 'src', 'v42WhppPatch.js'), 'utf8').replace(/\r\n/g, '\n');
const v94 = fs.readFileSync(path.join(__dirname, '..', 'src', 'v94UnifiedImportDisplayTruthPatch.js'), 'utf8').replace(/\r\n/g, '\n');
for (const relative of [
  '../src/v42WhppPatch.js',
  '../src/v94UnifiedImportDisplayTruthPatch.js',
  '../src/v132WhppFastIntegrationPatch.js',
  '../src/v161UnifiedImportRuntimeTruthPatch.js',
  '../src/v351WhppUnifiedDashboardBridgePatch.js',
  '../src/shopeeHistoricalSigningTruth.js',
  './v329-three-business-cache-worker.mjs'
]) execFileSync(process.execPath, ['--check', path.join(__dirname, relative)], { stdio: 'pipe' });

assert.match(V351_WHPP_UNIFIED_DASHBOARD_BRIDGE_ID, /v351-whpp-safe-history-disaster-fallback/);
assert.match(v85, /import '\.\/v351WhppUnifiedDashboardBridgePatch\.js';/, 'V351 disaster/history fallback must remain available before server route registration');

// Fresh/current WHPP truth must be correct before V351 is needed. V366 changed
// the primary import from an early VALID save into one atomic sequence:
// integrity preflight -> STAGING -> CCSL -> SHOPEE -> WHPP rehydrate/import ->
// VALID activation -> persisted seven-business verification. Keep this smoke
// aligned with that production contract while preserving every history/disaster
// fallback assertion below.
assert.match(v42, /function existingWhppDailyMembership\(reportDate\)/, 'V42 must verify an existing same-date WHPP cohort before an empty reimport can overwrite it');
assert.match(v42, /headerPresent: true, present, incomplete: !present/, 'V42 preflight must distinguish an absent WHPP header from a damaged existing header');
assert.match(v42, /const present = actual === expected/, 'V42 must treat exact header/member equality as complete, including an explicit 0\/0 day');
assert.doesNotMatch(v42, /expected > 0 && actual === expected/, 'V42 must never demote a confirmed 0\/0 WHPP day into a missing cohort');
assert.match(v42, /const preservedWhpp = whppRows\.length === 0[\s\S]*existingWhppDailyMembership\(parsed\.reportDate\)/, 'empty WHPP partitions must inspect preserved standard membership before persistence');
assert.match(v42, /if \(whppRows\.length === 0 && preservedWhpp\.headerPresent && preservedWhpp\.incomplete\)/, 'damaged existing WHPP plus incoming zero WHPP must fail closed');
assert.match(v42, /error\.code = 'WHPP_STANDARD_DAILY_INCOMPLETE'/, 'V42 must expose the same explicit incomplete-membership error used by current readers');
assert.match(v42, /已阻止空WHPP日报覆盖/, 'V42 error must make the destructive overwrite prevention observable');
const v42PreflightIndex = v42.indexOf('const preservedWhpp = whppRows.length === 0');
const v42GuardIndex = v42.indexOf("error.code = 'WHPP_STANDARD_DAILY_INCOMPLETE'");
const v42CoreProjectionIndex = v42.indexOf('const coreParsed = coreProjection(parsed, coreRows)');
const v42StageIndex = v42.indexOf('staged = stageUnifiedCoreImport(coreParsed, req.file.originalname)');
const v42CcslInitIndex = v42.indexOf('initializeCcslState(parsed.reportDate');
const v42ShopeeInitIndex = v42.indexOf('initializeShopeeState(parsed.reportDate');
const v42WhppRehydrateIndex = v42.indexOf('const preservedRows = loadPreservedWhppDailyRows(parsed.reportDate)');
const v42ActivateIndex = v42.indexOf('const releasedSupersededSlots = activateUnifiedCoreImport(staged)');
const v42VerifyIndex = v42.indexOf('const verification = verifyAtomicImportPersistence');
assert.ok(v42PreflightIndex >= 0 && v42GuardIndex > v42PreflightIndex, 'WHPP integrity preflight must exist before the blocking error branch');
assert.ok(v42CoreProjectionIndex > v42GuardIndex, 'WHPP integrity guard must run before core snapshot projection/write preparation');
assert.ok(v42StageIndex > v42CoreProjectionIndex, 'validated six-business core must enter STAGING before any current-date state is published');
assert.ok(v42CcslInitIndex > v42StageIndex, 'CCSL queue/state must initialize only after the atomic STAGING snapshot exists');
assert.ok(v42ShopeeInitIndex > v42CcslInitIndex, 'SHOPEE queue/state must initialize after CCSL within the same atomic import');
assert.ok(v42WhppRehydrateIndex > v42ShopeeInitIndex, 'preserved target-date WHPP membership must be rehydrated only after CCSL and SHOPEE are ready');
assert.ok(v42ActivateIndex > v42WhppRehydrateIndex, 'unified batch must not become VALID before WHPP target-date state is rebuilt');
assert.ok(v42VerifyIndex > v42ActivateIndex, 'seven-business persisted truth must be re-read only after VALID activation');
assert.match(v42, /if \(preservedWhpp\.present\)[\s\S]*loadPreservedWhppDailyRows\(parsed\.reportDate\)[\s\S]*saveWhppDailyImport\(\{[\s\S]*rows: preservedRows[\s\S]*REHYDRATED_EXISTING_COMPLETE_DAILY_MEMBERSHIP/, 'a complete preserved WHPP cohort must be rehydrated into the target-date WHPP current state instead of leaving the previous day active');
assert.match(v42, /else \{[\s\S]*saveWhppDailyImport\(\{[\s\S]*rows: whppRows[\s\S]*DIRECT_CONFIRMED_ZERO_WHPP_DAILY_IMPORT/, 'direct WHPP or confirmed-zero days must still initialize the WHPP target-date state');
assert.match(v42, /invalidateMutableSameDatePointers\(parsed\.reportDate, \{ whppChanged: true \}\)/, 'a rebuilt WHPP target-date state must invalidate same-date WHPP run/history pointers before activation');
assert.match(v42, /if \(whppChanged\) \{[\s\S]*businessType='WHPP'/, 'WHPP run/history invalidation must remain scoped behind the explicit WHPP-changed flag');
assert.match(v42, /classificationCounts: effectiveCounts/, 'immediate import response must publish effective seven-business WHPP truth, not parser zero after preservation');
assert.match(v42, /importCommitted: true/, 'browser commit acknowledgement must exist only after the persisted seven-business verification path');

assert.doesNotMatch(v94, /v216WhppImportParityPatch/, 'retired V216 response repair must not remain in the runtime import chain');
assert.match(v94, /const directWhpp = num\(directCounts\.WHPP\)/, 'V94 immediate import display must preserve V42 direct/effective WHPP count');
assert.match(v94, /V94_DIRECT_IMPORT_WHPP_CANONICAL_OTHERS/, 'V94 must disclose direct WHPP ownership');

assert.match(v161, /function directWhppMembership\(reportDate = ''\)/, 'bootstrap/unified-latest must own direct same-day WHPP membership instead of reading WHPP from the six-business unified rows');
assert.match(v161, /FROM business_daily_reports WHERE businessType='WHPP'/, 'V161 must read the normalized WHPP daily header directly');
assert.match(v161, /FROM business_daily_parse_rows WHERE businessType='WHPP'/, 'V161 must verify direct normalized WHPP daily members');
assert.match(v161, /if \(expected === actual\)/, 'V161 must treat exact header/member equality as authoritative, including zero');
assert.match(v161, /WHPP_STANDARD_DAILY_ZERO/, 'exact persisted zero must remain a real zero rather than invoking historical recovery');
assert.match(v161, /WHPP_STANDARD_DAILY_INCOMPLETE_FAIL_CLOSED/, 'incomplete standard membership must fail closed instead of publishing a partial total');
assert.match(v161, /loadV351UnifiedWhppMembership\(date, db\)/, 'V161 may use V351 only for old/erased history fallback');
assert.match(v161, /counts\.WHPP = num\(whpp\.count\)/, 'seven-business runtime count must join direct WHPP truth into the six legacy partitions');
assert.match(v161, /SIX_LEGACY_UNIFIED_PARTITIONS_PLUS_DIRECT_WHPP_DAILY/, 'seven-business source reconciliation must expose its actual ownership model');

assert.match(v132, /import \{ loadV351UnifiedWhppMembership \} from '\.\/v351WhppUnifiedDashboardBridgePatch\.js';/, 'V132 must retain V351 only as safe historical fallback');
assert.match(v132, /const present=expected===rows\.length/, 'V132 standard membership must require exact header/member equality, including zero');
assert.match(v132, /WHPP_STANDARD_DAILY_ZERO/, 'V132 must preserve an exact persisted zero');
assert.match(v132, /const standard=loadStandardMembership\(db,reportDate\);[\s\S]*const unified=standard\.present\?[\s\S]*:loadUnifiedMembership\(db,reportDate\)/, 'V132 visible summary must read standard WHPP daily membership before V351 fallback');
assert.match(v132, /const membership=loadV351UnifiedWhppMembership\(reportDate,db\)/, 'V132 fallback helper must still delegate erased-history recovery to V351');

// V351 is now a disaster/history bridge, not the normal fresh-import owner.
assert.match(source, /unified_import_batches[\s\S]*status='VALID'/, 'V351 fallback must still inspect the latest VALID unified import');
assert.match(source, /if \(!batch\)[\s\S]*loadPreservedWhppMembership\(date, db\)/, 'missing VALID unified batch must still recover preserved WHPP truth');
assert.match(source, /if \(rows\.length\)[\s\S]*LATEST_VALID_UNIFIED_MEMBERSHIP/, 'only a non-empty WHPP unified partition may become authoritative');
assert.match(source, /WHPP_STANDARD_DAILY_ROWS/, 'a complete preserved standard WHPP cohort may be used by disaster fallback');
assert.match(source, /WHPP_STANDARD_DAILY_ZERO/, 'exact zero must remain explicit in V351 rather than being guessed from history');
assert.match(source, /WHPP_STANDARD_DAILY_INCOMPLETE_FAIL_CLOSED/, 'partial normalized membership must be rejected at the V351 fallback boundary');
assert.match(source, /const present = expected === actual/, 'V351 standard cohort validation must compare declared header count with distinct rows exactly');
assert.match(source, /standard\.daily && !standard\.present[\s\S]*WHPP_STANDARD_DAILY_INCOMPLETE_FAIL_CLOSED/, 'V351 must fail closed before any fact-based recovery when the standard header exists but is incomplete');
assert.match(source, /WHPP_FINAL_FACTS_MATCH_HISTORY_TOTAL/, 'a previously erased standard membership may self-heal only from a full fact set matching completed history total');
assert.match(source, /factRows\.length !== expected/, 'partial final facts must never be promoted to membership');
assert.match(source, /business_scan_results/, 'fact-based membership recovery must reuse saved scan region evidence when available');
assert.match(source, /if \(standard\.daily && !standard\.present\)[\s\S]*repaired: false[\s\S]*STANDARD_DAILY_INCOMPLETE_FAIL_CLOSED/, 'automatic V351 repair must refuse to rewrite a conflicting standard cohort');
assert.match(source, /if \(standard\.present\)[\s\S]*STANDARD_DAILY_CURRENT_ZERO[\s\S]*STANDARD_DAILY_CURRENT/, 'normal complete standard membership, including exact zero, must not be rewritten');
assert.match(source, /INSERT INTO business_daily_reports/, 'disaster repair must still restore a genuinely missing normalized WHPP daily header');
assert.match(source, /INSERT INTO business_daily_parse_rows/, 'disaster repair must still restore genuinely missing normalized WHPP daily members');
assert.match(source, /MISSING_MEMBERSHIP_TABLES_ONLY/, 'V351 repair write scope must be limited to missing membership tables');
assert.match(source, /UNIFIED_IMPORT_ROUTE[\s\S]*ensureV351WhppNormalizedDaily/, 'import bridge may audit/repair only after the primary V42 write is complete');
assert.match(source, /DETAIL_ROUTES[\s\S]*\/api\/whpp\/metric-detail/, 'legacy WHPP card drilldown fallback must use the same V351 canonical truth');
assert.match(source, /summary\.dashboard\?\.detailTabs/, 'fallback detail rows must come from the same dashboard used for cards');
assert.match(source, /staleHistoryRejected/, 'stale history mismatch must be observable');
assert.doesNotMatch(source, /saveWhppDailyImport\(/, 'V351 disaster repair must never reset WHPP business state');
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

function fakeDb({ standard = membershipRows, standardHeader = true, standardTotal = standard.length, facts = membershipRows, scans = membershipRows, history = 236, batchPresent = true } = {}) {
  return {
    prepare(sql) {
      const text = String(sql || '');
      return {
        get() {
          if (/MAX\(reportDate\)/.test(text)) return { reportDate: '2026-08-14' };
          if (/FROM unified_import_batches/.test(text)) return batchPresent ? { batchId: 'BATCH-ZERO-WHPP', snapshotId: 'SNAP-ZERO-WHPP', reportDate: '2026-08-14', sourceName: '8-14.xlsx' } : undefined;
          if (/FROM business_daily_reports/.test(text)) return standardHeader ? { reportDate: '2026-08-14', sourceFile: 'WHPP.xlsx', totalCount: standardTotal, summaryJson: '{}' } : undefined;
          if (/FROM business_history_summary/.test(text)) return { summaryJson: JSON.stringify({ total: history }) };
          return undefined;
        },
        all() {
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

const exactZero = loadV351UnifiedWhppMembership('2026-08-14', fakeDb({ standard: [], standardHeader: true, standardTotal: 0, facts: [], scans: [], history: 0 }));
assert.equal(exactZero.present, false, 'exact zero fallback cohort is intentionally empty');
assert.equal(exactZero.rows.length, 0);
assert.equal(exactZero.membershipSource, 'WHPP_STANDARD_DAILY_ZERO', 'exact standard zero must stay explicit and must not revive old history');

const incompleteStandard = loadV351UnifiedWhppMembership('2026-08-14', fakeDb({ standard: membershipRows.slice(0, 235), standardHeader: true, standardTotal: 236, facts: membershipRows, scans: membershipRows }));
assert.equal(incompleteStandard.present, false, '235/236 standard membership must fail closed even when 236 historical facts still exist');
assert.equal(incompleteStandard.rows.length, 0);
assert.equal(incompleteStandard.membershipSource, 'WHPP_STANDARD_DAILY_INCOMPLETE_FAIL_CLOSED');
assert.equal(incompleteStandard.expected, 236);
assert.equal(incompleteStandard.actual, 235);

const recoveredFacts = loadV351UnifiedWhppMembership('2026-08-14', fakeDb({ standard: [], standardHeader: false }));
assert.equal(recoveredFacts.present, true);
assert.equal(recoveredFacts.rows.length, 236);
assert.equal(recoveredFacts.membershipSource, 'WHPP_FINAL_FACTS_MATCH_HISTORY_TOTAL');
assert.equal(recoveredFacts.rows.filter(row => row.regionCode === 'PP').length, 118);
assert.equal(recoveredFacts.rows.filter(row => row.regionCode === 'PV').length, 118);

const noBatchRecoveredFacts = loadV351UnifiedWhppMembership('2026-08-14', fakeDb({ standard: [], standardHeader: false, batchPresent: false }));
assert.equal(noBatchRecoveredFacts.batchPresent, false, 'production regression fixture has no VALID unified batch');
assert.equal(noBatchRecoveredFacts.present, true, 'no VALID unified batch must still recover exact preserved WHPP facts when the standard header is genuinely missing');
assert.equal(noBatchRecoveredFacts.rows.length, 236);
assert.equal(noBatchRecoveredFacts.membershipSource, 'WHPP_FINAL_FACTS_MATCH_HISTORY_TOTAL');

const partialFacts = loadV351UnifiedWhppMembership('2026-08-14', fakeDb({ standard: [], standardHeader: false, facts: membershipRows.slice(0, 235), scans: membershipRows.slice(0, 235) }));
assert.equal(partialFacts.present, false, '235/236 preserved facts must not be promoted to WHPP membership');
assert.equal(partialFacts.rows.length, 0);
assert.equal(partialFacts.membershipSource, 'UNIFIED_WHPP_EMPTY_KEEP_STANDARD');

const noBatchPartialFacts = loadV351UnifiedWhppMembership('2026-08-14', fakeDb({ standard: [], standardHeader: false, facts: membershipRows.slice(0, 235), scans: membershipRows.slice(0, 235), batchPresent: false }));
assert.equal(noBatchPartialFacts.present, false, 'missing batch must not weaken exact-count safety');
assert.equal(noBatchPartialFacts.membershipSource, 'NO_VALID_UNIFIED_BATCH');

console.log('[V351] WHPP source-truth smoke passed · V42 blocks damaged same-date WHPP before STAGING · preserved target-date WHPP is rehydrated before VALID activation · persisted seven-business truth is verified after activation · V94 no V216 repair · V161 direct standard daily first · V351 disaster/history fallback only when standard header is missing · exact 236/236 facts recover · partial facts fail closed');
await import('./v352-whpp-visible-single-truth-smoke.mjs');
await import('./whpp-visible-truth-smoke.mjs');
await import('./shopee-history-region-signing-smoke.mjs');