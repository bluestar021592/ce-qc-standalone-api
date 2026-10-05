import { CEClient } from './ceClient.js';
import { getDb } from './db.js';
import { normalizeEvent } from './analyzer.js';
import { queryTrackBatchWithFallback, splitTrackBatches } from './trackBatching.js';
import { loadWhppCanonicalTruth } from './whppCanonicalTruth.js';

export const V645_SELECTED_DATE_TIMING_REPAIR_ID='2026-10-05-v645-selected-date-pod-track-repair-v1';
const TYPES=new Set(['TBKH','WHPP','SHOPEECN','SHOPEEVN']);
const states=new Map();
const queue=new Map();
let runningKey='';
const now=()=>new Date().toISOString();
const dateKey=v=>{const s=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
const typeKey=v=>String(v||'').trim().toUpperCase();
const billOf=row=>String(row?.shipmentCode||row?.运单号||row?.waybill||row?.waybillNo||row?.trackingNo||'').trim().toUpperCase();
const storageType=type=>/^SHOPEE/.test(type)?'SHOPEE':type;
const active=s=>['QUEUED','RUNNING'].includes(String(s||'').toUpperCase());
const snapshotKey=v=>String(v||'').trim();
const keyOf=(type,date,snapshotId='')=>typeKey(type)+'|'+dateKey(date)+'|'+snapshotKey(snapshotId);

function baseState(type,date,snapshotId=''){
  return {id:V645_SELECTED_DATE_TIMING_REPAIR_ID,businessType:type,reportDate:date,snapshotId:snapshotKey(snapshotId),status:'IDLE',phase:'WAITING',total:0,completed:0,failed:0,queried:0,message:'',startedAt:'',updatedAt:'',completedAt:''};
}
function stateFor(type,date,snapshotId=''){
  const typeN=typeKey(type),dateN=dateKey(date),snap=snapshotKey(snapshotId),key=keyOf(typeN,dateN,snap);
  return states.get(key)||baseState(typeN,dateN,snap);
}
function patch(type,date,snapshotId='',value={}){
  const typeN=typeKey(type),dateN=dateKey(date),snap=snapshotKey(snapshotId),key=keyOf(typeN,dateN,snap);
  const next={...stateFor(typeN,dateN,snap),...value,businessType:typeN,reportDate:dateN,snapshotId:snap,id:V645_SELECTED_DATE_TIMING_REPAIR_ID,updatedAt:now()};
  states.set(key,next);return next;
}
function unique(values=[]){return [...new Set(values.map(v=>String(v||'').trim().toUpperCase()).filter(Boolean))].sort();}

function whppPodBills(date){
  const out=[];
  try{
    const truth=loadWhppCanonicalTruth(date);
    for(const row of truth.rows||[]){
      const pod=Boolean(row?.truthEvidence?.pod||Number(row?.isPod||0)===1||row?.是否POD==='是'||row?.POD状态==='POD'||['POD','DELIVERED','SIGNED'].includes(String(row?.currentState||'').toUpperCase()));
      if(pod)out.push(billOf(row));
    }
  }catch{}
  return unique(out);
}
function tbkhPodBills(date,snapshotId=''){
  const db=getDb(),params=[];
  let snapshot='';
  if(snapshotId){snapshot=' AND u.snapshotId=?';params.push(snapshotId);}
  try{
    const rows=db.prepare(`SELECT UPPER(TRIM(u.shipmentCode)) shipmentCode
      FROM unified_import_rows u
      LEFT JOIN final_rows f ON f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
      LEFT JOIN shipment_current_state c ON c.shipmentCode=u.shipmentCode AND c.reportDate=u.reportDate AND UPPER(TRIM(c.businessType))='TBKH'
      LEFT JOIN scan_results s ON s.shipmentCode=u.shipmentCode AND s.reportDate=u.reportDate
      WHERE u.reportDate=? AND UPPER(TRIM(u.businessType))='TBKH'${snapshot}
        AND (COALESCE(f.isPod,0)=1 OR UPPER(COALESCE(c.state,'')) IN ('POD','DELIVERED','SIGNED') OR COALESCE(s.isPod,0)=1 OR TRIM(COALESCE(s.orderStatus,''))='85')
      GROUP BY UPPER(TRIM(u.shipmentCode)) ORDER BY shipmentCode`).all(date,...params);
    return unique(rows.map(r=>r.shipmentCode));
  }catch{return[]}
}
function shopeePodBills(type,date,snapshotId=''){
  const db=getDb(),params=[storageType(type),storageType(type),storageType(type)];
  let snapshot='';
  if(snapshotId){snapshot=' AND u.snapshotId=?';}
  try{
    const rows=db.prepare(`SELECT UPPER(TRIM(u.shipmentCode)) shipmentCode
      FROM unified_import_rows u
      LEFT JOIN business_final_rows f ON f.businessType=? AND f.shipmentCode=u.shipmentCode AND f.reportDate=u.reportDate
      LEFT JOIN business_scan_results s ON s.businessType=? AND s.shipmentCode=u.shipmentCode AND s.reportDate=u.reportDate
      LEFT JOIN business_pod_locks p ON p.businessType=? AND p.shipmentCode=u.shipmentCode
      LEFT JOIN shipment_current_state c ON c.shipmentCode=u.shipmentCode AND c.reportDate=u.reportDate AND UPPER(TRIM(c.businessType)) IN (UPPER(TRIM(u.businessType)),'SHOPEE')
      WHERE u.reportDate=? AND UPPER(TRIM(u.businessType))=?${snapshot}
        AND (COALESCE(f.isPod,0)=1 OR UPPER(COALESCE(c.state,'')) IN ('POD','DELIVERED','SIGNED') OR COALESCE(s.isPod,0)=1 OR TRIM(COALESCE(s.orderStatus,''))='85' OR p.shipmentCode IS NOT NULL)
      GROUP BY UPPER(TRIM(u.shipmentCode)) ORDER BY shipmentCode`).all(...params,date,type,...(snapshotId?[snapshotId]:[]));
    return unique(rows.map(r=>r.shipmentCode));
  }catch{return[]}
}
function podBills(type,date,snapshotId=''){
  if(type==='WHPP')return whppPodBills(date);
  if(type==='TBKH')return tbkhPodBills(date,snapshotId);
  return shopeePodBills(type,date,snapshotId);
}
function groupRows(rows=[]){
  const map=new Map();
  for(const raw of rows||[]){
    const row={...normalizeEvent(raw)},bill=billOf(row);
    if(!bill)continue;
    if(!map.has(bill))map.set(bill,[]);
    map.get(bill).push(row);
  }
  return map;
}
function eventFingerprint(row={}){
  const normalized={...normalizeEvent(row)};
  const time=String(normalized.eventTime||normalized.trackingEventTime||normalized.creationDate||normalized.lastUpdateDate||'').trim();
  const code=String(normalized.eventCode??normalized.trackingEventCode??normalized.statusCode??'').trim();
  const raw=JSON.stringify(normalized);
  return time+'|'+code+'|'+raw;
}
function persistBillEvents(type,date,bill,rows=[]){
  if(!rows.length)return 0;
  const owner=storageType(type),db=getDb(),stamp=now();
  const existing=[];
  try{for(const row of db.prepare('SELECT eventTime,eventCode,rawJson FROM business_track_events WHERE businessType=? AND reportDate=? AND shipmentCode=? ORDER BY eventTime,id').all(owner,date,bill)){existing.push(row)}}catch{}
  const seen=new Set(existing.map(row=>eventFingerprint(row)));
  const insert=db.prepare('INSERT INTO business_track_events(businessType,shipmentCode,reportDate,eventTime,eventCode,rawJson,createdAt) VALUES(?,?,?,?,?,?,?)');
  let added=0;
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const raw of rows){
      const row={...normalizeEvent(raw),shipmentCode:bill,reportDate:date};
      const fp=eventFingerprint(row);if(seen.has(fp))continue;seen.add(fp);
      insert.run(owner,bill,date,row.eventTime||row.trackingEventTime||row.creationDate||row.lastUpdateDate||'',String(row.eventCode??row.trackingEventCode??row.statusCode??''),JSON.stringify(row),stamp);added++;
    }
    db.exec('COMMIT');return added;
  }catch(error){try{db.exec('ROLLBACK')}catch{};throw error}
}

async function runOne(type,date,snapshotId=''){
  const bills=podBills(type,date,snapshotId);
  patch(type,date,snapshotId,{status:'RUNNING',phase:'TRACK_QUERY',total:bills.length,completed:0,failed:0,queried:0,startedAt:now(),message:`${type} ${date} 签收时效补证：真实POD ${bills.length}票`});
  if(!bills.length)return patch(type,date,snapshotId,{status:'WAITING_FOR_POD_MEMBERS',phase:'WAITING_FOR_POD_MEMBERS',completedAt:now(),message:`${type} ${date} 当前尚未形成真实POD成员；等待扫描/轨迹处理完成后自动重试。`});
  const client=new CEClient(),batches=splitTrackBatches(bills),totalBatches=batches.length;
  let completed=0,failed=0,queried=0;
  for(let offset=0;offset<totalBatches;offset+=4){
    const wave=batches.slice(offset,offset+4);
    const results=await Promise.all(wave.map(async batch=>{
      queried+=batch.length;
      try{return await queryTrackBatchWithFallback({batch,query:codes=>client.trackQuery(codes),apiName:`v648-${type.toLowerCase()}-selected-date-timing`,fallbackSizes:[25,10,5,1],onLog:async()=>{}})}
      catch(error){return{successes:[],failures:[{batch,error}]}}
    }));
    for(const outcome of results){
      for(const success of outcome.successes||[]){
        const grouped=groupRows(success.events||[]);
        for(const codeRaw of success.batch||[]){
          const code=String(codeRaw||'').trim().toUpperCase(),rows=grouped.get(code)||[];
          if(rows.length){persistBillEvents(type,date,code,rows);completed+=1}else failed+=1;
        }
      }
      for(const failure of outcome.failures||[])failed+=(failure.batch||[]).length;
    }
    patch(type,date,snapshotId,{status:'RUNNING',phase:'TRACK_QUERY',completed,failed,queried,message:`${type} ${date} 轨迹补证 ${Math.min(offset+4,totalBatches)}/${totalBatches}批：成功 ${completed}/${bills.length}，失败 ${failed}`});
  }
  return patch(type,date,snapshotId,{status:failed?'COMPLETED_WITH_GAPS':'COMPLETED',phase:'DONE',completed,failed,queried,completedAt:now(),message:failed?`${type} ${date} 轨迹补证完成，仍有 ${failed}票待补。`:`${type} ${date} 轨迹补证完成。`});
}
async function pump(){
  if(runningKey||!queue.size)return;
  const [key,job]=queue.entries().next().value;queue.delete(key);runningKey=key;
  try{await runOne(job.type,job.date,job.snapshotId);}catch(error){patch(job.type,job.date,job.snapshotId,{status:'FAILED',phase:'FAILED',failed:Math.max(1,stateFor(job.type,job.date,job.snapshotId).failed||0),completedAt:now(),message:error?.message||String(error)});}
  finally{runningKey='';setImmediate(()=>{void pump();});}
}
export function requestSelectedDateTimingRepair(businessType='',reportDate='',snapshotId=''){
  const type=typeKey(businessType),date=dateKey(reportDate),snap=snapshotKey(snapshotId);
  if(!TYPES.has(type)||!date)return stateFor(type,date,snap);
  const current=stateFor(type,date,snap),status=String(current.status||'').toUpperCase();
  if(active(status))return current;
  const age=Date.now()-Date.parse(current.completedAt||current.updatedAt||0);
  if(status==='WAITING_FOR_POD_MEMBERS'&&Number.isFinite(age)&&age<5_000)return current;
  if(['COMPLETED','COMPLETED_WITH_GAPS'].includes(status)&&Number.isFinite(age)&&age<15*60_000)return current;
  if(status==='FAILED'&&Number.isFinite(age)&&age<30_000)return current;
  const key=keyOf(type,date,snap);queue.set(key,{type,date,snapshotId:snap});
  patch(type,date,snap,{status:'QUEUED',phase:'QUEUED',message:runningKey?'等待上一业务签收轨迹补证完成。':'签收轨迹补证已进入队列。'});
  setImmediate(()=>{void pump();});
  return stateFor(type,date,snap);
}
export function inspectSelectedDateTimingRepair(businessType='',reportDate='',snapshotId=''){
  return stateFor(typeKey(businessType),dateKey(reportDate),snapshotKey(snapshotId));
}
