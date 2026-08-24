const fs=require('fs');
const assert=require('assert/strict');
const {execFileSync}=require('child_process');
const read=p=>fs.readFileSync(p,'utf8');
const ui=read('public/v272-layout-trend-finalizer.js');
const speed=read('public/v274-trend-speed-guard.js');
const inject=read('src/v231MetricTruthUiInjectionPatch.js');
const delivery=read('src/v89StaticAssetCachePatch.js');
const backend=read('src/v273DashboardTruthReadPatch.js');
const importGuard=read('src/v273ImportCompletenessGuard.js');
const parser=read('src/unifiedExcelParser.js');
for(const file of ['public/v272-layout-trend-finalizer.js','public/v274-trend-speed-guard.js','src/v231MetricTruthUiInjectionPatch.js','src/v89StaticAssetCachePatch.js','src/v273DashboardTruthReadPatch.js','src/v273ImportCompletenessGuard.js','src/unifiedExcelParser.js'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
assert.doesNotThrow(()=>new Function(ui),'V273 browser runtime must compile');
assert.doesNotThrow(()=>new Function(speed),'V275 compatibility asset must compile');
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

assert.match(backend,/v274-ledger-first-hot-seven-business-trends-v3/,'V274 backend must be active');
assert.match(backend,/function expectedUnifiedCounts/,'daily expected totals must be counted independently');
assert.match(backend,/function ledgerFacts/,'tracking truth must be grouped directly from the lifecycle ledger');
assert.doesNotMatch(backend,/unified_import_rows[\s\S]{0,500}JOIN\s+qc_tracking_ledger/i,'page reads must not perform a member-by-member daily-report-to-ledger join');
assert.match(backend,/const CACHE_MS=60_000/,'hot trend facts must remain reusable for one minute');
assert.match(backend,/prewarm\(1200\)/,'recent seven-day facts must prewarm shortly after backend start');
assert.match(backend,/startPeriodicPrewarm/,'hot facts must be refreshed in background instead of on page navigation');
assert.match(backend,/Server-Timing/,'runtime trend duration must be observable');

assert.match(speed,/2026-08-24-v275-fast-import-confirmation-and-trend-guard-v1/);
assert.match(speed,/waitForCommittedImport/);
assert.doesNotMatch(speed,/preventDefault\s*\(|stopPropagation\s*\(|stopImmediatePropagation\s*\(/,'V275 asset must never intercept navigation');

assert.match(inject,/import '\.\/v273DashboardTruthReadPatch\.js';/);
assert.match(inject,/import '\.\/v273ImportCompletenessGuard\.js';/);
assert.match(inject,/v272-layout-trend-finalizer\.js\?v=20260824-v273-1/,'V273 owner cache key must remain');
assert.match(inject,/X-CE-QC-V274-UI/,'V274 guard must remain observable in response headers');

// V280 keeps the V279 single-parse + post-COMMIT acknowledgement path, and fixes
// Excel workbooks whose stored !ref is much larger than their real populated area.
// Import observability must identify request/upload/census/parse/commit boundaries.
assert.match(delivery,/2026-08-24-v280-sparse-excel-precommit-observability-v1/,'V280 sparse-range backend patch must be active');
assert.doesNotMatch(delivery,/express\.response\.sendFile\s*=/,'V280 must preserve native SPA sendFile');
assert.doesNotMatch(delivery,/V275_DIRECT_MARKER/,'V280 must not inject V275 into index.html');
assert.match(delivery,/express\.application\.post\s*=\s*function v280FastUnifiedImportPost/,'V280 must replace only unified import final handler');
assert.match(delivery,/observeUnifiedImportRequest/,'V280 must timestamp the request before multer receives the upload');
assert.match(delivery,/V280_IMPORT_REQUEST_START/,'request-start stage must be observable');
assert.match(delivery,/V280_IMPORT_UPLOAD_DONE/,'upload-complete stage must be observable');
assert.match(delivery,/V280_IMPORT_COMMIT_START/,'COMMIT start stage must be observable');
assert.match(delivery,/V280_IMPORT_COMMIT_DONE/,'COMMIT completion must be observable');
assert.match(delivery,/req\.v280UnifiedParsed \|\| req\.v279UnifiedParsed \|\| parseUnifiedDailyExcel/,'V280 must reuse V273 validated parse and only fall back defensively');
assert.match(delivery,/reusedValidatedParse/,'V280 response must expose whether duplicate parsing was eliminated');
assert.match(delivery,/sqliteCommitMs/,'SQLite COMMIT duration must be observable');
assert.match(delivery,/const saved = saveUnifiedImport\(parsed, req\.file\.originalname\)/,'SQLite durable save must occur before acknowledgement');
assert.match(delivery,/compatibilityPending: true, ack: 'SQLITE_COMMITTED'/,'response must explicitly identify post-COMMIT acknowledgement boundary');
assert.match(delivery,/setImmediate\(\(\) => \{ void finishUnifiedCompatibility/,'slow compatibility state saves must continue after response');
assert.match(delivery,/V280_IMPORT_COMPAT_DONE/,'background compatibility completion must be observable');
assert.match(delivery,/CORE_LIVE_ASSET_RE/,'core cache-reset protection must remain');

assert.match(importGuard,/2026-08-24-v280-sparse-excel-range-import-v7/,'V280 sparse Excel import guard must be active');
assert.match(importGuard,/CELL_ADDRESS_RE/,'sparse census must enumerate actual worksheet cells');
assert.match(importGuard,/scannedCells/,'sparse census must expose actual scanned cell count');
assert.match(importGuard,/originalRef/,'inflated source !ref must be observable');
assert.match(importGuard,/safeRange/,'derived safe worksheet range must be observable');
assert.match(importGuard,/withSparseSheetToJson/,'formal parser must be clamped to actual meaningful cells');
assert.match(importGuard,/range: sparse\.range/,'sheet_to_json must receive derived sparse safe range');
assert.match(importGuard,/V280_IMPORT_GUARD_START/,'post-upload guard start must be observable');
assert.match(importGuard,/V280_IMPORT_CENSUS_START/,'census start must be observable');
assert.match(importGuard,/V280_IMPORT_CENSUS_DONE/,'census end must be observable');
assert.match(importGuard,/V280_IMPORT_PARSE_START/,'formal parse start must be observable');
assert.match(importGuard,/V280_IMPORT_PARSE_DONE/,'formal parse end must be observable');
assert.match(importGuard,/V280_IMPORT_PRECOMMIT/,'pre-COMMIT aggregate timing must be observable');
assert.match(importGuard,/req\.v279UnifiedParsed\s*=\s*parsed/,'validated parse must still be handed to final handler');
assert.match(importGuard,/V273_SOURCE_WAYBILL_CENSUS_MISMATCH/,'independent workbook census must block parser-side source loss');
assert.match(importGuard,/readV273SourceWaybillCensus/,'source workbook waybills must be counted independently from normal parser');
assert.match(importGuard,/V273_SAME_DATE_REUPLOAD_SHRINK_BLOCKED/,'smaller same-date reuploads must be rejected');
assert.match(importGuard,/V273_SAME_DATE_MEMBERSHIP_LOSS_BLOCKED/,'same-date reupload must preserve every prior valid waybill');
assert.match(importGuard,/V273_REPARSE_PENDING:/,'same source hash repair state must remain protected');
assert.match(importGuard,/previous\.fileHash === parsed\.fileHash && comparison\.difference > 0/,'same-file parser repair must remain');
assert.match(importGuard,/handlers\.slice\(0, last\), guard, responseTruth, handlers\[last\]/,'completeness guard must run after upload middleware and before final import handler');
assert.match(importGuard,/recoverInterruptedSameHashRepairs/,'interrupted same-file repair must recover safely on startup');
assert.match(importGuard,/process\.env\.NODE_ENV !== 'test' && !process\.env\.CI/,'tests must never run recovery against real production database');
assert.match(parser,/NOT_FOUND_OPTIONAL/,'recipient column may be absent without silently discarding a whole sheet');
assert.match(parser,/hasShipmentValues/,'sheet discovery must be driven by actual waybill presence');
assert.doesNotMatch(parser,/shipmentIndex < 0 \|\| recipientIndex < 0/,'recipient-column absence must no longer skip the sheet');

execFileSync(process.execPath,['scripts/v273-trend-import-integrity-smoke.mjs'],{stdio:'inherit'});
console.log('[V280/V274/V273] sparse Excel range + staged pre-COMMIT timing + backend fast ack + ledger-first hot trends + reupload protection gate passed');
