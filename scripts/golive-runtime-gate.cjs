const fs=require('fs');
const read=p=>fs.readFileSync(p,'utf8');
const must=(source,token)=>{if(!source.includes(token))throw new Error(`GOLIVE missing ${token}`);};
const forbid=(source,token)=>{if(source.includes(token))throw new Error(`GOLIVE forbidden ${token}`);};

const runner=read('public/v67-resilient-run-guard.js');
const pause=read('public/v164-unified-pause-router.js');
const shell=read('src/v44WhppUiPatch.js');
const storage=read('src/storage.js');
const bstore=read('src/businessStore.js');
const parser=read('src/unifiedExcelParser.js');
const v102=read('src/v102UnifiedImportSafetyGatePatch.js');
const v146=read('src/v146UnifiedImportDateBridgePatch.js');
const v209Archive=read('src/v209RawImportArchivePatch.js');
const v209ArchiveUi=read('public/v209-source-archive-status.js');
const v42=read('src/v42WhppPatch.js');
const v161=read('src/v161UnifiedImportRuntimeTruthPatch.js');
const v207Integrity=read('src/v207UnifiedImportIntegrity.js');
const v207Export=read('src/v207ExportMembershipTruth.js');
const v205Audit=read('src/v205IntegrityAuditPatch.js');
const v205Ui=read('public/v205-data-integrity.js');
const v207Ui=read('public/v207-rebaseline.js');
const v206Truth=read('src/v206ShopeePrecisionTruth.js');
const v206Ui=read('public/v206-shopee-precision.js');
const v208=read('src/v208ShopeePrecisionEvidenceScheduler.js');
const v208Worker=read('src/v208ShopeePrecisionEvidenceWorker.js');
const v208Guard=read('public/v208-dashboard-final-guard.js');
const v203Integrity=read('src/v203DashboardIntegrityPatch.js');
const v203Ui=read('public/v203-dashboard-integrity.js');
const v203ManualStore=read('src/v203ManualEvidenceStore.js');
const v203ManualPatch=read('src/v203ManualQueryPersistencePatch.js');
const v202Truth=read('src/v202DeliveryTruth.js');
const shopeeAnalyzer=read('src/shopeeAnalyzer.js');
const shopeeAnalyzerV33=read('src/shopeeAnalyzerV33.js');
const shopeeReporting=read('src/shopeeReporting.js');
const v200Metrics=read('src/v200Metrics.js');
const v200Workbook=read('src/v200ReferenceWorkbook.js');
const v200Exporter=read('src/v200TemplateDashboardExporter.js');
const v202Carry=read('src/v202CarryTrackingCenterPatch.js');
const v202CarryUi=read('public/v202-carry-tracking-center.js');
const v202DisableLegacy=read('src/v202DisableLegacyTrackerPatch.js');
const v108=read('public/v108-route-lazy-features.js');
const tokenExportUi=read('public/v194-export-token-ui.js');
const exportSidecar=read('src/v193ExportSidecar.js');
const singleExportWorker=read('src/v183SingleBusinessExportJobWorker.js');
const allBusinessChild=read('src/v84ExportBusinessWorker.js');

// Foundation: seven-business runner + resilient storage/export path.
must(runner,'2026-08-17-v165-seven-business-stage-verification-v2');
for(const token of ["{ key: 'CCSL'","{ key: 'SHOPEE'","{ key: 'WHPP'",'/api/run','/api/shopee/run/start','/api/whpp/run/start'])must(runner,token);
must(pause,'global.pauseUnified=pauseUnified');
must(storage,'compactStateForPersistence');
must(bstore,'compactBusinessStatePayload');
must(v108,'/v194-export-token-ui.js?v=20260818-v195-1');
must(tokenExportUi,'/api/v194/export-period/prepare');
must(exportSidecar,'IPC_MEMORY_V195');
must(singleExportWorker,'createV200ReferenceDashboardWorkbook');
must(allBusinessChild,'createV200ReferenceDashboardWorkbook');

// V208 source conservation: a workbook cell that looks like a waybill cannot silently disappear.
must(v102,'SOURCE_WAYBILL_NOT_PRESERVED');
must(v102,'sourceWaybillReconciliation');
must(parser,'UNRECOGNIZED_WAYBILL_SHEET');
must(parser,'WAYBILL_COLUMN_MISSING');
must(parser,'UNCLASSIFIED_WAYBILL');
must(parser,'DUPLICATE_BUSINESS_CONFLICT');
must(parser,'DUPLICATE_REGION_CONFLICT');
must(parser,'SHOPEE_REGION_MISSING');
must(parser,"recipientIndex >= 0 ? 'VALID' : 'VALID_RECIPIENT_OPTIONAL'");
must(parser,"recipient.includes('TBKH')");
must(parser,'sourceReconciliation');

// V209 source archive: every import that reaches persistence must first have a verified raw
// workbook copy. Database rebuilds must no longer depend on asking the user to re-upload history.
must(v146,"import './v209RawImportArchivePatch.js'");
must(v209Archive,'CREATE TABLE IF NOT EXISTS v209_import_source_archive');
must(v209Archive,"status TEXT NOT NULL DEFAULT 'PREPARED'");
must(v209Archive,"status='ACCEPTED'");
must(v209Archive,'SOURCE_ARCHIVE_HASH_MISMATCH');
must(v209Archive,'sha256File(dest)');
must(v209Archive,"BUSINESS_DATA_TABLES.includes('v209_import_source_archive')");
must(v209Archive,'/api/v209/source-archive/status');
must(v209ArchiveUi,'原始日报永久归档 / 可重建保障');
must(v209ArchiveUi,'SHA-256');
must(v209ArchiveUi,'归档损坏/缺失');
must(shell,'/v209-source-archive-status.js?v=20260819-v209-1');

// V207 clean rebaseline: first new upload establishes a clean baseline; later same-day
// reuploads can update/add but never silently remove already confirmed members.
must(v207Integrity,'CREATE TABLE IF NOT EXISTS v207_daily_ownership');
must(v207Integrity,'PRIMARY KEY(reportDate,shipmentCode)');
must(v207Integrity,'LEGACY_AUTO_SEED_DISABLED_CLEAN_REBASELINE');
must(v207Integrity,'firstCleanBaseline');
must(v207Integrity,'recoveredFromPrior=1');
must(v207Integrity,'assertV207RuntimeMembership');
forbid(v207Integrity,'DELETE FROM v207_daily_ownership WHERE reportDate');
must(v42,'inspectV207BeforeUpload(parsed)');
must(v42,'commitV207Ownership(parsed');
must(v42,'loadV207CanonicalRowsForDate(parsed.reportDate)');
must(v42,'assertV207RuntimeMembership');
must(v42,'V207_APPEND_ONLY_CANONICAL_MEMBERSHIP');
must(v42,'canonicalCount: whppRows.length');
must(v161,'V207_SEVEN_BUSINESS_CANONICAL_MEMBERS');
must(v161,"const TYPES = [...V207_TYPES]");

// V207 export membership gate: no mixed old/new historical report can masquerade as precise.
must(v207Export,'V207_REBASELINE_INCOMPLETE');
must(v207Export,'loadV207CanonicalRows');
must(v207Export,'V207_OWNERSHIP_LEDGER_RECOVERY');
must(v207Export,'official.length!==wanted.size');
must(v206Truth,'collectV207ExportRows');
must(v206Truth,'V207_EXPORT_MEMBERSHIP_VERSION');
must(v200Exporter,'collectV206ShopeeRows');
must(v200Exporter,'_V209.xlsx');
must(v200Exporter,'FULL_COVERAGE_ONLY');
must(v200Exporter,'averageOfficial');
must(v200Exporter,'ppAverageOfficial');
must(v200Exporter,'pvAverageOfficial');
must(v200Exporter,'POD_RETURN_CANCELLED_EXCLUDED_FROM_ANOMALY_AND_UNPOD');
must(v200Metrics,"'未POD明细': filter(openUnpod)");
must(v200Metrics,'isShopeePrecisionRow');
must(v200Metrics,"timingEvidenceStatus || '').toUpperCase() !== 'OK'");
must(v200Workbook,'HYPERLINK');
must(v200Workbook,"workbook.addWorksheet('每日看板'");

// 1/2/3 attempt truth: a new attempt requires real redispatch after failure. No elapsed-day,
// assignment-60, or raw Pending-count guessing.
must(v202Truth,"code === '4003'");
must(v202Truth,"code === '70'");
must(v202Truth,"code === '150'");
must(v202Truth,"code === '80'");
must(v202Truth,'Repeated START scans while the same attempt is still open never create a new attempt');
must(v202Truth,'Only a NEW START after a failed attempt opens attempt 2/3+');
must(v202Truth,'Elapsed calendar days, code60 assignment and raw Pending count NEVER manufacture an attempt');
must(shopeeAnalyzer,"from './shopeeAnalyzerV33.js'");
must(shopeeAnalyzerV33,'resolveV202AttemptCycle');
must(shopeeReporting,'V202: no reportDate->POD elapsed-day fallback');

// V206/V208 precise Shopee timing: exact 3001 -> real POD, PP/PV separated, background full
// trajectory evidence captured even when terminal scan status would otherwise skip tracking.
must(v206Truth,"code==='3001'");
must(v206Truth,"code==='4004'");
must(v206Truth,"code==='80'");
must(v206Truth,"status:'MISSING_3001'");
must(v206Truth,"row.deliveryDays=timing.status==='OK'?timing.days:0");
must(v206Truth,'3001入库当天=第1天');
forbid(v206Truth,'v206NaturalDays(row.orderTime');
must(v203Integrity,'averageOfficial');
must(v203Integrity,'ppAverageOfficial');
must(v203Integrity,'pvAverageOfficial');
must(v203Integrity,'v208ShopeePrecisionEvidenceScheduler.js');
must(v208,'v207_daily_ownership');
must(v208,'client.trackQuery(bills)');
must(v208,'business_track_events');
must(v208,"status='COMPLETE'");
must(v208,"status='INCOMPLETE_3001'");
must(v208,'/api/v208/shopee-evidence/status');
must(v208,'BUSINESS_DATA_TABLES.includes(table)');
must(v208,"COUNT(*) count FROM (SELECT DISTINCT o.businessType,o.shipmentCode");
must(v208Worker,'runV208ShopeeEvidenceSync');

// UI must expose useful QC controls only: clean rebuild progress, evidence coverage, exact
// attempts and exact PP/PV timing. Partial timing is never presented as official average.
must(v207Ui,'历史日报清洁重建 / 防漏票底账');
must(v207Ui,'待重新上传');
must(v207Ui,'已保留少传');
must(v205Ui,'轨迹证据 / 状态闭环完整性');
must(v205Ui,'轨迹证据待补齐');
must(v206Ui,'SHOPEE CN · 金边 PP');
must(v206Ui,'SHOPEE VN · 外省 PV');
must(v206Ui,'pod===samples&&coverage>=99.99');
must(v206Ui,"'待补齐'");
must(v208Guard,"label==='平均签收天数'");
must(v208Guard,'自动轨迹证据补全');
must(v203Ui,'真实1/2/3派 POD');
must(v203Ui,'派次证据不足');
must(v203Ui,'RETIRED_TITLES');
must(shell,'/v207-rebaseline.js?v=20260819-v207-2');
must(shell,'/v208-dashboard-final-guard.js?v=20260819-v208-1');

// Manual-query evidence and carry/anomaly center remain durable and terminal-safe.
must(v203ManualStore,'manual_query_evidence');
for(const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'])must(v203ManualStore,`'${type}'`);
must(v203ManualPatch,"'/api/track-query'");
must(v203ManualPatch,'persistV203ManualQuery');
must(v202Carry,'/api/v202/carry/refresh');
must(v202Carry,'if(cls.terminal) return false');
must(v202CarryUi,'POD、退回、取消订单不计异常');

// The known-wrong V201 distinct-day/assignment attempt writer stays disabled.
must(v202DisableLegacy,"CE_QC_DISABLE_SHOPEE_DELIVERY_TRACKER='1'");
must(v202DisableLegacy,'CE_QC_ENABLE_LEGACY_V201_TRACKER');
for(const source of [runner,pause,shell,storage,bstore])forbid(source,'v148-direct-daily-runner-v1');

console.log('[GOLIVE] V209 gate passed: source-cell waybill conservation, verified raw workbook archive, clean seven-business append-only rebaseline, export membership reconciliation, real 1/2/3 delivery cycles, automatic Shopee full-history evidence capture, exact 3001-to-POD PP/PV timing, full-coverage-only official averages, terminal-safe anomalies and durable manual evidence are all wired to one QC truth path.');
