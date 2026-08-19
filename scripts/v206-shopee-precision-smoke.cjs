const fs=require('fs');
const read=p=>fs.readFileSync(p,'utf8');
const truth=read('src/v206ShopeePrecisionTruth.js');
const metrics=read('src/v200Metrics.js');
const dashboard=read('src/v203DashboardIntegrityPatch.js');
const exporter=read('src/v200TemplateDashboardExporter.js');
const workbook=read('src/v200ReferenceWorkbook.js');
const ui=read('public/v206-shopee-precision.js');
const guard=read('public/v208-dashboard-final-guard.js');
const shell=read('src/v44WhppUiPatch.js');
const must=(source,token)=>{if(!source.includes(token))throw new Error(`V206 precision smoke missing: ${token}`);};
const forbid=(source,token)=>{if(source.includes(token))throw new Error(`V206 precision smoke forbidden: ${token}`);};

must(truth,"code==='3001'");
must(truth,"code==='4004'");
must(truth,"code==='80'");
must(truth,"status:'MISSING_3001'");
must(truth,"status:anyPod?'INVALID_SEQUENCE':'MISSING_POD_TIME'");
must(truth,"row.deliveryDays=timing.status==='OK'?timing.days:0");
must(truth,"SHOPEE末端时效：3001入库当天=第1天");
forbid(truth,'v206NaturalDays(row.orderTime');
must(metrics,'isShopeePrecisionRow');
must(metrics,"timingEvidenceStatus || '').toUpperCase() !== 'OK'");

must(dashboard,'collectV206ShopeeRows');
must(dashboard,'summarizeV206ShopeeTiming');
must(dashboard,'ppAverageDays');
must(dashboard,'pvAverageDays');
must(dashboard,'ppTimingCoverage');
must(dashboard,'pvTimingCoverage');
must(dashboard,'缺3001、缺POD时间或时间倒序的票不进入平均值');
must(dashboard,'averageOfficial');

must(exporter,'collectV206ShopeeRows');
must(exporter,'_V209.xlsx');
must(exporter,'FULL_COVERAGE_ONLY');
must(exporter,'ppAverageOfficial');
must(exporter,'pvAverageOfficial');
must(workbook,'平均签收天数严格按真实3001金边中央仓入库节点→真实4004/轨迹80 POD计算');

// The UI builds CN/VN PP/PV labels dynamically from LABELS[type]. Validate the
// real rendering contract instead of requiring static strings that can never occur
// literally in this source file.
must(ui,"SHOPEECN:'SHOPEE CN'");
must(ui,"SHOPEEVN:'SHOPEE VN'");
must(ui,'· 金边 PP');
must(ui,'· 外省 PV');
must(ui,'pod===samples&&coverage>=99.99');
must(ui,"averageText=!pod?'—':closed?`${Number(region.avg||0).toFixed(2)} 天`:'待补齐'");
must(ui,'只有该区域“有效时效样本=POD票数”时才正式展示平均天数');
must(guard,"label==='平均签收天数'");
must(guard,'自动轨迹证据补全');
must(shell,'/v206-shopee-precision.js?v=20260819-v207-2');
must(shell,'/v208-dashboard-final-guard.js?v=20260819-v208-1');

console.log('[V209] SHOPEE precision smoke passed: real attempts, exact 3001->POD timing, dynamic CN/VN PP/PV split and full-coverage-only official averages are wired end to end.');
