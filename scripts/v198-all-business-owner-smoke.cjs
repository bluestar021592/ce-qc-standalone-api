const fs=require('fs');
const single=fs.readFileSync('src/v183SingleBusinessExportJobWorker.js','utf8');
const allChild=fs.readFileSync('src/v84ExportBusinessWorker.js','utf8');
const legacyExporter=fs.readFileSync('src/v198UnifiedParityExporter.js','utf8');
const dashboardExporter=fs.readFileSync('src/v199UnifiedDashboardExporter.js','utf8');
const must=(source,token)=>{if(!source.includes(token))throw new Error(`export owner smoke missing ${token}`);};

// V198 remains available as a legacy/reference exporter, but V199 now owns every
// user-facing single-business and ALL-business export. This smoke intentionally
// validates the CURRENT runtime owner so a successful V199 upgrade is not rejected
// merely because the previous V198 owner token disappeared from the child worker.
must(single,'createV199UnifiedDashboardWorkbook');
must(single,'2026-08-18-v199-dashboard-attempt-average-worker-v1');
must(single,'V199_DASHBOARD_ATTEMPTS_NO_ATTEMPT_DETAIL_SHEETS');
must(allChild,'createV199UnifiedDashboardWorkbook');
must(allChild,'2026-08-18-v199-all-business-dashboard-child-v1');
must(allChild,'V199_DASHBOARD_ATTEMPTS_NO_ATTEMPT_DETAIL_SHEETS');
must(dashboardExporter,"new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'])");
must(dashboardExporter,'resolveAttemptForV199');
must(dashboardExporter,'金边平均天数');
must(dashboardExporter,'外省平均天数');
must(dashboardExporter,'1/2/3派只在看板统计，不再创建独立派次明细Sheet');

// Keep one guard proving the V198 reference exporter still exists for backward
// compatibility and historical file reproducibility.
must(legacyExporter,'2026-08-18-v198-strict-pod-parity-dashboard-v1');
console.log('[V199] single + ALL business export ownership smoke passed');
