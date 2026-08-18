const fs=require('fs');
const single=fs.readFileSync('src/v183SingleBusinessExportJobWorker.js','utf8');
const allChild=fs.readFileSync('src/v84ExportBusinessWorker.js','utf8');
const v199=fs.readFileSync('src/v199UnifiedDashboardExporter.js','utf8');
const v200=fs.readFileSync('src/v200TemplateDashboardExporter.js','utf8');
const evidence=fs.readFileSync('src/v200EvidenceData.js','utf8');
const workbook=fs.readFileSync('src/v200ReferenceWorkbook.js','utf8');
const must=(source,token)=>{if(!source.includes(token))throw new Error(`export owner smoke missing ${token}`);};

must(single,'createV200ReferenceDashboardWorkbook');
must(single,'2026-08-18-v200-reference-template-track-attempt-worker-v1');
must(single,'V200_REFERENCE_TEMPLATE_10_SHEETS_DASHBOARD_ATTEMPT_ONLY');
must(allChild,'createV200ReferenceDashboardWorkbook');
must(allChild,'2026-08-18-v200-all-business-reference-child-v1');
must(allChild,'V200_REFERENCE_TEMPLATE_10_SHEETS_DASHBOARD_ATTEMPT_ONLY');
must(v200,'createV200ReferenceDashboardWorkbook');
must(evidence,"code === '70'");
must(evidence,"code === '60'");
must(evidence,"'派件时间'");
must(evidence,"source: '无真实派次证据'");
must(workbook,'HYPERLINK');
must(workbook,"workbook.addWorksheet('每日看板'");
must(workbook,"'派次与平均签收天数'");
must(workbook,"const DETAIL_SHEETS = ['全部明细', '金边明细', '外省明细', '门店明细', 'POD明细', '未POD明细', '分配派送中明细', 'Pending明细', '退回明细']");
// V199 remains only as rollback/reference code; it must no longer own user-facing exports.
must(v199,'2026-08-18-v199-dashboard-attempt-average-v1');
console.log('[V200] single + ALL business reference-template export ownership smoke passed');
