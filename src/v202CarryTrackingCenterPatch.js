import express from 'express';
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import { getDb, nowIso } from './db.js';
import {
  processCarryFamilyForRefresh,
  applySuccessfulCarryRefresh,
  activeBusinessProcessingDetails
} from './carryoverRefreshScheduler.js';
import { CEClient } from './ceClient.js';

export const V202_CARRY_CENTER_VERSION = '2026-08-18-v202-seven-business-carry-tracking-center-v1';
const TYPES = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
const TYPE_SET = new Set(TYPES);
const JOBS = new Map();
const ACTIVE = new Map();
const JOB_TTL = 2 * 60 * 60_000;
const CANCEL_RE = /ORDER_CANCELLED|CANCELLED|CANCELED|订单取消|已取消|取消订单/i;
const RETURN_RE = /RETURN(?:ED|_COMPLETED)?|退回完成|已退回|R退回|P4008/i;
const POD_RE = /\bPOD\b|DELIVERED|签收|妥投|已妥投|4004/i;
const ANOMALY_RE = /PENDING|OC\d|盘点|工单|入库无扫描|门店滞留|门店途中2|严重超时|超时未更新|节点未更新|无轨迹|待重试|API.*失败|中转节点停留|三次.*未退回|WHPP.*滞留/i;

function safeJson(value, fallback = {}) { try { return value && typeof value === 'object' ? value : (JSON.parse(String(value || '')) || fallback); } catch { return fallback; } }
function billOf(row = {}) { return String(row.shipmentCode || row.运单号 || '').trim().toUpperCase(); }
function dateKey(value = '') { const text = String(value || '').slice(0,10); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''; }
function normalizeType(value = '', allowAll = true) { const type=String(value||'').trim().toUpperCase(); return (allowAll && type==='ALL') ? 'ALL' : (TYPE_SET.has(type) ? type : ''); }
function categoryOf(state = {}) { return String(state.primaryCategory || state.currentMainCategory || state.主分类 || state.异常分类 || state.currentState || state.state || '').trim(); }
function latestNodeOf(state = {}) { return String(state.latestEventDesc || state.最后节点 || state.latestNode || state.lastEvent || '').trim(); }
function lastEventTimeOf(state = {}) { return String(state.latestEventTime || state.最后节点时间 || state.lastEventTime || state.POD时间 || state.podTime || state.退回完成时间 || '').trim(); }
function terminalClass(row = {}) {
  const state=safeJson(row.stateJson,{});
  const close=String(row.closeReason||'').toUpperCase();
  const current=String(state.currentState || state.scanNormalizedState || state.state || '').toUpperCase();
  const text=[close,current,categoryOf(state),latestNodeOf(state),state.退回状态,state.statusDesc].map(v=>String(v||'')).join(' ');
  const pod = close==='POD' || state.是否POD==='是' || String(state.orderStatus||'')==='85' || current==='POD' || POD_RE.test(text);
  const returned = !pod && (['RETURNED','RETURN_COMPLETED'].includes(close) || ['RETURNED','RETURN_COMPLETED'].includes(current) || state.退回状态==='已退回' || RETURN_RE.test(text));
  const cancelled = !pod && !returned && (close==='ORDER_CANCELLED' || current==='ORDER_CANCELLED' || String(state.orderStatus||'')==='10' || state.订单取消==='是' || CANCEL_RE.test(text));
  return { pod, returned, cancelled, terminal:pod||returned||cancelled, kind:pod?'POD':returned?'RETURNED':cancelled?'CANCELLED':'OPEN', state };
}
function isAnomaly(row = {}) {
  const cls=terminalClass(row); if(cls.terminal) return false;
  const state=cls.state; const category=categoryOf(state);
  const api=String(row.apiStatus||state.API状态||state.查询状态||'');
  if (/失败|RETRY|FAILED|PENDING_RETRY/i.test(api)) return true;
  if (ANOMALY_RE.test(category)) return true;
  if (Number(state.Pending次数||state.Pending当前次数||0)>0) return true;
  if (Number(state.OC天数||0)>0) return true;
  if (Number(state.盘点天数||0)>=2) return true;
  if (state.入库无扫描节点==='是' || state.严重超时==='是' || state.无轨迹==='是') return true;
  return false;
}
function familyOf(type) { if(type==='WHPP')return 'WHPP'; if(type==='SHOPEECN'||type==='SHOPEEVN')return 'SHOPEE'; return 'CCSL'; }
function allRows(db=getDb()) {
  return db.prepare(`SELECT shipmentCode,UPPER(COALESCE(businessType,'')) businessType,sourceReportDate,lastReportDate,status,apiStatus,closeReason,stateJson,createdAt,updatedAt FROM carryover_open_items ORDER BY sourceReportDate,shipmentCode`).all();
}
function parseSelection(input={}) {
  const businessType=normalizeType(input.businessType || 'ALL');
  if(!businessType) throw new Error('业务板块无效。');
  let fromDate=dateKey(input.fromDate), toDate=dateKey(input.toDate);
  if(fromDate && toDate && fromDate>toDate) throw new Error('开始日期不能晚于结束日期。');
  const scope=String(input.scope||'OPEN').toUpperCase();
  if(!['OPEN','ALL','CLOSED','ANOMALY'].includes(scope)) throw new Error('筛选范围无效。');
  return { businessType, fromDate, toDate, scope };
}
function filterRows(rows, selection) {
  return rows.filter(row=>{
    const type=String(row.businessType||'').toUpperCase(); if(selection.businessType!=='ALL' && type!==selection.businessType)return false;
    const d=dateKey(row.sourceReportDate); if(selection.fromDate && d<selection.fromDate)return false; if(selection.toDate && d>selection.toDate)return false;
    const cls=terminalClass(row); const open=String(row.status||'').toUpperCase()==='OPEN' && !cls.terminal;
    if(selection.scope==='OPEN' && !open)return false;
    if(selection.scope==='CLOSED' && open)return false;
    if(selection.scope==='ANOMALY' && !isAnomaly(row))return false;
    return true;
  });
}
function publicRow(row={}) {
  const cls=terminalClass(row), state=cls.state;
  return {
    sourceReportDate:row.sourceReportDate||'', businessType:String(row.businessType||'').toUpperCase(), shipmentCode:billOf(row),
    status:String(row.status||''), terminalKind:cls.kind, currentCategory:categoryOf(state), currentState:String(state.currentState||state.state||''),
    latestNode:latestNodeOf(state), lastEventTime:lastEventTimeOf(state), apiStatus:String(row.apiStatus||state.API状态||state.查询状态||''),
    pendingCount:Number(state.Pending次数||state.Pending当前次数||state.pendingDistinctDayCount||0), ocDays:Number(state.OC天数||0), cycleDays:Number(state.盘点天数||0),
    region:String(state.regionCode||state.区域||''), recipientGroup:String(state.recipient_group||state.recipientGroup||''),
    closeReason:String(row.closeReason||''), anomaly:isAnomaly(row), lastReportDate:row.lastReportDate||'', updatedAt:row.updatedAt||''
  };
}
function summarize(rows) {
  const summary={ total:rows.length, open:0, closed:0, pod:0, returned:0, cancelled:0, anomaly:0, retry:0, byBusiness:{}, earliestSourceDate:'', latestSourceDate:'', lastUpdatedAt:'' };
  for(const type of TYPES) summary.byBusiness[type]={ total:0, open:0, closed:0, pod:0, returned:0, cancelled:0, anomaly:0, retry:0 };
  for(const row of rows){
    const type=String(row.businessType||'').toUpperCase(); if(!summary.byBusiness[type])continue;
    const cls=terminalClass(row); const open=String(row.status||'').toUpperCase()==='OPEN'&&!cls.terminal; const anomaly=isAnomaly(row); const retry=/FAILED|RETRY|失败|重试/i.test(String(row.apiStatus||''));
    const target=summary.byBusiness[type]; target.total++;
    if(open){summary.open++;target.open++;}else{summary.closed++;target.closed++;}
    if(cls.pod){summary.pod++;target.pod++;} if(cls.returned){summary.returned++;target.returned++;} if(cls.cancelled){summary.cancelled++;target.cancelled++;}
    if(anomaly){summary.anomaly++;target.anomaly++;} if(retry){summary.retry++;target.retry++;}
    const source=dateKey(row.sourceReportDate); if(source&&(!summary.earliestSourceDate||source<summary.earliestSourceDate))summary.earliestSourceDate=source; if(source&&source>summary.latestSourceDate)summary.latestSourceDate=source;
    const updated=String(row.updatedAt||''); if(updated>summary.lastUpdatedAt)summary.lastUpdatedAt=updated;
  }
  return summary;
}
function appMeta(db,key){try{return String(db.prepare('SELECT value FROM app_meta WHERE key=?').get(key)?.value||'');}catch{return '';}}
function setMeta(db,key,value){db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(key,String(value??''),nowIso());}
function summaryHandler(req,res){
  try{ const selection=parseSelection(req.query||{}); const source=allRows(); const filtered=filterRows(source,selection); res.setHeader('Cache-Control','no-store'); res.json({ok:true,version:V202_CARRY_CENTER_VERSION,selection,summary:summarize(filtered),globalSummary:summarize(source),lastSelectiveRefreshAt:appMeta(getDb(),'v202_carry_center_last_refresh_at'),generatedAt:new Date().toISOString()}); }
  catch(error){res.status(400).json({ok:false,error:error.message});}
}
function rowsHandler(req,res){
  try{ const selection=parseSelection(req.query||{}); const page=Math.max(1,Number(req.query.page||1)),pageSize=Math.max(20,Math.min(1000,Number(req.query.pageSize||200))); let rows=filterRows(allRows(),selection); const keyword=String(req.query.keyword||'').trim().toUpperCase(); if(keyword)rows=rows.filter(row=>{const p=publicRow(row);return [p.shipmentCode,p.currentCategory,p.latestNode,p.businessType].join(' ').toUpperCase().includes(keyword);}); const total=rows.length,start=(page-1)*pageSize; res.setHeader('Cache-Control','no-store'); res.json({ok:true,version:V202_CARRY_CENTER_VERSION,selection,total,page,pageSize,rows:rows.slice(start,start+pageSize).map(publicRow),summary:summarize(rows),generatedAt:new Date().toISOString()}); }
  catch(error){res.status(400).json({ok:false,error:error.message});}
}
function cleanupJobs(){const cutoff=Date.now()-JOB_TTL;for(const[id,job]of JOBS){const at=Date.parse(job.updatedAt||job.createdAt||'')||0;if(at<cutoff&&!['QUEUED','RUNNING','WAITING'].includes(job.status))JOBS.delete(id);}}
function patchJob(job,patch={}){Object.assign(job,patch,{updatedAt:new Date().toISOString()});return job;}
function selectionKey(s){return `${s.businessType}|${s.fromDate||'*'}|${s.toDate||'*'}`;}
async function runRefreshJob(job){
  const db=getDb(),selection=job.selection,key=selectionKey(selection);
  try{
    const blockers=activeBusinessProcessingDetails(db); if(blockers.active){patchJob(job,{status:'WAITING',message:'当前有前台处理任务，等待完成后请重新点击刷新。',blockers:blockers.blockers});return;}
    const source=filterRows(allRows(db),{...selection,scope:'OPEN'}).filter(row=>!terminalClass(row).terminal);
    if(!source.length){patchJob(job,{status:'COMPLETED',progress:100,message:'所选范围没有需要刷新的未闭环票。',before:summarize(filterRows(allRows(db),selection)),after:summarize(filterRows(allRows(db),selection)),completedAt:new Date().toISOString()});return;}
    const byType=new Map();for(const row of source){const type=String(row.businessType||'').toUpperCase();if(!byType.has(type))byType.set(type,[]);byType.get(type).push(row);}
    const client=new CEClient();let done=0,refreshed=0,failed=0;const failedBills=[];patchJob(job,{status:'RUNNING',progress:1,total:source.length,completed:0,message:`开始刷新 ${source.length.toLocaleString('zh-CN')} 票真实最新状态`});
    for(const [type,rows] of byType){
      patchJob(job,{status:'RUNNING',message:`正在刷新 ${type} · ${rows.length.toLocaleString('zh-CN')}票`,currentBusiness:type,progress:Math.max(2,Math.floor(done/source.length*90))});
      const outcome=await processCarryFamilyForRefresh(familyOf(type),rows,{client,reportDate:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),refreshId:`${job.jobId}-${type}`});
      if(outcome.successfulRows?.length){applySuccessfulCarryRefresh(outcome.successfulRows,{snapshotId:job.jobId,reportDate:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())});refreshed+=outcome.successfulRows.length;}
      failed+=outcome.failedBills?.length||0;failedBills.push(...(outcome.failedBills||[]));done+=rows.length;patchJob(job,{completed:done,refreshed,failed,progress:Math.min(95,Math.floor(done/source.length*95)),message:`已处理 ${done}/${source.length} · 成功 ${refreshed} · 待重试 ${failed}`});
    }
    setMeta(db,'v202_carry_center_last_refresh_at',nowIso());setMeta(db,'v202_carry_center_last_refresh_selection',JSON.stringify(selection));
    const afterRows=filterRows(allRows(db),selection);patchJob(job,{status:'COMPLETED',progress:100,completed:source.length,refreshed,failed,failedBills:failedBills.slice(0,100),after:summarize(afterRows),message:`刷新完成 · 成功更新 ${refreshed} · 待重试 ${failed} · 当前未闭环 ${summarize(afterRows).open}`,completedAt:new Date().toISOString()});
  }catch(error){patchJob(job,{status:'FAILED',message:error?.message||String(error),error:error?.stack||String(error),failedAt:new Date().toISOString()});}
  finally{ACTIVE.delete(key);}
}
function refreshStartHandler(req,res){
  try{cleanupJobs();const selection=parseSelection({...req.body,scope:'ALL'});const key=selectionKey(selection);const activeId=ACTIVE.get(key);if(activeId&&JOBS.has(activeId)){const job=JOBS.get(activeId);return res.status(202).json({ok:true,reused:true,jobId:job.jobId,status:job.status,message:job.message});}const jobId=`CARRY-${Date.now()}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;const job={ok:true,version:V202_CARRY_CENTER_VERSION,jobId,selection,status:'QUEUED',progress:0,message:'选择性最新状态刷新已进入后台',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};JOBS.set(jobId,job);ACTIVE.set(key,jobId);setImmediate(()=>runRefreshJob(job));res.status(202).json({ok:true,jobId,status:job.status,message:job.message});}
  catch(error){res.status(400).json({ok:false,error:error.message});}
}
function refreshJobHandler(req,res){cleanupJobs();const job=JOBS.get(String(req.params.jobId||''));if(!job)return res.status(404).json({ok:false,error:'刷新任务不存在或已过期。'});res.setHeader('Cache-Control','no-store');res.json({ok:true,...job});}
async function exportHandler(req,res){
  try{
    const selection=parseSelection(req.query||{});let rows=filterRows(allRows(),selection);const keyword=String(req.query.keyword||'').trim().toUpperCase();if(keyword)rows=rows.filter(row=>{const p=publicRow(row);return[p.shipmentCode,p.currentCategory,p.latestNode,p.businessType].join(' ').toUpperCase().includes(keyword);});
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');const name=`跨日遗留追踪_${selection.businessType}_${selection.fromDate||'ALL'}_${selection.toDate||'ALL'}_${selection.scope}_${stamp}.xlsx`;
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(name)}`);res.setHeader('Cache-Control','no-store');
    const workbook=new ExcelJS.stream.xlsx.WorkbookWriter({stream:res,useStyles:true,useSharedStrings:false});const sheet=workbook.addWorksheet('跨日遗留追踪');
    sheet.columns=[['来源日报日期','sourceReportDate',14],['业务','businessType',12],['运单号','shipmentCode',24],['当前分类','currentCategory',20],['当前状态','currentState',18],['终态','terminalKind',12],['当前是否异常','anomaly',12],['最新节点','latestNode',70],['最后节点时间','lastEventTime',22],['API状态','apiStatus',18],['Pending次数','pendingCount',12],['OC天数','ocDays',10],['盘点天数','cycleDays',10],['区域','region',12],['收件人来源','recipientGroup',14],['跨日状态','status',12],['闭环原因','closeReason',16],['最新日报日期','lastReportDate',14],['最后刷新时间','updatedAt',24]].map(([header,key,width])=>({header,key,width}));
    const header=sheet.getRow(1);header.font={bold:true};header.commit();for(const row of rows)sheet.addRow(publicRow(row)).commit();sheet.autoFilter={from:'A1',to:'S1'};sheet.commit();await workbook.commit();
  }catch(error){if(!res.headersSent)res.status(400).json({ok:false,error:error.message});else try{res.end();}catch{}}
}
let installed=false;const previousListen=express.application.listen;
express.application.listen=function v202CarryCenterListen(...args){if(!installed){installed=true;this.get('/api/v202/carry/summary',summaryHandler);this.get('/api/v202/carry/rows',rowsHandler);this.post('/api/v202/carry/refresh',refreshStartHandler);this.get('/api/v202/carry/refresh/:jobId',refreshJobHandler);this.get('/api/v202/carry/export.xlsx',exportHandler);}return previousListen.apply(this,args);};
export function inspectV202CarryCenter(){return{version:V202_CARRY_CENTER_VERSION,types:TYPES,jobs:JOBS.size,active:ACTIVE.size};}
