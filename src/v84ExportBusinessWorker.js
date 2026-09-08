import fs from 'node:fs';
import path from 'node:path';
// Legacy imports retained for compatibility; V200 owns all-business child output.
import { createV199UnifiedDashboardWorkbook } from './v199UnifiedDashboardExporter.js';
import { createV200ReferenceDashboardWorkbook, V200_EXPORT_VERSION } from './v200TemplateDashboardExporter.js';
import { closeDb, getRuntimeConfig } from './db.js';

const VERSION='2026-09-08-v474-indexed-business-export-progress-v1';
const resultFile=path.resolve(String(process.argv[2]||''));
const progressFile=resultFile?`${resultFile}.progress.json`:'';
const type=String(process.argv[3]||'').trim().toUpperCase();
const from=String(process.argv[4]||'').slice(0,10);
const to=String(process.argv[5]||'').slice(0,10);
const periodType=String(process.argv[6]||'custom');
const partIndex=Number(process.argv[7]||1),partCount=Number(process.argv[8]||1);
const allowed=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
// Compatibility marker: 2026-08-18-v199-all-business-dashboard-child-v1 / V199_DASHBOARD_ATTEMPTS_NO_ATTEMPT_DETAIL_SHEETS
void createV199UnifiedDashboardWorkbook;
function writeAtomic(file,value){if(!file)return;const temp=`${file}.${process.pid}.tmp`;fs.writeFileSync(temp,JSON.stringify(value,null,2),'utf8');fs.renameSync(temp,file);}
function writeResult(v){writeAtomic(resultFile,v);}
function writeProgress(v={}){try{writeAtomic(progressFile,{version:VERSION,type,from,to,...v,updatedAt:new Date().toISOString()});}catch{}}
try{
  if(!resultFile||!allowed.has(type))throw new Error(`不支持的业务板块：${type}`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw new Error('导出日期范围无效。');
  if(partCount>1||partIndex!==1)throw new Error('V200完整报表禁止日期分片；每个业务必须一次生成一份完整Excel。');
  const range={from,to,key:`${from}_${to}`};
  writeProgress({phase:'starting',completed:0,total:1,message:`${type} 导出子进程已启动`});
  const result=await createV200ReferenceDashboardWorkbook({
    type,periodType,range,outputDir:getRuntimeConfig().exportsDir,
    onProgress:payload=>writeProgress(payload||{})
  });
  writeProgress({phase:'done',completed:1,total:1,entries:Number(result.summary?.total||0),message:`${type} 完整Excel已生成`});
  writeResult({ok:true,type,range,rows:Number(result.summary?.total||0),files:[result.file],summary:result.summary||{},completeWorkbook:true,version:VERSION,parityExporterVersion:V200_EXPORT_VERSION,outputContract:'V200_REFERENCE_TEMPLATE_10_SHEETS_DASHBOARD_ATTEMPT_ONLY'});
}catch(error){
  writeProgress({phase:'failed',completed:0,total:1,error:error?.message||String(error)});
  writeResult({ok:false,type,from,to,error:error?.message||String(error),stack:error?.stack||'',version:VERSION});
  process.exitCode=1;
}finally{try{closeDb();}catch{}}
