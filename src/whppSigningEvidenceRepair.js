import { CEClient } from './ceClient.js';
import { getDb } from './db.js';
import { normalizeEvent } from './analyzer.js';
import { queryTrackBatchWithFallback, splitTrackBatches } from './trackBatching.js';

export const V642_WHPP_SIGNING_EVIDENCE_ID='2026-10-05-v642-whpp-pod-signing-track-repair-v1';
const states=new Map();
const now=()=>new Date().toISOString();
const dateKey=v=>{const s=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';};
const billOf=row=>String(row?.shipmentCode||row?.运单号||row?.waybill||'').trim().toUpperCase();
const active=s=>['QUEUED','RUNNING'].includes(String(s||'').toUpperCase());

function stateFor(date){
  return states.get(date)||{id:V642_WHPP_SIGNING_EVIDENCE_ID,reportDate:date,status:'IDLE',phase:'WAITING',total:0,completed:0,failed:0,message:'',startedAt:'',updatedAt:'',completedAt:''};
}
function patch(date,value){const next={...stateFor(date),...value,reportDate:date,id:V642_WHPP_SIGNING_EVIDENCE_ID,updatedAt:now()};states.set(date,next);return next;}
function podBills(date){
  try{return getDb().prepare("SELECT shipmentCode FROM business_final_rows WHERE businessType='WHPP' AND reportDate=? AND isPod=1 ORDER BY shipmentCode").all(date).map(r=>billOf(r)).filter(Boolean);}catch{return[]}
}
function existingEventBills(date,bills){
  if(!bills.length)return new Set();
  const out=new Set();
  for(let i=0;i<bills.length;i+=350){
    const chunk=bills.slice(i,i+350),marks=chunk.map(()=>'?').join(',');
    try{
      for(const row of getDb().prepare(`SELECT DISTINCT shipmentCode FROM business_track_events WHERE businessType='WHPP' AND reportDate=? AND shipmentCode IN (${marks})`).all(date,...chunk))out.add(billOf(row));
    }catch{}
  }
  return out;
}
function groupRows(rows=[]){
  const map=new Map();
  for(const raw of rows||[]){
    const row={...normalizeEvent(raw),reportDate:''},bill=billOf(row);
    if(!bill)continue;
    if(!map.has(bill))map.set(bill,[]);
    map.get(bill).push(row);
  }
  return map;
}
function persistBillEvents(date,bill,rows=[]){
  if(!rows.length)return;
  const db=getDb(),ts=now();
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare("DELETE FROM business_track_events WHERE businessType='WHPP' AND reportDate=? AND shipmentCode=?").run(date,bill);
    const insert=db.prepare("INSERT INTO business_track_events(businessType,shipmentCode,reportDate,eventTime,eventCode,rawJson,createdAt) VALUES('WHPP',?,?,?,?,?,?)");
    for(const raw of rows){
      const row={...normalizeEvent(raw),shipmentCode:bill,reportDate:date};
      insert.run(bill,date,row.eventTime||row.trackingEventTime||row.creationDate||'',String(row.eventCode??row.trackingEventCode??row.statusCode??''),JSON.stringify(row),ts);
    }
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK')}catch{};throw error}
}

async function run(date){
  const bills=podBills(date),existing=existingEventBills(date,bills),targets=bills.filter(code=>!existing.has(code));
  patch(date,{status:'RUNNING',phase:'TRACK_QUERY',total:bills.length,completed:existing.size,failed:0,startedAt:now(),message:`WHPP签收时效补证：POD ${bills.length}票，待补轨迹 ${targets.length}票`});
  if(!targets.length){return patch(date,{status:'COMPLETED',phase:'DONE',completed:bills.length,completedAt:now(),message:'WHPP签收轨迹证据已齐全。'})}
  const client=new CEClient(),batches=splitTrackBatches(targets);
  let completed=existing.size,failed=0;
  for(let offset=0;offset<batches.length;offset+=4){
    const wave=batches.slice(offset,offset+4);
    const results=await Promise.all(wave.map(async batch=>{
      try{return await queryTrackBatchWithFallback({batch,query:codes=>client.trackQuery(codes),apiName:'whpp-signing-track-query',fallbackSizes:[25,10,1],onLog:async()=>{}})}
      catch(error){return{successes:[],failures:[{batch,error}]}}
    }));
    for(const outcome of results){
      for(const success of outcome.successes||[]){
        const grouped=groupRows(success.events||[]);
        for(const code of success.batch||[]){
          const rows=grouped.get(code)||[];
          if(rows.length){persistBillEvents(date,code,rows);completed+=1}else failed+=1;
        }
      }
      for(const failure of outcome.failures||[])failed+=(failure.batch||[]).length;
    }
    patch(date,{status:'RUNNING',phase:'TRACK_QUERY',completed,failed,message:`WHPP签收轨迹补证 ${Math.min(offset+4,batches.length)}/${batches.length} 批：成功 ${completed}/${bills.length}，失败 ${failed}`});
  }
  return patch(date,{status:failed?'COMPLETED_WITH_GAPS':'COMPLETED',phase:'DONE',completed,failed,completedAt:now(),message:failed?`WHPP签收轨迹补证完成，仍有 ${failed}票待补。`:'WHPP签收轨迹补证完成。'});
}

export function requestWhppSigningEvidenceRepair(reportDate=''){
  const date=dateKey(reportDate);if(!date)return stateFor('');
  const current=stateFor(date);
  if(active(current.status))return current;
  if(['COMPLETED','COMPLETED_WITH_GAPS'].includes(current.status)&&Date.now()-Date.parse(current.completedAt||0)<15*60_000)return current;
  patch(date,{status:'QUEUED',phase:'QUEUED',message:'WHPP签收轨迹补证已进入后台队列。'});
  setImmediate(()=>{void run(date).catch(error=>patch(date,{status:'FAILED',phase:'FAILED',failed:Math.max(1,stateFor(date).failed||0),completedAt:now(),message:error?.message||String(error)}));});
  return stateFor(date);
}
export function inspectWhppSigningEvidenceRepair(reportDate=''){return stateFor(dateKey(reportDate));}
