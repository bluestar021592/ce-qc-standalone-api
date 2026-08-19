const fs=require('fs');
const read=p=>fs.readFileSync(p,'utf8');
const canonical=read('src/v205CanonicalTruth.js');
const legacyTruth=read('src/v205ExportTruth.js');
const exporter=read('src/v200TemplateDashboardExporter.js');
const dashboard=read('src/v203DashboardIntegrityPatch.js');
const audit=read('src/v205IntegrityAuditPatch.js');
const auditUi=read('public/v205-data-integrity.js');
const shell=read('src/v44WhppUiPatch.js');
const must=(source,token)=>{if(!source.includes(token))throw new Error(`V205/V209 integrity smoke missing ${token}`);};
const forbid=(source,token)=>{if(source.includes(token))throw new Error(`V205/V209 integrity smoke forbidden ${token}`);};

// Historical canonical archive integrity remains required: completed VALID/SUPERSEDED
// snapshots are unioned so old imports cannot silently disappear from evidence review.
must(canonical,"b.status IN ('VALID','SUPERSEDED')");
must(canonical,"s.status='COMPLETED'");
must(canonical,"DAILY_CANONICAL_ARCHIVE_UNION");
must(canonical,'recoveredFromSupersededSnapshots');
must(canonical,"businessType IN (?,?)");
must(canonical,"familyOf(requested)");
must(canonical,"FROM track_events WHERE shipmentCode IN");
must(canonical,"state==='PENDING_SCAN'");
must(canonical,"Pending（日报状态，轨迹证据待补齐）");
must(canonical,"派送中（日报状态，轨迹证据待补齐）");
must(canonical,"current==='POD'");
must(canonical,"current==='ORDER_CANCELLED'");
must(canonical,"580滞留包裹");
must(canonical,"自提/转运门店");
must(canonical,"轨迹有节点");
must(canonical,"V205完整性对账失败");
forbid(canonical,"statusDesc='需人工复核'");

// V205 remains a compatibility evidence layer, but it is no longer the final owner.
must(legacyTruth,'collectV205CanonicalRows');
must(legacyTruth,'resolveV202AttemptCycle');
must(legacyTruth,"status==='W'||status==='Y'");
must(legacyTruth,"status==='P'");
must(legacyTruth,'v202NaturalDays');
must(legacyTruth,"metricEligible:false");

// Current final export/dashboard ownership is V206/V207/V209: append-only membership,
// precise 3001->real-POD timing and full-coverage official average gating.
must(exporter,'collectV206ShopeeRows');
must(exporter,'_V209.xlsx');
must(exporter,'V207_APPEND_ONLY_CANONICAL_MEMBERSHIP');
must(exporter,'FULL_COVERAGE_ONLY');
must(exporter,'averageOfficial');
forbid(exporter,'await collectV205ExportRows');
must(dashboard,'collectV206ShopeeRows');
must(dashboard,'V206_SHOPEE_PRECISION_VERSION');
must(dashboard,'averageOfficial');
must(dashboard,'ppAverageOfficial');
must(dashboard,'pvAverageOfficial');

must(audit,"/api/v205/integrity/summary");
must(audit,"/api/v205/integrity/deep");
must(audit,"b.status IN ('VALID','SUPERSEDED')");
must(audit,'sampleMissing');
must(auditUi,'数据完整性 / 遗漏风险核查');
must(auditUi,'历史底账');
must(auditUi,'证据待补齐');
must(shell,"import './v205IntegrityAuditPatch.js'");
must(shell,'/v205-data-integrity.js?v=20260819-v207-2');

console.log('[V209] canonical integrity smoke passed: historical completed snapshots remain auditable, while V207/V206/V209 own no-loss membership, precise Shopee timing and final export/dashboard truth.');
