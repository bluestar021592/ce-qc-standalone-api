const fs=require('fs');
const assert=require('assert/strict');
const {execFileSync}=require('child_process');
const read=p=>fs.readFileSync(p,'utf8');
const ui=read('public/v272-layout-trend-finalizer.js');
const speed=read('public/v274-trend-speed-guard.js');
const inject=read('src/v231MetricTruthUiInjectionPatch.js');
const backend=read('src/v273DashboardTruthReadPatch.js');
const importGuard=read('src/v273ImportCompletenessGuard.js');
const parser=read('src/unifiedExcelParser.js');
for(const file of ['public/v272-layout-trend-finalizer.js','public/v274-trend-speed-guard.js','src/v231MetricTruthUiInjectionPatch.js','src/v273DashboardTruthReadPatch.js','src/v273ImportCompletenessGuard.js','src/unifiedExcelParser.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
assert.doesNotThrow(()=>new Function(ui),'V273 browser runtime must compile');
assert.doesNotThrow(()=>new Function(speed),'V274 trend speed guard must compile');
assert.match(ui,/2026-08-24-v273-single-visible-trend-owner-v1/);
assert.match(ui,/#settingsPage \.settings-grid\{align-items:start!important/,'settings cards must not stretch into blank lower areas');
assert.match(ui,/snapshotFallback\(section,model\)/,'working snapshot must remain visible while background truth refresh runs');
assert.match(ui,/已先显示当前已保存快照，后台正在刷新最近有效日报/,'snapshot-first state must be visible in Chinese');
assert.match(ui,/removeTrendBodies/,'one trend owner must remove old and loading grids before redrawing');
assert.match(ui,/V273_SUPERSEDED_/,'V271 asynchronous visible trend result must be invalidated synchronously');
assert.match(ui,/\/api\/v273\/trends/,'generic and home trends must use ledger-backed truth');
assert.match(ui,/暂无可绘制趋势/,'no-data must be explicit instead of a permanent blank chart');
assert.match(ui,/读取超时，系统将自动重试/,'timeouts must be finite and visible');
assert.match(ui,/SPECIAL=new Set\(\['TBKH','SHOPEECN','SHOPEEVN'\]\)/,'attempt/signing scope must remain exact');
assert.match(ui,/GENERIC=new Set\(\['CE','CEAF','ALI1688','WHPP','ALL'\]\)/,'generic scope must include home ALL and exclude specialized boards');
assert.match(ui,/当前暂无可验证的1\/2\/3派轨迹证据/,'missing attempt evidence must not be drawn as fake zero');
assert.match(ui,/hydrateWhppStandalone/,'WHPP must have an explicit standalone hydration path');
assert.doesNotMatch(ui,/\/api\/v253\/trends\?businessType=WHPP/,'WHPP visible trends must no longer rely on incomplete historical final_rows');
assert.doesNotMatch(ui,/preventDefault\s*\(|stopPropagation\s*\(|stopImmediatePropagation\s*\(/,'V273 must never intercept navigation');

// V274 performance contract: expected daily membership and tracking facts are
// grouped separately. Never join every report member to the large tracking ledger
// on a page request. Startup/background prewarm and a hot memory window keep page
// switches fast while the 2-hour lifecycle remains the source of current state.
assert.match(backend,/v274-ledger-first-hot-seven-business-trends-v2/,'V274 backend must be active');
assert.match(backend,/function expectedUnifiedCounts/,'daily expected totals must be counted independently');
assert.match(backend,/function ledgerFacts/,'tracking truth must be grouped directly from the lifecycle ledger');
assert.doesNotMatch(backend,/unified_import_rows[\s\S]{0,500}JOIN\s+qc_tracking_ledger/i,'page reads must not perform a member-by-member daily-report-to-ledger join');
assert.match(backend,/const CACHE_MS=60_000/,'hot trend facts must remain reusable for one minute');
assert.match(backend,/prewarm\(1200\)/,'recent seven-day facts must prewarm shortly after backend start');
assert.match(backend,/startPeriodicPrewarm/,'hot facts must be refreshed in background instead of on page navigation');
assert.match(backend,/Server-Timing/,'runtime trend duration must be observable');

// V274 is a cleanup guard, not another renderer. It only removes obsolete
// loading-only rows after V273 has supplied the canonical chart row.
assert.match(speed,/2026-08-24-v274-single-row-fast-trend-guard-v1/);
assert.match(speed,/LOADING_RE/,'duplicate loading rows must be identified explicitly');
assert.match(speed,/v272-skeleton-grid/,'obsolete skeleton rows must be removed');
assert.match(speed,/keeps one visible trend row/,'single-row contract must remain documented');
assert.doesNotMatch(speed,/preventDefault\s*\(|stopPropagation\s*\(|stopImmediatePropagation\s*\(/,'V274 must never intercept navigation');

assert.match(inject,/import '\.\/v273DashboardTruthReadPatch\.js';/);
assert.match(inject,/import '\.\/v273ImportCompletenessGuard\.js';/);
assert.match(inject,/v272-layout-trend-finalizer\.js\?v=20260824-v273-1/,'V273 owner cache key must remain');
assert.match(inject,/v274-trend-speed-guard\.js\?v=20260824-v274-1/,'V274 speed guard must load after V273 owner');
const p273=inject.indexOf('V272_LAYOUT_TREND_MARKER');const p274=inject.indexOf('V274_TREND_SPEED_MARKER');assert.ok(p273>=0&&p274>p273,'V274 cleanup guard must be delivered after V273 trend owner');
assert.match(inject,/X-CE-QC-V274-UI/,'V274 must be observable in response headers');

// Final-history reupload contract: parser fixes must be able to repair the exact
// same source workbook, but an incomplete reupload can never replace a larger
// valid day or exchange old bills for different ones. A separate workbook census
// prevents an unknown header/parser edge case from silently losing source bills.
assert.match(importGuard,/V273_SOURCE_WAYBILL_CENSUS_MISMATCH/,'independent workbook census must block parser-side source loss');
assert.match(importGuard,/readV273SourceWaybillCensus/,'source workbook waybills must be counted independently from the normal parser');
assert.match(importGuard,/V273_SAME_DATE_REUPLOAD_SHRINK_BLOCKED/,'smaller same-date reuploads must be rejected');
assert.match(importGuard,/V273_SAME_DATE_MEMBERSHIP_LOSS_BLOCKED/,'same-date reupload must preserve every prior valid waybill, not only the count');
assert.match(importGuard,/V273_REPARSE_PENDING:/,'same source hash must be temporarily released only for a parser-repair reimport');
assert.match(importGuard,/previous\.fileHash===parsed\.fileHash&&comparison\.difference>0/,'same file must be reparsed when the fixed parser recovers more waybills');
assert.match(importGuard,/handlers\.slice\(0,last\),guard,responseTruth,handlers\[last\]/,'completeness guard must run after upload middleware and before final import handler');
assert.match(importGuard,/recoverInterruptedSameHashRepairs/,'interrupted same-file repair must recover safely on startup');
assert.match(importGuard,/process\.env\.NODE_ENV!==['"]test['"]&&!process\.env\.CI/,'gate tests must never run recovery against the real production database');
assert.match(parser,/NOT_FOUND_OPTIONAL/,'recipient column may be absent without silently discarding a whole sheet');
assert.match(parser,/hasShipmentValues/,'sheet discovery must be driven by actual waybill presence');
assert.doesNotMatch(parser,/shipmentIndex < 0 \|\| recipientIndex < 0/,'recipient-column absence must no longer skip the sheet');

execFileSync(process.execPath,['scripts/v273-trend-import-integrity-smoke.mjs'],{stdio:'inherit'});
console.log('[V274/V273] ledger-first hot trends + single visible row + source census + final reupload protection gate passed');
