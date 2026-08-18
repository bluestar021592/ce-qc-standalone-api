import fs from 'node:fs';
import path from 'node:path';
// Legacy imports retained for compatibility; V199 owns all-business child output.
import { listCompletedWhppSnapshots } from './v87WhppExportStore.js';
import { createShopeeTemplateWorkbook } from './shopeeTemplateExporter.js';
import { createCompactPeriodBusinessWorkbook } from './v177CompactPeriodExporter.js';
import { createShopeeRefreshedPeriodWorkbook } from './v183ShopeeRefreshedPeriodExporter.js';
import { createStrictUnifiedParityWorkbook, V198_PARITY_EXPORT_VERSION } from './v198UnifiedParityExporter.js';
import { createV199UnifiedDashboardWorkbook, V199_EXPORT_VERSION } from './v199UnifiedDashboardExporter.js';
import { closeDb, getRuntimeConfig } from './db.js';

const VERSION='2026-08-18-v199-all-business-dashboard-child-v1';
const resultFile=path.resolve(String(process.argv[2]||''));
const type=String(process.argv[3]||'').trim().toUpperCase();
const from=String(process.argv[4]||'').slice(0,10);
const to=String(process.argv[5]||'').slice(0,10);
const periodType=String(process.argv[6]||'custom');
const partIndex=Number(process.argv[7]||1),partCount=Number(process.argv[8]||1);
const allowed=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
void listCompletedWhppSnapshots;void createShopeeTemplateWorkbook;void createCompactPeriodBusinessWorkbook;void createShopeeRefreshedPeriodWorkbook;void createStrictUnifiedParityWorkbook;void V198_PARITY_EXPORT_VERSION;
function writeResult(v){fs.writeFileSync(resultFile,JSON.stringify(v,null,2),'utf8');}
try{
  if(!resultFile||!allowed.has(type))throw new Error(`不支持的业务板块：${type}`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw new Error('导出日期范围无效。');
  if(partCount>1||partIndex!==1)throw new Error('V199完整报表禁止日期分片；每个业务必须一次生成一份完整Excel。');
  const range={from,to,key:`${from}_${to}`};
  const result=await createV199UnifiedDashboardWorkbook({type,periodType,range,outputDir:getRuntimeConfig().exportsDir});
  writeResult({ok:true,type,range,rows:Number(result.summary?.total||0),files:[result.file],summary:result.summary||{},completeWorkbook:true,version:VERSION,parityExporterVersion:V199_EXPORT_VERSION,outputContract:'V199_DASHBOARD_ATTEMPTS_NO_ATTEMPT_DETAIL_SHEETS'});
}catch(error){writeResult({ok:false,type,from,to,error:error?.message||String(error),stack:error?.stack||'',version:VERSION});process.exitCode=1;}finally{try{closeDb();}catch{}}
