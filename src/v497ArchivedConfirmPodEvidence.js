import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { getRuntimeConfig } from './db.js';

export const V497_ARCHIVED_CONFIRM_POD_DATE_ID='2026-09-10-v497-v266-confirm85-pod-date-recovery-v1';
const gunzipAsync=promisify(gunzip);
const ARCHIVE_CONCURRENCY=8;
const ARCHIVE_MAX_FILES=12000;
const CONFIRM_FOLDER='otwms_order_confirm-query';
const BILL_KEYS=['shipmentCode','waybill','waybillNo','billCode','trackingNo','运单号'];
const EXPLICIT_POD_TIME_KEYS=['POD时间','podTime','podClosedAt','podAt','deliveredAt','deliveryCompletedAt','签收时间','signTime','signedTime'];
const TERMINAL_STATUS_TIME_KEYS=['updateTime','lastUpdateDate','scanTime','statusTime','modifyTime'];
const TERMINAL_TEXT_KEYS=['currentState','state','status','shipmentStatus','statusName','orderStatusDesc'];
const TERMINAL_TEXT=new Set(['POD','DELIVERED','SIGNED','签收','已签收','妥投','已妥投']);
const text=value=>String(value??'').trim();
const bill=value=>text(value).toUpperCase();
const uniq=values=>[...new Set((values||[]).map(bill).filter(Boolean))];
const dateKey=value=>{const m=text(value).match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};

function directValue(obj,keys){for(const key of keys){const value=obj?.[key];if(value!==undefined&&value!==null&&typeof value!=='object'&&text(value))return value;}return'';}
function directBill(obj){return bill(directValue(obj,BILL_KEYS));}
function terminalProof(row={}){
  if(text(row.orderStatus)==='85')return true;
  return TERMINAL_TEXT_KEYS.some(key=>TERMINAL_TEXT.has(text(row?.[key]).toUpperCase()));
}
function terminalTime(row={}){
  for(const key of EXPLICIT_POD_TIME_KEYS){const value=row?.[key],podDate=dateKey(value);if(podDate)return{podDate,timestamp:text(value),field:key,priority:0};}
  for(const key of TERMINAL_STATUS_TIME_KEYS){const value=row?.[key],podDate=dateKey(value);if(podDate)return{podDate,timestamp:text(value),field:key,priority:1};}
  return null;
}
function requestBills(body){
  if(Array.isArray(body))return uniq(body.map(item=>typeof item==='object'?directValue(item,BILL_KEYS):item));
  if(body&&typeof body==='object'){
    for(const key of ['shipmentCodes','waybills','bills','codes'])if(Array.isArray(body[key]))return uniq(body[key]);
    const one=directValue(body,BILL_KEYS);return one?[bill(one)]:[];
  }
  return[];
}
function betterEvidence(next,previous){
  if(!previous)return true;
  if(Number(next.priority)!==Number(previous.priority))return Number(next.priority)<Number(previous.priority);
  if(next.podDate!==previous.podDate)return next.podDate<previous.podDate;
  return text(next.timestamp)<text(previous.timestamp);
}

export function extractV497ConfirmPodEvidence(payload={},targetBills=[]){
  const targets=new Set(uniq(targetBills)),evidenceByBill=new Map();
  if(!targets.size)return evidenceByBill;
  const requested=requestBills(payload?.requestBody),overlap=new Set(requested.filter(code=>targets.has(code)));
  if(!overlap.size)return evidenceByBill;
  const root=payload?.responseData?.data??payload?.responseData??[];
  let nodes=0;
  function visit(value,inheritedBill='',depth=0){
    if(value==null||depth>8||nodes++>30000)return;
    if(typeof value==='string'&&/^\s*[\[{]/.test(value)){try{visit(JSON.parse(value),inheritedBill,depth+1);}catch{}return;}
    if(Array.isArray(value)){for(const child of value)visit(child,inheritedBill,depth+1);return;}
    if(!value||typeof value!=='object')return;
    const ownBill=directBill(value),resolvedBill=ownBill||(overlap.size===1?inheritedBill||[...overlap][0]:'');
    if(resolvedBill&&overlap.has(resolvedBill)&&terminalProof(value)){
      const time=terminalTime(value);
      if(time){const evidence={shipmentCode:resolvedBill,...time,terminalProof:text(value.orderStatus)==='85'?'orderStatus=85':'terminal-text'};if(betterEvidence(evidence,evidenceByBill.get(resolvedBill)))evidenceByBill.set(resolvedBill,evidence);}
    }
    for(const child of Object.values(value))if(child&&typeof child==='object')visit(child,resolvedBill,depth+1);
  }
  visit(root,'',0);
  return evidenceByBill;
}

function addDays(date,days){const d=new Date(`${date}T12:00:00Z`);if(Number.isNaN(d.getTime()))return'';d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function rangeDays(from,to){const out=[];let day=text(from).slice(0,10),guard=0;while(day&&day<=to&&guard++<190){out.push(day);day=addDays(day,1);}return out;}
function orderedArchiveDays(range={},mode='recent'){
  const from=text(range.from||range.fromDate).slice(0,10),to=text(range.to||range.toDate).slice(0,10),today=new Date().toISOString().slice(0,10);
  const recent=[];for(let i=0;i<=14;i++)recent.push(addDays(today,-i));for(const day of [to,addDays(to,1),addDays(to,-1)])if(day)recent.push(day);
  const recentUnique=[...new Set(recent.filter(Boolean))],recentSet=new Set(recentUnique);
  if(mode==='recent')return recentUnique;
  if(mode==='history')return rangeDays(from,to).reverse().filter(day=>!recentSet.has(day));
  return[...recentUnique,...rangeDays(from,to).reverse().filter(day=>!recentSet.has(day))];
}
async function mapLimit(items,limit,fn){let cursor=0;async function worker(){for(;;){const index=cursor++;if(index>=items.length)return;await fn(items[index],index);}}await Promise.all(Array.from({length:Math.min(limit,Math.max(1,items.length))},()=>worker()));}
async function readArchive(file){const raw=await fs.readFile(file);return JSON.parse((await gunzipAsync(raw)).toString('utf8'));}

export async function recoverV497ArchivedConfirmPodDates({range={},targetBills=[],mode='recent',onProgress=()=>{},maxFiles=ARCHIVE_MAX_FILES}={}){
  const targets=uniq(targetBills),targetSet=new Set(targets),evidenceByBill=new Map();
  if(!targets.length)return{evidenceByBill,filesConsidered:0,processedFiles:0,matchedFiles:0,requestBillsMatched:0,podDateBills:0,readErrors:0,truncated:false};
  const cfg=getRuntimeConfig(),archiveRoot=cfg.evidenceArchiveDir||path.join(cfg.dataDir,'evidence_archive'),apiRoot=path.join(archiveRoot,'ce_api'),days=orderedArchiveDays(range,mode),files=[];let truncated=false;
  for(const day of days){let names=[];try{names=await fs.readdir(path.join(apiRoot,day,CONFIRM_FOLDER));}catch{continue;}for(const name of names){if(!name.endsWith('.json.gz'))continue;if(files.length>=maxFiles){truncated=true;break;}files.push(path.join(apiRoot,day,CONFIRM_FOLDER,name));}if(truncated)break;}
  let processedFiles=0,matchedFiles=0,readErrors=0;const requested=new Set();
  const publish=force=>{if(force||processedFiles%100===0||processedFiles===files.length)onProgress({phase:'strictExportEvidenceSavedDone',confirmArchive:true,confirmArchiveMode:mode,completed:processedFiles,total:files.length,matchedFiles,requestBillsMatched:requested.size,podDateBills:evidenceByBill.size,readErrors,truncated,evidenceRepairVersion:V497_ARCHIVED_CONFIRM_POD_DATE_ID});};
  publish(true);
  await mapLimit(files,ARCHIVE_CONCURRENCY,async file=>{
    let payload=null;try{payload=await readArchive(file);}catch{readErrors++;processedFiles++;publish(false);return;}
    const req=requestBills(payload?.requestBody),overlap=req.filter(code=>targetSet.has(code));
    if(overlap.length){
      matchedFiles++;for(const code of overlap)requested.add(code);
      const found=extractV497ConfirmPodEvidence(payload,overlap);
      for(const [code,evidence] of found){if(betterEvidence(evidence,evidenceByBill.get(code)))evidenceByBill.set(code,evidence);}
    }
    processedFiles++;publish(false);
  });
  publish(true);
  return{evidenceByBill,filesConsidered:files.length,processedFiles,matchedFiles,requestBillsMatched:requested.size,podDateBills:evidenceByBill.size,readErrors,truncated};
}

console.info('[CE-QC][V497_ARCHIVED_CONFIRM_POD_DATE]',V497_ARCHIVED_CONFIRM_POD_DATE_ID,'formal Shopee export may recover a missing POD date only from exact-member V266 confirm-query evidence with saved terminal proof (orderStatus=85 or exact POD terminal text) plus a saved response timestamp; archive capture time, file mtime, updatedAt, export time and lastCheckedAt are never used.');
