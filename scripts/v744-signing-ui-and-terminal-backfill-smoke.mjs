import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dailyReportProvesPod, extractDailyReportSigningEvidence } from '../src/dailyReportSigningTiming.js';

const html=fs.readFileSync('public/v625-shell.html','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const home=fs.readFileSync('src/homeQualitySummary.js','utf8');
const diag=fs.readFileSync('src/v745WhppTimingSourceDiagnostics.js','utf8');
const launcher=fs.readFileSync('tools/CE_QC_Managed_Launcher.ps1','utf8');


assert.doesNotMatch(html,/1派平均签收|2派平均签收|3派平均签收/,'home signing overview must not render 1/2/3 attempt cards');
assert.doesNotMatch(html,/v625-attempt-grid/,'obsolete attempt-signing grid must be removed from the home shell');
assert.doesNotMatch(shell,/prefix\+'A1'|prefix\+'A2'|prefix\+'A3'/,'home renderer must not update removed 1/2/3 attempt cards');

assert.equal(dailyReportProvesPod({'状态说明':'POD'}),true,'explicit POD description must be accepted');
assert.equal(dailyReportProvesPod({orderStatus:'85'}),true,'orderStatus 85 must be accepted as POD');
assert.equal(dailyReportProvesPod({shipmentStatus:'60'}),true,'shipmentStatus 60 must be accepted as POD');
assert.equal(dailyReportProvesPod({'状态说明':'未签收'}),false,'negative signing description must never become POD');
assert.equal(dailyReportProvesPod({'状态说明':'RETURNED'}),false,'returned status must never become POD signing evidence');

const whppLike=extractDailyReportSigningEvidence({
  bookingDate:'2026-07-01 08:00:00',
  deliveryTime:'2026-07-03 18:00:00',
  orderStatus:'85'
});
assert.equal(whppLike.ok,true,'terminal WHPP-like daily row with order and delivery time must produce signing evidence');
assert.equal(whppLike.days,3);

assert.match(home,/if\(!obsByBill\.has\(bill\)\)obsByBill\.set\(bill,\[\]\)/,'later-report backfill must retain all observations per waybill');
assert.match(home,/for\(const row of candidates\)/,'backfill must scan newest-to-older observations until a valid terminal signing row is found');
assert.match(shell,/当日无POD/,'zero-POD boards must explain why no signing average exists');
assert.match(html,/V750_TIMING_EVIDENCE_TRACK_VIEW|V748_PER_BOARD_TRACK_QUALITY_SIGNALS|V744_SIGNING_UI_SIMPLIFIED_AND_TERMINAL_BACKFILL/,'V744+ shell marker missing');
assert.match(html,/v625-shell\.js\?v=20261007-v(?:744|748|750)-1/,'V744+ cache bust missing');

assert.match(home,/FROM business_daily_parse_rows[\s\S]*businessType='WHPP'/,'V746 WHPP signing must read canonical business_daily_parse_rows fallback');
assert.match(home,/latest_whpp_daily_parse_delivery_time/,'V746 later WHPP daily backfill source missing');
assert.match(diag,/legacyObservationRows/,'V746 diagnostic must expose WHPP canonical daily-row coverage');
assert.match(launcher,/currentDependencyMetadata/,'V747 dependency-aware updater comparison missing');
assert.match(launcher,/Dependency graph unchanged; reusing installed node_modules/,'V747 offline-safe module reuse missing');

assert.match(html,/data-kpi-detail="shopArrived"/,'V748 store-arrival KPI missing');
assert.match(html,/data-kpi-detail="pendingGap"/,'V748 Pending-gap KPI missing');
assert.match(html,/data-kpi-detail="oc2Plus"/,'V748 OC2+ KPI missing');
assert.match(shell,/\/api\/v246\/tracking\/reconcile/,'V748 board precision track refresh must use V246 reconcile');
assert.match(shell,/v748QualityRefreshKeys\.clear\(\)/,'V748 latest store list import must invalidate prior track-quality refresh');
assert.match(shell,/source=timing-backfill/,'timing backfill detail must tag trajectory navigation context');
assert.match(shell,/orderStatus=85；这是终态状态证据/,'empty-track page must surface WHPP confirm-query POD status');
assert.match(shell,/状态证据（不等同于轨迹时间）/,'tracking page must distinguish terminal status evidence from real trajectory time');
assert.match(shell,/currentParams\(\)\.get\('source'\)/,'tracking page must retain timing-backfill context');
assert.match(shell,/strongTerminalPod/,'terminal POD status must outrank stale open retry ledger state in track view');
assert.match(shell,/API_PENDING_RETRY\|PENDING_RETRY\|待重试/,'stale retry ledger evidence must be suppressed once terminal POD is proven');

console.log('[V744/V745/V746/V747/V748] signing UI + WHPP canonical timing + offline-safe updater + per-board store/Pending-gap/OC2+ trajectory quality passed');
