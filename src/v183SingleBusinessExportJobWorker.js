import fs from 'node:fs';
import path from 'node:path';
import { getRuntimeConfig, closeDb } from './db.js';
// Legacy imports remain for updater compatibility; V200 owns runtime export.
import { createShopeeTruthWorkbook } from './v191ShopeeTruthExporter.js';
import { createV199UnifiedDashboardWorkbook } from './v199UnifiedDashboardExporter.js';
import { createV200ReferenceDashboardWorkbook, V200_EXPORT_VERSION } from './v200TemplateDashboardExporter.js';
import { prepareV381ShopeeExportEvidence, V381_EXPORT_EVIDENCE_REPAIR_ID } from './v381ExportEvidenceRepair.js';

const VERSION='2026-08-17-v191-single-business-truth-worker-v1';
const REVISION='2026-08-31-v381-shopee-export-evidence-preflight-v1';
const HEARTBEAT_MS=Math.max(3000,Math.min(15000,Number(process.env.EXPORT_SINGLE_HEARTBEAT_MS||5000)));
const jobFile=path.resolve(String(process.argv[2]||''));
const ALLOWED=new Set(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const SHOPEE_TYPES=new Set(['SHOPEECN','SHOPEEVN']);
// Compatibility markers: 2026-08-18-v199-dashboard-attempt-average-worker-v1 / V199_DASHBOARD_ATTEMPTS_NO_ATTEMPT_DETAIL_SHEETS / crossDayTruth: true / onePassStreaming: true / LEGACY_10_SHEETS_V191_TRUTH
void createShopeeTruthWorkbook; void createV199UnifiedDashboardWorkbook;
function readJob(){if(!jobFile||!fs.existsSync(jobFile))throw new Error('导出任务文件不存在。');return JSON.parse(fs.readFileSync(jobFile,'utf8'));}
function emitSidecarStatus(job){try{if(typeof process.send==='function')process.send({type:'CE_QC_EXPORT_JOB_UPDATE',job});}catch{}}
function writeJob(patch={}){const current=readJob(),nextStatus=String(patch.status||'').toUpperCase();if(current.cancelRequested&&!['FAILED','CANCELLED'].includes(nextStatus)){const e=new Error('EXPORT_JOB_CANCELLED');e.code='EXPORT_JOB_CANCELLED';throw e;}const next={...current,...patch,updatedAt:new Date().toISOString()},temp=`${jobFile}.${process.pid}.v200.tmp`;fs.writeFileSync(temp,JSON.stringify(next,null,2),'utf8');fs.renameSync(temp,jobFile);emitSidecarStatus(next);return next;}
function dateKey(v=''){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?String(v):'';}
function formatCambodia(d){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function validateRange(from,to){if(!dateKey(from)||!dateKey(to)||from>to)throw new Error('导出日期范围无效。');const days=Math.floor((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000)+1;if(days>180)throw new Error('单次日期范围最多180天。');return{from,to,key:`${from}_${to}`};}
function rangeOf(p={}){
  // The two visible date inputs are authoritative. Older UI owners can still send
  // periodType='daily' while also sending explicit fromDate/toDate; previously the
  // worker ignored those visible dates and reused payload.date, producing a valid
  // workbook for the wrong historical range. Never do that again.
  const explicitFrom=dateKey(p.fromDate),explicitTo=dateKey(p.toDate);
  if(explicitFrom||explicitTo){
    if(!explicitFrom||!explicitTo)throw new Error('导出开始日期和结束日期必须同时有效。');
    return validateRange(explicitFrom,explicitTo);
  }
  if(p.periodType==='custom')return validateRange(p.fromDate,p.toDate);
  const base=dateKey(p.date)?new Date(`${p.date}T12:00:00+07:00`):new Date();
  if(p.periodType==='weekly'){const day=(base.getDay()+6)%7,from=new Date(base);from.setDate(base.getDate()-day);const to=new Date(from);to.setDate(from.getDate()+6);return validateRange(formatCambodia(from),formatCambodia(to));}
  if(p.periodType==='monthly'){const from=new Date(base.getFullYear(),base.getMonth(),1,12),to=new Date(base.getFullYear(),base.getMonth()+1,0,12);return validateRange(formatCambodia(from),formatCambodia(to));}
  const d=formatCambodia(base);return{from:d,to:d,key:d};
}
function memoryText(){const m=process.memoryUsage(),mb=v=>Math.max(0,Math.round(Number(v||0)/1024/1024));return`RSS ${mb(m.rss)}MB / Heap ${mb(m.heapUsed)}MB`;}
function fileItem(file){const name=path.basename(String(file||''));return{name,url:`/api/export-file?name=${encodeURIComponent(name)}`,completeWorkbook:true};}
let heartbeat=null,stage='准备中',progress=2,startedAt=Date.now();
try{
  const job=readJob(),payload=job.payload||{},type=String(payload.businessType||'').trim().toUpperCase();
  if(!ALLOWED.has(type))throw new Error(`V200单业务导出不支持：${type||'空业务'}`);
  const range=rangeOf(payload);startedAt=Date.now();stage=`正在生成 ${type} 参考母版每日看板`;progress=5;
  writeJob({status:'RUNNING',progress,range,currentBusiness:type,currentPart:1,businessParts:1,heartbeatAt:new Date().toISOString(),workerPid:process.pid,workerMode:'SINGLE_BUSINESS_DIRECT',workerVersion:VERSION,workerRevision:REVISION,message:`${stage} · ${range.from} 至 ${range.to} · ${memoryText()}`});
  heartbeat=setInterval(()=>{try{writeJob({status:'RUNNING',progress,heartbeatAt:new Date().toISOString(),currentBusiness:type,currentPart:1,businessParts:1,workerPid:process.pid,workerMode:'SINGLE_BUSINESS_DIRECT',workerVersion:VERSION,workerRevision:REVISION,message:`${stage} · 已运行${Math.max(1,Math.floor((Date.now()-startedAt)/1000))}秒 · ${memoryText()}`});}catch(e){if(e?.code==='EXPORT_JOB_CANCELLED')process.exitCode=2;}},HEARTBEAT_MS);heartbeat.unref?.();
  if(SHOPEE_TYPES.has(type)){
    stage=`补核 ${type} 完整表真实POD/派件START证据`;progress=6;
    const repair=await prepareV381ShopeeExportEvidence({type,range,onProgress(info={}){const completed=Math.max(0,Number(info.completed||0)),total=Math.max(0,Number(info.total||0)),queried=Math.max(0,Number(info.queried||0)),failed=Math.max(0,Number(info.failed||0));progress=total?Math.max(6,Math.min(38,6+Math.floor((completed/total)*32))):38;stage=total?`补核 ${type} 真实轨迹 ${completed}/${total} · 已查询${queried.toLocaleString()}票${failed?` · 失败${failed.toLocaleString()}票`:''}`:`${type} 已保存真实证据完整，无需补查`;writeJob({status:'RUNNING',progress,heartbeatAt:new Date().toISOString(),currentBusiness:type,currentPart:1,businessParts:1,workerPid:process.pid,workerMode:'SINGLE_BUSINESS_DIRECT',workerVersion:VERSION,workerRevision:REVISION,evidenceRepairVersion:V381_EXPORT_EVIDENCE_REPAIR_ID,message:`${stage} · ${memoryText()}`});}});
    progress=Math.max(progress,38);stage=repair.unresolved?`${type} 轨迹补核结束，仍有${Number(repair.unresolved||0).toLocaleString()}票缺真实证据；正在执行完整性门禁`:`${type} 真实证据补核完成；正在生成完整表`;
    writeJob({status:'RUNNING',progress,heartbeatAt:new Date().toISOString(),currentBusiness:type,currentPart:1,businessParts:1,workerPid:process.pid,workerMode:'SINGLE_BUSINESS_DIRECT',workerVersion:VERSION,workerRevision:REVISION,evidenceRepairVersion:V381_EXPORT_EVIDENCE_REPAIR_ID,evidenceRepair:repair,message:`${stage} · ${memoryText()}`});
  }
  const shopeeBase=SHOPEE_TYPES.has(type)?40:10;
  const result=await createV200ReferenceDashboardWorkbook({type,periodType:payload.periodType||'custom',range,outputDir:getRuntimeConfig().exportsDir,onProgress(info={}){const phase=String(info.phase||''),completed=Math.max(0,Number(info.completed||0)),total=Math.max(1,Number(info.total||1));if(phase==='sourceRows'){const span=SHOPEE_TYPES.has(type)?18:35;progress=Math.max(shopeeBase,Math.min(58,shopeeBase+Math.floor((completed/total)*span)));stage=`读取 ${type} 日报/快照 ${completed}/${total} · 已归属${Number(info.entries||0).toLocaleString()}票`;}else if(phase==='truth'){progress=60;stage=`完成 ${type} 真实POD时间与轨迹60/70派次计算 · 轨迹派次${Number(info.trackAttempts||0).toLocaleString()}票`;}else if(phase==='writing'){progress=Math.max(62,Math.min(97,62+Math.floor((completed/total)*35)));stage=`按参考母版写入看板与通用明细 ${completed}/${total}${info.sheet?` · ${info.sheet}`:''}`;}writeJob({status:'RUNNING',progress,heartbeatAt:new Date().toISOString(),currentBusiness:type,currentPart:1,businessParts:1,workerPid:process.pid,workerMode:'SINGLE_BUSINESS_DIRECT',workerVersion:VERSION,workerRevision:REVISION,crossDayTruth:true,onePassStreaming:true,dashboardAttemptOnly:true,wpsFormulaLinks:true,trackAttemptFacts:true,outputContract:'V200_REFERENCE_TEMPLATE_10_SHEETS_DASHBOARD_ATTEMPT_ONLY',message:`${stage} · ${memoryText()}`});}});
  const file=result.file,summary=result.summary||{};if(!file||!fs.existsSync(file))throw new Error(`${type} 完整表生成结束，但输出文件不存在。`);
  progress=100;stage='生成完成';writeJob({status:'COMPLETED',progress:100,heartbeatAt:new Date().toISOString(),currentBusiness:'',currentPart:0,businessParts:0,workerPid:process.pid,workerMode:'SINGLE_BUSINESS_DIRECT',workerVersion:VERSION,workerRevision:REVISION,parityExporterVersion:V200_EXPORT_VERSION,outputContract:summary.outputContract||'V200_REFERENCE_TEMPLATE_10_SHEETS_DASHBOARD_ATTEMPT_ONLY',summary,message:`导出完成：${type} ${range.from} 至 ${range.to}；版式按参考母版，跳转为WPS兼容公式，派次只在看板展示`,files:[fileItem(file)],completedAt:new Date().toISOString()});
}catch(error){try{const cancelled=error?.code==='EXPORT_JOB_CANCELLED',rootCauseCode=error?.code||'EXPORT_SINGLE_BUSINESS_FAILED',terminalTruth=rootCauseCode==='SHOPEE_EXPORT_TRUTH_INCOMPLETE';writeJob({status:cancelled?'CANCELLED':'FAILED',progress:Number(progress||0),heartbeatAt:new Date().toISOString(),workerPid:process.pid,workerMode:'SINGLE_BUSINESS_DIRECT',workerVersion:VERSION,workerRevision:REVISION,errorCode:cancelled?'CANCELLED':(terminalTruth?'FAILED':rootCauseCode),rootCauseCode,message:cancelled?'后台单业务导出已取消。':(error?.message||String(error)),error:error?.stack||String(error),failedAt:new Date().toISOString()});}catch{}process.exitCode=1;}finally{if(heartbeat)clearInterval(heartbeat);try{closeDb();}catch{}}
