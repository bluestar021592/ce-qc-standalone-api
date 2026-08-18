const fs=require('fs');
const read=p=>fs.readFileSync(p,'utf8');
const truth=read('src/v206ShopeePrecisionTruth.js');
const dashboard=read('src/v203DashboardIntegrityPatch.js');
const exporter=read('src/v200TemplateDashboardExporter.js');
const workbook=read('src/v200ReferenceWorkbook.js');
const ui=read('public/v206-shopee-precision.js');
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

must(dashboard,'collectV206ShopeeRows');
must(dashboard,'summarizeV206ShopeeTiming');
must(dashboard,'ppAverageDays');
must(dashboard,'pvAverageDays');
must(dashboard,'ppTimingCoverage');
must(dashboard,'pvTimingCoverage');
must(dashboard,'缺3001、缺POD时间或时间倒序的票不进入平均值');

must(exporter,'collectV206ShopeeRows');
must(exporter,'_V206.xlsx');
must(exporter,'SHOPEE_3001_TO_ACTUAL_4004_OR_TRACK80_POD_INCLUSIVE');
must(workbook,'平均签收天数严格按真实3001金边中央仓入库节点→真实4004/轨迹80 POD计算');

must(ui,'SHOPEE CN · 金边 PP');
must(ui,'SHOPEE CN · 外省 PV');
must(ui,'SHOPEE VN · 金边 PP');
must(ui,'SHOPEE VN · 外省 PV');
must(ui,"Number(samples||0)>0?`${Number(value||0).toFixed(2)} 天`:'—'");
must(shell,'/v206-shopee-precision.js?v=20260818-v206-1');

console.log('[V206] SHOPEE precision integration smoke passed: 3001->4004/80 timing, PP/PV split, evidence coverage, export note and UI shell are wired to one truth source.');
