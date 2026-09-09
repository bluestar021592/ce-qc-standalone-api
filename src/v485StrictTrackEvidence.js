import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { getRuntimeConfig } from './db.js';

export const V485_STRICT_TRACK_EVIDENCE_ID='2026-09-09-v485-nested-track-normalizer-v266-archive-reuse-v1';
const gzipAsync=promisify(gzip),gunzipAsync=promisify(gunzip);
const MAX_DEPTH=9;
const MAX_NODES=30000;
const ARCHIVE_CONCURRENCY=8;
const ARCHIVE_MAX_FILES=12000;
const TRACK_FOLDER='tms-shipment-event_query';
const V266_ARCHIVE_ID='2026-08-23-v266-evergreen-evidence-archive-v1';
const V266_RETENTION_DAYS=366;
const V266_POLICY='NO_AUTOMATIC_ARCHIVE_DELETE_BEFORE_OR_AFTER_RETENTION; annual cleanup requires an explicit future guarded action';
const BILL_KEYS=['shipmentCode','waybill','waybillNo','billCode','trackingNo','运单号'];
const CODE_KEYS=['eventCode','trackingEventCode','statusCode','eventStatusCode','nodeCode','scanCode','trackCode','trackingCode','shipmentEventCode','operationCode','operateCode','eventTypeCode','statusTypeCode'];
const TIME_KEYS=['eventTime','creationDate','lastUpdateDate','createdAt','eventDate','occurTime','occurrenceTime','trackingTime','scanTime','operateTime','operationTime'];
const TEXT_KEYS=['trackingEventDesc','trackingEventDescZh','trackingEventDescKm','statusText','statusName','eventName','remark','memo','message','place','eventShop','locationCode','description'];
const SKIP_KEYS=new Set(['headers','authorization','cookie','token','requestbody']);
const text=value=>String(value??'').trim();
const bill=value=>text(value).toUpperCase();
const uniq=values=>[...new Set((values||[]).map(bill).filter(Boolean))];

function directValue(obj,keys){for(const key of keys){const value=obj?.[key];if(value!==undefined&&value!==null&&typeof value!=='object'&&text(value))return value;}return'';}
function directBill(obj){return bill(directValue(obj,BILL_KEYS));}
function hasAny(obj,keys){return keys.some(key=>obj?.[key]!==undefined&&obj?.[key]!==null&&text(obj?.[key]));}
function looksLikeEvent(obj){
  if(!obj||typeof obj!=='object'||Array.isArray(obj))return false;
  if(hasAny(obj,CODE_KEYS))return true;
  return hasAny(obj,TIME_KEYS)&&hasAny(obj,TEXT_KEYS);
}
function parseMaybeJson(value){if(typeof value!=='string')return value;const s=value.trim();if(!(s.startsWith('{')||s.startsWith('[')))return value;try{return JSON.parse(s);}catch{return value;}}
function eventSignature(row){
  const code=text(directValue(row,CODE_KEYS));const time=text(directValue(row,TIME_KEYS));const desc=text(directValue(row,TEXT_KEYS)).slice(0,160);
  return`${bill(row.shipmentCode)}|${time}|${code}|${desc}`;
}

export function normalizeV485TrackRows(input,{fallbackBills=[]}={}){
  const out=[],seen=new Set(),fallback=uniq(fallbackBills),budget={nodes:0};
  function visit(value,inheritedBill='',depth=0){
    if(value==null||depth>MAX_DEPTH||budget.nodes++>MAX_NODES)return;
    value=parseMaybeJson(value);
    if(Array.isArray(value)){for(const child of value)visit(child,inheritedBill,depth+1);return;}
    if(!value||typeof value!=='object')return;
    const ownBill=directBill(value),resolvedBill=ownBill||inheritedBill||(fallback.length===1?fallback[0]:'');
    if(resolvedBill&&looksLikeEvent(value)){
      const row={...value,shipmentCode:resolvedBill};
      if(row.rawJson===undefined)row.rawJson=value;
      const sig=eventSignature(row);if(!seen.has(sig)){seen.add(sig);out.push(row);}
    }
    for(const [key,childRaw] of Object.entries(value)){
      if(SKIP_KEYS.has(String(key).toLowerCase()))continue;
      if(childRaw&&typeof childRaw==='object')visit(childRaw,resolvedBill,depth+1);
      else if(typeof childRaw==='string'&&(/^\s*[\[{]/.test(childRaw)))visit(childRaw,resolvedBill,depth+1);
    }
  }
  visit(input,'',0);
  return out;
}

export function requestBillsFromV485Archive(body){
  if(Array.isArray(body))return uniq(body.map(item=>typeof item==='object'?directValue(item,BILL_KEYS):item));
  if(body&&typeof body==='object'){
    for(const key of ['shipmentCodes','waybills','bills','codes'])if(Array.isArray(body[key]))return uniq(body[key]);
    const one=directValue(body,BILL_KEYS);return one?[bill(one)]:[];
  }
  return[];
}

function addDays(date,days){const d=new Date(`${date}T12:00:00Z`);if(Number.isNaN(d.getTime()))return'';d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function rangeDays(from,to){const out=[];let day=text(from).slice(0,10),guard=0;while(day&&day<=to&&guard++<190){out.push(day);day=addDays(day,1);}return out;}
function orderedArchiveDays(range={},mode='recent'){
  const from=text(range.from||range.fromDate).slice(0,10),to=text(range.to||range.toDate).slice(0,10),today=new Date().toISOString().slice(0,10);
  const recent=[today,addDays(today,-1),to,addDays(to,1),addDays(to,-1)].filter(Boolean),recentSet=new Set(recent);
  if(mode==='recent')return[...new Set(recent)];
  const historical=rangeDays(from,to).reverse().filter(day=>!recentSet.has(day));
  if(mode==='history')return historical;
  return[...new Set([...recent,...historical])];
}
async function mapLimit(items,limit,fn){let cursor=0;async function worker(){for(;;){const index=cursor++;if(index>=items.length)return;await fn(items[index],index);}}await Promise.all(Array.from({length:Math.min(limit,Math.max(1,items.length))},()=>worker()));}
async function readArchive(file){const raw=await fs.readFile(file);return JSON.parse((await gunzipAsync(raw)).toString('utf8'));}

export async function archiveV485TrackQueryResponse(requestBills,responseRows){
  const requestBody=uniq(requestBills);if(!requestBody.length)return{archived:false,skipped:true,reason:'NO_BILLS'};
  const cfg=getRuntimeConfig(),capturedAt=new Date().toISOString(),day=capturedAt.slice(0,10),dir=path.join(cfg.evidenceArchiveDir,'ce_api',day,TRACK_FOLDER);await fs.mkdir(dir,{recursive:true});
  const responseData={success:true,data:Array.isArray(responseRows)?responseRows:[]},endpoint='/api/tms-shipment-event/query',label='V485_EXPORT_RESIDUAL_TRACK';
  const canonical=JSON.stringify({endpoint,label,requestBody,responseData});const sha256=crypto.createHash('sha256').update(canonical).digest('hex'),file=path.join(dir,`${sha256}.json.gz`);
  const retain=new Date(capturedAt);retain.setUTCDate(retain.getUTCDate()+V266_RETENTION_DAYS);
  const payload={id:V266_ARCHIVE_ID,kind:'CE_API_EVIDENCE',capturedAt,retainUntil:retain.toISOString(),policy:V266_POLICY,endpoint,label,requestBody,responseData};
  const compressed=await gzipAsync(Buffer.from(JSON.stringify(payload),'utf8'),{level:6});
  try{await fs.writeFile(file,compressed,{flag:'wx'});return{archived:true,deduped:false,sha256,file,bytes:compressed.length};}catch(error){if(error?.code==='EEXIST')return{archived:true,deduped:true,sha256,file};throw error;}
}

export async function recoverV485ArchivedTrackEvents({range={},targetBills=[],mode='recent',onProgress=()=>{},maxFiles=ARCHIVE_MAX_FILES}={}){
  const targets=new Set(uniq(targetBills));const eventsByBill=new Map([...targets].map(code=>[code,[]]));
  if(!targets.size)return{eventsByBill,filesConsidered:0,processedFiles:0,matchedFiles:0,requestBillsMatched:0,eventBills:0,readErrors:0,truncated:false};
  const cfg=getRuntimeConfig(),apiRoot=path.join(cfg.evidenceArchiveDir,'ce_api'),days=orderedArchiveDays(range,mode),files=[];let truncated=false;
  for(const day of days){let names=[];try{names=await fs.readdir(path.join(apiRoot,day,TRACK_FOLDER));}catch{continue;}for(const name of names){if(!name.endsWith('.json.gz'))continue;if(files.length>=maxFiles){truncated=true;break;}files.push(path.join(apiRoot,day,TRACK_FOLDER,name));}if(truncated)break;}
  let processedFiles=0,matchedFiles=0,readErrors=0;const requested=new Set(),eventBills=new Set();
  const publish=force=>{if(force||processedFiles%100===0||processedFiles===files.length)onProgress({phase:'strictExportEvidenceArchive',mode,completed:processedFiles,total:files.length,matchedFiles,requestBillsMatched:requested.size,eventBills:eventBills.size,readErrors,truncated,evidenceRepairVersion:V485_STRICT_TRACK_EVIDENCE_ID});};
  publish(true);
  await mapLimit(files,ARCHIVE_CONCURRENCY,async file=>{
    let payload=null;try{payload=await readArchive(file);}catch{readErrors++;processedFiles++;publish(false);return;}
    const req=requestBillsFromV485Archive(payload?.requestBody),overlap=req.filter(code=>targets.has(code));
    if(overlap.length){
      matchedFiles++;for(const code of overlap)requested.add(code);
      const normalized=normalizeV485TrackRows(payload?.responseData?.data??payload?.responseData??[],{fallbackBills:overlap});
      for(const event of normalized){const code=bill(event.shipmentCode);if(!targets.has(code))continue;eventsByBill.get(code)?.push(event);eventBills.add(code);}
    }
    processedFiles++;publish(false);
  });
  publish(true);
  return{eventsByBill,filesConsidered:files.length,processedFiles,matchedFiles,requestBillsMatched:requested.size,eventBills:eventBills.size,readErrors,truncated};
}

console.info('[CE-QC][V485_STRICT_TRACK_EVIDENCE]',V485_STRICT_TRACK_EVIDENCE_ID,'nested CE track payloads inherit parent shipmentCode; strict export reuses and writes V266-compatible track gzip evidence before repeated residual CE requests.');
