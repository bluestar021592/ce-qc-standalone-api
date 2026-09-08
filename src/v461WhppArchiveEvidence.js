import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { getRuntimeConfig } from './db.js';

export const V461_ARCHIVE_EVIDENCE_ID='2026-09-08-v462-isolated-streaming-v266-offline-api-evidence-v1';
const gunzipAsync=promisify(gunzip);
const MAX_FILES=12000;
const CONCURRENCY=8;
const PROGRESS_EVERY=100;
const ENDPOINT_FOLDERS=Object.freeze({
  confirm:'otwms_order_confirm-query',
  track:'tms-shipment-event_query',
  exception:'exception-item_query'
});

const text=value=>String(value??'').trim();
const bill=value=>text(value).toUpperCase();
const uniq=values=>[...new Set((values||[]).map(bill).filter(Boolean))];
function addDays(date,days){const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function requestBills(body){
  if(Array.isArray(body))return uniq(body.map(item=>typeof item==='object'?(item.shipmentCode||item.waybill||item.waybillNo||item.billCode||item.trackingNo||item.运单号):item));
  if(body&&typeof body==='object'){
    for(const key of ['shipmentCodes','waybills','bills','codes'])if(Array.isArray(body[key]))return uniq(body[key]);
    const one=body.shipmentCode||body.waybill||body.waybillNo||body.billCode||body.trackingNo||body.运单号;
    return one?[bill(one)]:[];
  }
  return[];
}
function collectResponseBills(value,out=new Set(),depth=0,budget={nodes:0}){
  if(value==null||depth>7||budget.nodes>12000)return out;budget.nodes++;
  if(Array.isArray(value)){for(const item of value)collectResponseBills(item,out,depth+1,budget);return out;}
  if(typeof value!=='object')return out;
  const candidate=value.shipmentCode||value.waybill||value.waybillNo||value.billCode||value.trackingNo||value.运单号;
  if(candidate)out.add(bill(candidate));
  for(const [key,child] of Object.entries(value)){
    if(['requestBody','headers','authorization','token'].includes(String(key).toLowerCase()))continue;
    if(child&&typeof child==='object')collectResponseBills(child,out,depth+1,budget);
  }
  return out;
}
async function readEvidence(file){
  const raw=await fs.readFile(file);const json=JSON.parse((await gunzipAsync(raw)).toString('utf8'));
  return{capturedAt:text(json.capturedAt),endpoint:text(json.endpoint),label:text(json.label),request:requestBills(json.requestBody),response:[...collectResponseBills(json.responseData)]};
}
async function mapLimit(items,limit,fn){
  let cursor=0;
  async function worker(){for(;;){const i=cursor++;if(i>=items.length)return;await fn(items[i],i);}}
  await Promise.all(Array.from({length:Math.min(limit,items.length||1)},()=>worker()));
}
function publicStatsOf(stats){
  const out={};
  for(const [kind,stat] of Object.entries(stats))out[kind]={files:stat.files,relatedFiles:stat.relatedFiles,requestedDaily:stat.requestedDaily.size,responseDaily:stat.responseDaily.size,relatedRequestAll:stat.relatedRequestAll.size,earliest:stat.earliest,latest:stat.latest};
  return out;
}

export async function inspectV461WhppArchiveEvidence(reportDate='',memberBills=[],options={}){
  const started=Date.now();
  const members=new Set(uniq(memberBills));
  const onProgress=typeof options?.onProgress==='function'?options.onProgress:()=>{};
  const maxFiles=Math.max(100,Math.min(MAX_FILES,Number(options?.maxFiles||MAX_FILES)));
  const cfg=getRuntimeConfig(),apiRoot=path.join(cfg.evidenceArchiveDir,'ce_api');
  // Most WHPP work is captured on the selected day or immediately after it.
  // Search those first so progress becomes useful quickly; older-day carry is still
  // included before the bounded scan completes.
  const scanDays=[reportDate,addDays(reportDate,1),addDays(reportDate,-1),addDays(reportDate,2)];
  const files=[];let truncated=false;
  for(const day of scanDays){
    for(const [kind,folder] of Object.entries(ENDPOINT_FOLDERS)){
      const dir=path.join(apiRoot,day,folder);let names=[];try{names=await fs.readdir(dir);}catch{continue;}
      for(const name of names){if(!name.endsWith('.json.gz'))continue;if(files.length>=maxFiles){truncated=true;break;}files.push({kind,file:path.join(dir,name),day});}
      if(truncated)break;
    }
    if(truncated)break;
  }
  const stats={};for(const kind of Object.keys(ENDPOINT_FOLDERS))stats[kind]={files:0,relatedFiles:0,requestedDaily:new Set(),responseDaily:new Set(),relatedRequestAll:new Set(),earliest:'',latest:''};
  let readErrors=0,processedFiles=0;
  const publishProgress=force=>{if(force||processedFiles===0||processedFiles%PROGRESS_EVERY===0)onProgress({state:'RUNNING',processedFiles,totalFiles:files.length,readErrors,truncated,elapsedMs:Date.now()-started,endpoints:publicStatsOf(stats)});};
  publishProgress(true);
  await mapLimit(files,CONCURRENCY,async item=>{
    let evidence=null;try{evidence=await readEvidence(item.file);}catch{readErrors++;processedFiles++;publishProgress(false);return;}
    const stat=stats[item.kind];if(stat){
      stat.files++;
      const request=uniq(evidence.request),overlap=request.filter(code=>members.has(code));
      if(overlap.length){
        stat.relatedFiles++;for(const code of overlap)stat.requestedDaily.add(code);for(const code of request)stat.relatedRequestAll.add(code);
        for(const code of uniq(evidence.response))if(members.has(code))stat.responseDaily.add(code);
        const captured=text(evidence.capturedAt);if(captured){if(!stat.earliest||captured<stat.earliest)stat.earliest=captured;if(!stat.latest||captured>stat.latest)stat.latest=captured;}
      }
    }
    processedFiles++;publishProgress(false);
  });
  const publicStats=publicStatsOf(stats),memberCount=members.size;
  const anyArchive=Object.values(publicStats).some(stat=>stat.relatedFiles>0);
  const confirmRequestComplete=memberCount>0&&publicStats.confirm.requestedDaily===memberCount;
  const result={
    version:V461_ARCHIVE_EVIDENCE_ID,readOnly:true,networkCalls:0,databaseWrites:0,reportDate,memberCount,scanDays,filesConsidered:files.length,processedFiles,readErrors,truncated,
    endpoints:publicStats,anyArchive,confirmRequestComplete,trackRequestCoverage:publicStats.track.requestedDaily,exceptionRequestCoverage:publicStats.exception.requestedDaily,
    archiveDailyEvidenceCandidate:Boolean(anyArchive&&confirmRequestComplete&&!truncated&&readErrors===0),
    proofLimit:'仅统计与当日日报成员发生交集的成功CE API归档请求/响应；它证明原始API证据是否幸存，但不会仅凭请求覆盖自动认定WHPP历史完成。',
    archiveRootPresent:files.length>0,elapsedMs:Date.now()-started
  };
  onProgress({state:'COMPLETED',processedFiles,totalFiles:files.length,readErrors,truncated,elapsedMs:result.elapsedMs,endpoints:publicStats});
  return result;
}
