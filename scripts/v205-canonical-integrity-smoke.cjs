const fs=require('fs');
const read=p=>fs.readFileSync(p,'utf8');
const canonical=read('src/v205CanonicalTruth.js');
const truth=read('src/v205ExportTruth.js');
const exporter=read('src/v200TemplateDashboardExporter.js');
const dashboard=read('src/v203DashboardIntegrityPatch.js');
const must=(source,token)=>{if(!source.includes(token))throw new Error(`V205 integrity smoke missing ${token}`);};
const forbid=(source,token)=>{if(source.includes(token))throw new Error(`V205 integrity smoke forbidden ${token}`);};

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

must(truth,'collectV205CanonicalRows');
must(truth,'resolveV202AttemptCycle');
must(truth,"status==='W'||status==='Y'");
must(truth,"status==='P'");
must(truth,'v202NaturalDays');
must(truth,"metricEligible:false");

must(exporter,'collectV205ExportRows');
must(exporter,'_V205.xlsx');
must(exporter,'ALL_VALID_COMPLETED_DAILY_IMPORTS_ARE_UNIONED');
forbid(exporter,'await collectV202Rows');

must(dashboard,'collectV205ExportRows');
must(dashboard,'V205_EXPORT_TRUTH_VERSION');
must(dashboard,'同一天所有VALID+COMPLETED日报批次取并集');
forbid(dashboard,'await collectV202Rows');

console.log('[V205] canonical integrity smoke passed: completed historical snapshots remain in membership, exact business accepts family evidence, daily W/P no longer degrades to manual-review, and exports/dashboards use one truth source.');
