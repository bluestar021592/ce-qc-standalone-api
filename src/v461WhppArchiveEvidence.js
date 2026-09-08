import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { getRuntimeConfig } from './db.js';

export const V461_ARCHIVE_EVIDENCE_ID='2026-09-08-v461-bounded-v266-offline-api-evidence-census-v1';
const gunzipAsync=promisify(gunzip);
const MAX_FILES=12000;
const CONCURRENCY=8;
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
  const out=new Array(items.length);let cursor=0;
  async function worker(){for(;;){const i=cursor++;if(i>=items.length)return;try{out[i]=await fn(items[i]);}catch(error){out[i]={error:error?.message||String(error),file:items[i]};}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length||1)},()=>worker()));return out;
}

export async function inspectV461WhppArchiveEvidence(reportDate='',memberBills=[]){
  const members=new Set(uniq(memberBills));
  const cfg=getRuntimeConfig(),apiRoot=path.join(cfg.evidenceArchiveDir,'ce_api');
  const scanDays=[addDays(reportDate,-1),reportDate,addDays(reportDate,1),addDays(reportDate,2)];
  const files=[];let truncated=false;
  for(const day of scanDays){
    for(const [kind,folder] of Object.entries(ENDPOINT_FOLDERS)){
      const dir=path.join(apiRoot,day,folder);let names=[];try{names=await fs.readdir(dir);}catch{continue;}
      for(const name of names){if(!name.endsWith('.json.gz'))continue;if(files.length>=MAX_FILES){truncated=true;break;}files.push({kind,file:path.join(dir,name),day});}
      if(truncated)break;
    }
    if(truncated)break;
  }
  const decoded=await mapLimit(files,CONCURRENCY,async item=>({...item,...await readEvidence(item.file)}));
  const stats={};for(const kind of Object.keys(ENDPOINT_FOLDERS))stats[kind]={files:0,relatedFiles:0,requestedDaily:new Set(),responseDaily:new Set(),relatedRequestAll:new Set(),earliest:'',latest:''};
  let readErrors=0;
  for(const item of decoded){
    if(item?.error){readErrors++;continue;}const stat=stats[item.kind];if(!stat)continue;stat.files++;
    const request=uniq(item.request),overlap=request.filter(code=>members.has(code));if(!overlap.length)continue;
    stat.relatedFiles++;for(const code of overlap)stat.requestedDaily.add(code);for(const code of request)stat.relatedRequestAll.add(code);
    for(const code of uniq(item.response))if(members.has(code))stat.responseDaily.add(code);
    const captured=text(item.capturedAt);if(captured){if(!stat.earliest||captured<stat.earliest)stat.earliest=captured;if(!stat.latest||captured>stat.latest)stat.latest=captured;}
  }
  const publicStats={};
  for(const [kind,stat] of Object.entries(stats))publicStats[kind]={files:stat.files,relatedFiles:stat.relatedFiles,requestedDaily:stat.requestedDaily.size,responseDaily:stat.responseDaily.size,relatedRequestAll:stat.relatedRequestAll.size,earliest:stat.earliest,latest:stat.latest};
  const memberCount=members.size;
  const anyArchive=Object.values(publicStats).some(stat=>stat.relatedFiles>0);
  const confirmRequestComplete=memberCount>0&&publicStats.confirm.requestedDaily===memberCount;
  const trackRequestCoverage=publicStats.track.requestedDaily;
  const exceptionRequestCoverage=publicStats.exception.requestedDaily;
  return{
    version:V461_ARCHIVE_EVIDENCE_ID,readOnly:true,networkCalls:0,databaseWrites:0,reportDate,memberCount,scanDays,filesConsidered:files.length,readErrors,truncated,
    endpoints:publicStats,anyArchive,confirmRequestComplete,trackRequestCoverage,exceptionRequestCoverage,
    archiveDailyEvidenceCandidate:Boolean(anyArchive&&confirmRequestComplete&&!truncated&&readErrors===0),
    proofLimit:'仅统计与当日日报成员发生交集的成功CE API归档请求/响应；它证明原始API证据是否幸存，但不会仅凭请求覆盖自动认定WHPP历史完成。',
    archiveRootPresent:files.length>0
  };
}
