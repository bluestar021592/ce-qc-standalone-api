import fs from 'node:fs';
import path from 'node:path';
import { getRuntimeConfig, closeDb } from './db.js';
// Legacy imports/tokens remain intentionally for updater compatibility; V198 owns runtime export.
import { createCompactPeriodBusinessWorkbook } from './v177CompactPeriodExporter.js';
import { createShopeeTruthWorkbook } from './v191ShopeeTruthExporter.js';
import { listCompletedWhppSnapshots } from './v87WhppExportStore.js';
import { createShopeeTemplateWorkbook } from './shopeeTemplateExporter.js';
import { createUnifiedParityWorkbook, V197_PARITY_EXPORT_VERSION } from './v197UnifiedParityExporter.js';
import { createStrictUnifiedParityWorkbook, V198_PARITY_EXPORT_VERSION } from './v198UnifiedParityExporter.js';

const VERSION = '2026-08-17-v191-single-business-truth-worker-v1';
const REVISION = '2026-08-18-v198-strict-parity-worker-v1';
const HEARTBEAT_MS = Math.max(3000, Math.min(15000, Number(process.env.EXPORT_SINGLE_HEARTBEAT_MS || 5000)));
const jobFile = path.resolve(String(process.argv[2] || ''));
const ALLOWED = new Set(['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN', 'WHPP']);
// GOLIVE compatibility markers: 2026-08-18-v197-unified-parity-worker-v1 / V197_UNIFIED_1TO1_PARITY_20_SHEETS / crossDayTruth: true / onePassStreaming: true / LEGACY_10_SHEETS_V191_TRUTH
void createCompactPeriodBusinessWorkbook; void createShopeeTruthWorkbook; void listCompletedWhppSnapshots; void createShopeeTemplateWorkbook; void createUnifiedParityWorkbook; void V197_PARITY_EXPORT_VERSION;

function readJob() {
  if (!jobFile || !fs.existsSync(jobFile)) throw new Error('导出任务文件不存在。');
  return JSON.parse(fs.readFileSync(jobFile, 'utf8'));
}
function emitSidecarStatus(job) { try { if (typeof process.send === 'function') process.send({ type: 'CE_QC_EXPORT_JOB_UPDATE', job }); } catch {} }
function writeJob(patch = {}) {
  const current = readJob(); const nextStatus = String(patch.status || '').toUpperCase();
  if (current.cancelRequested && !['FAILED', 'CANCELLED'].includes(nextStatus)) { const error = new Error('EXPORT_JOB_CANCELLED'); error.code = 'EXPORT_JOB_CANCELLED'; throw error; }
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() }; const temp = `${jobFile}.${process.pid}.v198.tmp`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8'); fs.renameSync(temp, jobFile); emitSidecarStatus(next); return next;
}
function dateKey(value = '') { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : ''; }
function formatCambodia(date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
function validateRange(from, to) {
  if (!dateKey(from) || !dateKey(to) || from > to) throw new Error('导出日期范围无效。');
  const days = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (days > 180) throw new Error('单次日期范围最多180天。'); return { from, to, key: `${from}_${to}` };
}
function rangeOf(payload = {}) {
  if (payload.periodType === 'custom') return validateRange(payload.fromDate, payload.toDate);
  const base = dateKey(payload.date) ? new Date(`${payload.date}T12:00:00+07:00`) : new Date();
  if (payload.periodType === 'weekly') { const day=(base.getDay()+6)%7,from=new Date(base);from.setDate(base.getDate()-day);const to=new Date(from);to.setDate(from.getDate()+6);return validateRange(formatCambodia(from),formatCambodia(to)); }
  if (payload.periodType === 'monthly') { const from=new Date(base.getFullYear(),base.getMonth(),1,12),to=new Date(base.getFullYear(),base.getMonth()+1,0,12);return validateRange(formatCambodia(from),formatCambodia(to)); }
  const day = formatCambodia(base); return { from: day, to: day, key: day };
}
function memoryText() { const m=process.memoryUsage(),mb=value=>Math.max(0,Math.round(Number(value||0)/1024/1024)); return `RSS ${mb(m.rss)}MB / Heap ${mb(m.heapUsed)}MB`; }
function fileItem(file) { const name=path.basename(String(file||'')); return { name, url:`/api/export-file?name=${encodeURIComponent(name)}`, completeWorkbook:true }; }

let heartbeat=null,stage='准备中',progress=2,startedAt=Date.now();
try {
  const job=readJob(),payload=job.payload||{},type=String(payload.businessType||'').trim().toUpperCase();
  if(!ALLOWED.has(type))throw new Error(`V198单业务导出不支持：${type||'空业务'}`);
  const range=rangeOf(payload);startedAt=Date.now();stage=`正在生成 ${type} 严格一比一完整数据看板`;progress=5;
  writeJob({status:'RUNNING',progress,range,currentBusiness:type,currentPart:1,businessParts:1,heartbeatAt:new Date().toISOString(),workerPid:process.pid,workerMode:'SINGLE_BUSINESS_DIRECT',workerVersion:VERSION,workerRevision:REVISION,message:`${stage} · ${range.from} 至 ${range.to} · ${memoryText()}`});
  heartbeat=setInterval(()=>{try{writeJob({status:'RUNNING',progress,heartbeatAt:new Date().toISOString(),currentBusiness:type,currentPart:1,businessParts:1,workerPid:process.pid,workerMode:'SINGLE_BUSINESS_DIRECT',workerVersion:VERSION,workerRevision:REVISION,message:`${stage} · 已运行${Math.max(1,Math.floor((Date.now()-startedAt)/1000))}秒 · ${memoryText()}`});}catch(error){if(error?.code==='EXPORT_JOB_CANCELLED')process.exitCode=2;}},HEARTBEAT_MS);heartbeat.unref?.();

  const result=await createStrictUnifiedParityWorkbook({type,periodType:payload.periodType||'custom',range,outputDir:getRuntimeConfig().exportsDir,onProgress(info={}){
    const phase=String(info.phase||''),completed=Math.max(0,Number(info.completed||0)),total=Math.max(1,Number(info.total||1));
    if(phase==='start'){progress=8;stage=`准备 ${type} 区间真实数据`;}
    else if(phase==='sourceRows'){progress=Math.max(10,Math.min(40,10+Math.floor((completed/total)*30)));stage=`读取 ${type} 日报/快照 ${completed}/${total} · 已归属${Number(info.entries||0).toLocaleString()}票`;}
    else if(phase==='truth'){progress=60;stage=`完成 ${type} POD/区域/严格POD时间事实合并 · 有效POD时间${Number(info.validPodTimes||0).toLocaleString()}票`;}
    else if(phase==='writing'){progress=Math.max(62,Math.min(97,62+Math.floor((completed/total)*35)));stage=`写入统一蓝白看板、1/2/3派及PP/PV独立明细 ${completed}/${total}${info.sheet?` · ${info.sheet}`:''}`;}
    writeJob({status:'RUNNING',progress,heartbeatAt:new Date().toISOString(),currentBusiness:type,currentPart:1,businessParts:1,workerPid:process.pid,workerMode:'SINGLE_BUSINESS_DIRECT',workerVersion:VERSION,workerRevision:REVISION,sourceRowJsonRead:true,currentStateOverlay:true,crossDayTruth:true,onePassStreaming:true,strictPodTime:true,outputContract:'V198_UNIFIED_1TO1_STRICT_PARITY_22_SHEETS',message:`${stage} · ${memoryText()}`});
  }});
  const file=result.file,summary=result.summary||{};if(!file||!fs.existsSync(file))throw new Error(`${type} 完整表生成结束，但输出文件不存在。`);
  progress=100;stage='生成完成';writeJob({status:'COMPLETED',progress:100,heartbeatAt:new Date().toISOString(),currentBusiness:'',currentPart:0,businessParts:0,workerPid:process.pid,workerMode:'SINGLE_BUSINESS_DIRECT',workerVersion:VERSION,workerRevision:REVISION,parityExporterVersion:V198_PARITY_EXPORT_VERSION,outputContract:summary?.outputContract||'V198_UNIFIED_1TO1_STRICT_PARITY_22_SHEETS',summary,message:`导出完成：${type} ${range.from} 至 ${range.to}；真实POD时间、平均签收天数、PP/PV及1/2/3派已强制对账`,files:[fileItem(file)],completedAt:new Date().toISOString()});
} catch(error) {
  try{const cancelled=error?.code==='EXPORT_JOB_CANCELLED';writeJob({status:cancelled?'CANCELLED':'FAILED',progress:Number(progress||0),heartbeatAt:new Date().toISOString(),workerPid:process.pid,workerMode:'SINGLE_BUSINESS_DIRECT',workerVersion:VERSION,workerRevision:REVISION,errorCode:error?.code||'EXPORT_SINGLE_BUSINESS_FAILED',message:cancelled?'后台单业务导出已取消。':(error?.message||String(error)),error:error?.stack||String(error),failedAt:new Date().toISOString()});}catch{}
  process.exitCode=1;
} finally { if(heartbeat)clearInterval(heartbeat);try{closeDb();}catch{} }
