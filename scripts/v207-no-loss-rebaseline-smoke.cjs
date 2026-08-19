const fs=require('fs');
const read=p=>fs.readFileSync(p,'utf8');
const parser=read('src/unifiedExcelParser.js');
const integrity=read('src/v207UnifiedImportIntegrity.js');
const importPatch=read('src/v42WhppPatch.js');
const exportTruth=read('src/v207ExportMembershipTruth.js');
const precision=read('src/v206ShopeePrecisionTruth.js');
const audit=read('src/v205IntegrityAuditPatch.js');
const evidenceUi=read('public/v205-data-integrity.js');
const rebuildUi=read('public/v207-rebaseline.js');
const shell=read('src/v44WhppUiPatch.js');
const must=(source,token)=>{if(!source.includes(token))throw new Error(`V207 no-loss smoke missing: ${token}`);};
const forbid=(source,token)=>{if(source.includes(token))throw new Error(`V207 no-loss smoke forbidden: ${token}`);};

must(parser,'UNRECOGNIZED_WAYBILL_SHEET');
must(parser,'DUPLICATE_BUSINESS_CONFLICT');
must(parser,'DUPLICATE_REGION_CONFLICT');
must(parser,'SHOPEE_REGION_MISSING');
must(parser,"recipientIndex >= 0 ? 'VALID' : 'VALID_RECIPIENT_OPTIONAL'");
must(parser,"recipient.includes('TBKH')");

must(integrity,'CREATE TABLE IF NOT EXISTS v207_daily_ownership');
must(integrity,'PRIMARY KEY(reportDate,shipmentCode)');
must(integrity,'LEGACY_AUTO_SEED_DISABLED_CLEAN_REBASELINE');
must(integrity,'recoveredFromPrior=1');
must(integrity,'firstCleanBaseline');
forbid(integrity,"DELETE FROM v207_daily_ownership WHERE reportDate");

must(importPatch,'inspectV207BeforeUpload(parsed)');
must(importPatch,'commitV207Ownership(parsed');
must(importPatch,'loadV207CanonicalRowsForDate(parsed.reportDate)');
must(importPatch,'assertV207RuntimeMembership');
must(importPatch,'V207_APPEND_ONLY_CANONICAL_MEMBERSHIP');
must(importPatch,'canonicalCount: whppRows.length');

must(exportTruth,'V207_REBASELINE_INCOMPLETE');
must(exportTruth,'loadV207CanonicalRows');
must(exportTruth,'V207_OWNERSHIP_LEDGER_RECOVERY');
must(exportTruth,'official.length!==wanted.size');
must(precision,'collectV207ExportRows');
must(precision,'V207_EXPORT_MEMBERSHIP_VERSION');

must(audit,'/api/v207/rebaseline/daily');
must(audit,'/api/v207/rebaseline/range');
must(audit,'WAITING_REUPLOAD');
must(audit,'NO_LOSS_ARCHIVE_RECOVERY');
must(audit,'COMPLETE_REUPLOAD');
must(evidenceUi,'轨迹证据 / 状态闭环完整性');
must(rebuildUi,'历史日报清洁重建 / 防漏票底账');
must(rebuildUi,'待重新上传');
must(rebuildUi,'已保留少传');
must(shell,'/v207-rebaseline.js?v=20260819-v207-1');

console.log('[V207] no-loss rebaseline smoke passed: strict parser, clean first baseline, append-only same-date ownership, seven-business runtime reconciliation, export gate and rebuild UI are wired.');
