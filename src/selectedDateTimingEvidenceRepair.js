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
const keyOf=(type,date)=>typeKey(type)+'|'+dateKey(date);

function baseState(type,date){
  return {id:V645_SELECTED_DATE_TIMING_REPAIR_ID,businessType:type,reportDate:date,status:'IDLE',phase:'WAITING',total:0,completed:0,failed:0,queried:0,message:'',startedAt:'',updatedAt:'',completedAt:''};
}
function stateFor(type,date){
  const typeN=typeKey(type),dateN=dateKey(date),key=keyOf(typeN,dateN);
  return states.get(key)||baseState(typeN,dateN);
}
function patch(type,date,value={}){
  const typeN=typeKey(type),dateN=dateKey(date),key=keyOf(typeN,dateN);
  const next={...stateFor(typeN,dateN),...value,businessType:typeN,reportDate:dateN,id:V645_SELECTED_DATE_TIMING_REPAIR_ID,updatedAt:now()};
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
function persistBillEvents(type,date,bill,rows=[]){
  if(!rows.length)return;
  const owner=storageType(type),db=getDb(),stamp=now();
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare('DELETE FROM business_track_events WHERE businessType=? AND reportDate=? AND shipmentCode=?').run(owner,date,bill);
    const insert=db.prepare('INSERT INTO business_track_events(businessType,shipmentCode,reportDate,eventTime,eventCode,rawJson,createdAt) VALUES(?,?,?,?,?,?,?)');
    for(const raw of rows){
      const row={...normalizeEvent(raw),shipmentCode:bill,reportDate:date};
      insert.run(owner,bill,date,row.eventTime||row.trackingEventTime||row.creationDate||row.lastUpdateDate||'',String(row.eventCode??row.trackingEventCode??row.statusCode??''),JSON.stringify(row),stamp);
    }
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK')}catch{};throw error}
}

async function runOne(type,date,snapshotId=''){
  const bills=podBills(type,date,snapshotId);
  patch(type,date,{status:'RUNNING',phase:'TRACK_QUERY',total:bills.length,completed:0,failed:0,queried:0,startedAt:now(),message:`${type} ${date} 签收时效补证：真实POD ${bills.length}票`});
  if(!bills.length)return patch(type,date,{status:'COMPLETED_WITH_GAPS',phase:'DONE',completedAt:now(),message:`${type} ${date} 未解析到真实POD成员，未执行轨迹补查。`});
  const client=new CEClient(),batches=splitTrackBatches(bills),totalBatches=batches.length;
  let completed=0,failed=0,queried=0;
  for(let offset=0;offset<totalBatches;offset+=4){
    const wave=batches.slice(offset,offset+4);
    const results=await Promise.all(wave.map(async batch=>{
      queried+=batch.length;
      try{return await queryTrackBatchWithFallback({batch,query:codes=>client.trackQuery(codes),apiName:`v645-${type.toLowerCase()}-selected-date-timing`,fallbackSizes:[25,10,1],onLog:async()=>{}})}
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
    patch(type,date,{status:'RUNNING',phase:'TRACK_QUERY',completed,failed,queried,message:`${type} ${date} 轨迹补证 ${Math.min(offset+4,totalBatches)}/${totalBatches}批：成功 ${completed}/${bills.length}，失败 ${failed}`});
  }
  return patch(type,date,{status:failed?'COMPLETED_WITH_GAPS':'COMPLETED',phase:'DONE',completed,failed,queried,completedAt:now(),message:failed?`${type} ${date} 轨迹补证完成，仍有 ${failed}票待补。`:`${type} ${date} 轨迹补证完成。`});
}
async function pump(){
  if(runningKey||!queue.size)return;
  const [key,job]=queue.entries().next().value;queue.delete(key);runningKey=key;
  try{await runOne(job.type,job.date,job.snapshotId);}catch(error){patch(job.type,job.date,{status:'FAILED',phase:'FAILED',failed:Math.max(1,stateFor(job.type,job.date).failed||0),completedAt:now(),message:error?.message||String(error)});}
  finally{runningKey='';setImmediate(()=>{void pump();});}
}
export function requestSelectedDateTimingRepair(businessType='',reportDate='',snapshotId=''){
  const type=typeKey(businessType),date=dateKey(reportDate);
  if(!TYPES.has(type)||!date)return stateFor(type,date);
  const current=stateFor(type,date),status=String(current.status||'').toUpperCase();
  if(active(status))return current;
  const age=Date.now()-Date.parse(current.completedAt||current.updatedAt||0);
  if(['COMPLETED','COMPLETED_WITH_GAPS','FAILED'].includes(status)&&Number.isFinite(age)&&age<15*60_000)return current;
  const key=keyOf(type,date);queue.set(key,{type,date,snapshotId:String(snapshotId||'')});
  patch(type,date,{status:'QUEUED',phase:'QUEUED',message:runningKey?'等待上一业务签收轨迹补证完成。':'签收轨迹补证已进入队列。'});
  setImmediate(()=>{void pump();});
  return stateFor(type,date);
}
export function inspectSelectedDateTimingRepair(businessType='',reportDate=''){
  return stateFor(typeKey(businessType),dateKey(reportDate));
}
