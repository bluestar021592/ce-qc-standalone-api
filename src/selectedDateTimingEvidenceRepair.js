import { CEClient } from './ceClient.js';
import { getDb } from './db.js';
import { normalizeEvent } from './analyzer.js';
import { queryTrackBatchWithFallback, splitTrackBatches } from './trackBatching.js';
import { loadWhppCanonicalTruth } from './whppCanonicalTruth.js';
import { loadWhppState, listWhppHistory, loadWhppSnapshot } from './whppStore.js';
import { buildWhppDashboard } from './whppReporting.js';
import { loadBusinessState, getBusinessSnapshot } from './businessStore.js';
import { buildShopeeDashboard } from './shopeeReporting.js';
import { recipientGroupOf } from './recipientGroup.js';
import { normalizeV485TrackRows, archiveV485TrackQueryResponse } from './v485StrictTrackEvidence.js';
import { persistentSelectedDatePodTruth } from './selectedDatePersistentTruth.js';
import { classifyShipmentStatus, shipmentStatusTime } from './shipmentStatusTruth.js';
import { extractV498SavedShopeePodEvidence } from './v498SavedShopeePodEvidence.js';

export const V645_SELECTED_DATE_TIMING_REPAIR_ID='2026-10-05-v645-selected-date-pod-track-repair-v1';
export const V737_STATUS_FIRST_TIMING_REPAIR_REVISION='2026-10-07-v737-status-first-timing-repair-v1';
export const V740_CONFIRM_FIRST_TIMING_REPAIR_REVISION='2026-10-07-v740-confirm-first-timing-repair-v1';
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
const HISTORICAL_AUTO_REPAIR_MAX_AGE_DAYS=30;
const durableStopKey=(type,date)=>'selected_date_timing_stop:'+typeKey(type)+':'+dateKey(date);
function reportAgeDays(date){
  const d=dateKey(date);if(!d)return 0;
  const stamp=Date.parse(d+'T00:00:00+07:00');if(!Number.isFinite(stamp))return 0;
  return Math.floor((Date.now()-stamp)/86400000);
}
function readDurableStop(type,date){
  try{
    const row=getDb().prepare('SELECT valueJson,updatedAt FROM app_state WHERE key=?').get(durableStopKey(type,date));
    if(!row?.valueJson)return null;
    const value=JSON.parse(row.valueJson);
    return value&&value.status==='HISTORICAL_EVIDENCE_UNAVAILABLE'?{...value,updatedAt:row.updatedAt||value.updatedAt||''}:null;
  }catch{return null}
}
function clearDurableStop(type,date){
  try{getDb().prepare('DELETE FROM app_state WHERE key=?').run(durableStopKey(type,date));}catch{}
}
function writeDurableStop(type,date,snapshotId,total,message,stats={}){
  const value={
    id:V645_SELECTED_DATE_TIMING_REPAIR_ID,businessType:typeKey(type),reportDate:dateKey(date),snapshotId:snapshotKey(snapshotId),
    status:'HISTORICAL_EVIDENCE_UNAVAILABLE',phase:'DONE',total:Number(total||0),
    completed:Number(stats.completed||0),failed:Number(stats.failed??total??0),queried:Number(stats.queried||0),
    persistedEvents:Number(stats.persistedEvents||0),
    confirmQueried:Number(stats.confirmQueried||0),confirmFailed:Number(stats.confirmFailed||0),confirmPersistedRows:Number(stats.confirmPersistedRows||0),
    confirm85:Number(stats.confirm85||0),confirm85WithTime:Number(stats.confirm85WithTime||0),confirm85WithoutTime:Number(stats.confirm85WithoutTime||0),
    statusQueried:Number(stats.statusQueried||0),statusFailed:Number(stats.statusFailed||0),statusPersistedRows:Number(stats.statusPersistedRows||0),
    status60:Number(stats.status60||0),status60WithTime:Number(stats.status60WithTime||0),status60WithoutTime:Number(stats.status60WithoutTime||0),
    repairRevision:String(stats.repairRevision||''),exhaustionSource:String(stats.exhaustionSource||'POST_QUERY_EXHAUSTED'),
    message:message||'历史轨迹证据缺失，自动补查已停止。',completedAt:now(),updatedAt:now()
  };
  try{
    getDb().prepare(`INSERT INTO app_state(key,valueJson,updatedAt) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET valueJson=excluded.valueJson,updatedAt=excluded.updatedAt`).run(durableStopKey(type,date),JSON.stringify(value),value.updatedAt);
  }catch{}
  return value;
}


function baseState(type,date,snapshotId=''){
  return {id:V645_SELECTED_DATE_TIMING_REPAIR_ID,businessType:type,reportDate:date,snapshotId:snapshotKey(snapshotId),status:'IDLE',phase:'WAITING',total:0,completed:0,failed:0,queried:0,message:'',startedAt:'',updatedAt:'',completedAt:''};
}
function stateFor(type,date,snapshotId=''){
  const typeN=typeKey(type),dateN=dateKey(date),snap=snapshotKey(snapshotId),key=keyOf(typeN,dateN,snap);
  const memory=states.get(key);if(memory)return memory;
  const durable=readDurableStop(typeN,dateN);if(durable)return{...baseState(typeN,dateN,snap),...durable,snapshotId:snap||durable.snapshotId||''};
  return baseState(typeN,dateN,snap);
}
function patch(type,date,snapshotId='',value={}){
  const typeN=typeKey(type),dateN=dateKey(date),snap=snapshotKey(snapshotId),key=keyOf(typeN,dateN,snap);
  const next={...stateFor(typeN,dateN,snap),...value,businessType:typeN,reportDate:dateN,snapshotId:snap,id:V645_SELECTED_DATE_TIMING_REPAIR_ID,updatedAt:now()};
  states.set(key,next);return next;
}
function unique(values=[]){return [...new Set(values.map(v=>String(v||'').trim().toUpperCase()).filter(Boolean))].sort();}

function whppPodBills(date){
  const persisted=persistentSelectedDatePodTruth(getDb(),'WHPP',date);
  if(persisted.authoritative||persisted.bills.length)return persisted.bills;
  try{
    const hit=listWhppHistory(500).find(item=>String(item?.reportDate||'').slice(0,10)===date);
    if(hit?.snapshotId){
      const snapshot=loadWhppSnapshot(hit.snapshotId);
      const rows=snapshot?.dashboard?.detailTabs?.pod?.rows||[];
      if(rows.length)return unique(rows.map(billOf));
    }
  }catch{}
  try{
    const state=loadWhppState();
    if(String(state?.reportDate||'').slice(0,10)!==date)return[];
    const dashboard=buildWhppDashboard(state);
    return unique((dashboard?.detailTabs?.pod?.rows||[]).map(billOf));
  }catch{return[]}
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
function shopeePodBills(type,date){
  const wantedGroup=type==='SHOPEECN'?'CN':'VN';
  const persisted=persistentSelectedDatePodTruth(getDb(),type,date);
  if(persisted.authoritative||persisted.bills.length)return persisted.bills;
  try{
    const snapshot=getBusinessSnapshot('SHOPEE',date);
    const rows=snapshot?.view?.detailTabs?.[wantedGroup+'_pod']?.rows
      || snapshot?.view?.detailTabs?.byRecipientGroup?.[wantedGroup]?.pod?.rows
      || [];
    if(rows.length)return unique(rows.map(billOf));
  }catch{}
  try{
    const state=loadBusinessState('SHOPEE');
    if(String(state?.reportDate||'').slice(0,10)!==date)return[];
    const dashboard=buildShopeeDashboard(state);
    const rows=dashboard?.detailTabs?.[wantedGroup+'_pod']?.rows
      || dashboard?.detailTabs?.byRecipientGroup?.[wantedGroup]?.pod?.rows
      || [];
    return unique(rows.map(billOf));
  }catch{return[]}
}
export function selectedDatePodBills(type,date,snapshotId=''){
  const t=typeKey(type),d=dateKey(date);
  if(!TYPES.has(t)||!d)return[];
  if(t==='WHPP')return whppPodBills(d);
  if(t==='TBKH')return tbkhPodBills(d,snapshotId);
  return shopeePodBills(t,d);
}
function groupRows(rows=[],fallbackBills=[]){
  const map=new Map();
  const normalizedRows=normalizeV485TrackRows(rows,{fallbackBills});
  for(const raw of normalizedRows){
    if(!raw)continue;
    const row={...normalizeEvent(raw||{})},bill=billOf(row);
    if(!bill)continue;
    if(!map.has(bill))map.set(bill,[]);
    map.get(bill).push({...raw,...row,shipmentCode:bill});
  }
  return map;
}
function eventFingerprint(row={}){
  row=row||{};
  const normalized={...normalizeEvent(row)};
  const time=String(normalized.eventTime||normalized.trackingEventTime||normalized.creationDate||normalized.lastUpdateDate||'').trim();
  const code=String(normalized.eventCode??normalized.trackingEventCode??normalized.statusCode??'').trim();
  const raw=JSON.stringify(normalized);
  return time+'|'+code+'|'+raw;
}
function persistConfirmRows(type,date,rows=[]){
  const owner=storageType(type),db=getDb(),stamp=now(),latest=new Map();
  for(const raw of rows||[]){
    const code=billOf(raw);if(!code)continue;
    latest.set(code,{...raw,shipmentCode:code,reportDate:date});
  }
  if(!latest.size)return 0;
  const ins=db.prepare(`INSERT INTO business_scan_results(
    businessType,shipmentCode,reportDate,isPod,orderStatus,recipient_raw,recipient_normalized,recipient_group,recipient_group_reason,source_row_number,rawJson,createdAt,updatedAt
  ) VALUES(?,?,?,?,?,'','','OTHER','',0,?,?,?)
  ON CONFLICT(businessType,shipmentCode,reportDate) DO UPDATE SET
    isPod=CASE WHEN excluded.isPod=1 THEN 1 ELSE business_scan_results.isPod END,
    orderStatus=CASE WHEN excluded.orderStatus<>'' THEN excluded.orderStatus ELSE business_scan_results.orderStatus END,
    rawJson=excluded.rawJson,updatedAt=excluded.updatedAt`);
  let saved=0;
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const [code,row] of latest){
      const orderStatus=String(row.orderStatus??'').trim();
      const isPod=orderStatus==='85'?1:0;
      ins.run(owner,code,date,isPod,orderStatus,JSON.stringify(row),stamp,stamp);
      saved++;
    }
    db.exec('COMMIT');
    return saved;
  }catch(error){try{db.exec('ROLLBACK')}catch{};throw error}
}
function confirmTimingEvidence(row={}){
  const code=billOf(row);if(!code)return null;
  return extractV498SavedShopeePodEvidence({shipmentCode:code,orderStatus:String(row.orderStatus??''),rawJson:JSON.stringify(row)},'business_scan_results');
}

function persistShipmentStatusRows(type,date,rows=[]){
  const owner=storageType(type),db=getDb(),stamp=now(),latest=new Map();
  for(const raw of rows||[]){
    const code=billOf(raw);if(!code)continue;
    latest.set(code,{...raw,shipmentCode:code,reportDate:date});
  }
  if(!latest.size)return 0;
  const del=db.prepare('DELETE FROM business_shipment_tracks WHERE businessType=? AND reportDate=? AND shipmentCode=?');
  const ins=db.prepare('INSERT INTO business_shipment_tracks(businessType,shipmentCode,reportDate,shipmentStatus,statusText,apiStatus,rawJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)');
  let saved=0;
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const [code,row] of latest){
      del.run(owner,date,code);
      ins.run(owner,code,date,String(row.shipmentStatus??''),String(row.statusText||row.shipmentStatusDesc||''),String(row.apiStatus||'success'),JSON.stringify(row),stamp,stamp);
      saved++;
    }
    db.exec('COMMIT');
    return saved;
  }catch(error){try{db.exec('ROLLBACK')}catch{};throw error}
}
function rawRowsByBill(rows=[]){
  const map=new Map();
  for(const row of rows||[]){
    const code=billOf(row);if(!code)continue;
    if(!map.has(code))map.set(code,[]);
    map.get(code).push(row);
  }
  return map;
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
      if(!raw)continue;
      const row={...normalizeEvent(raw||{}),shipmentCode:bill,reportDate:date};
      const fp=eventFingerprint(row);if(seen.has(fp))continue;seen.add(fp);
      insert.run(owner,bill,date,row.eventTime||row.trackingEventTime||row.creationDate||row.lastUpdateDate||'',String(row.eventCode??row.trackingEventCode??row.statusCode??''),JSON.stringify(row),stamp);added++;
    }
    db.exec('COMMIT');return added;
  }catch(error){try{db.exec('ROLLBACK')}catch{};throw error}
}

async function queryTimingEvidenceRows(client,codes=[]){
  const bills=unique(codes);
  if(!bills.length)return[];

  let primary=[];
  try{primary=await client.trackQuery(bills)}catch(error){primary=[]}
  const primaryNormalized=normalizeV485TrackRows(primary,{fallbackBills:bills});
  const covered=new Set(primaryNormalized.map(row=>billOf(row)).filter(Boolean));
  const missing=bills.filter(code=>!covered.has(code));
  if(!missing.length)return primary;

  let fallback=[];
  try{fallback=await client.shipmentTrack(missing)}catch(error){fallback=[]}
  const fallbackNormalized=normalizeV485TrackRows(fallback,{fallbackBills:missing});
  if(!primary?.length)return fallbackNormalized.length?fallback:fallback;
  if(!fallback?.length)return primary;
  return [...primary,...fallback];
}

async function runOne(type,date,snapshotId=''){
  const bills=selectedDatePodBills(type,date,snapshotId);
  patch(type,date,snapshotId,{status:'RUNNING',phase:'TRACK_QUERY',total:bills.length,completed:0,failed:0,queried:0,startedAt:now(),message:`${type} ${date} 签收时效补证：真实POD ${bills.length}票`});
  if(!bills.length)return patch(type,date,snapshotId,{status:'WAITING_FOR_POD_MEMBERS',phase:'WAITING_FOR_POD_MEMBERS',completedAt:now(),message:`${type} ${date} 当前尚未形成真实POD成员；等待扫描/轨迹处理完成后自动重试。`});
  const client=new CEClient();

  const confirmBatches=splitTrackBatches(bills),confirmTimedBills=new Set();
  let confirmQueried=0,confirmFailed=0,confirmPersistedRows=0,confirm85=0,confirm85WithTime=0,confirm85WithoutTime=0;
  for(let offset=0;offset<confirmBatches.length;offset+=4){
    const wave=confirmBatches.slice(offset,offset+4);
    const results=await Promise.all(wave.map(async batch=>{
      confirmQueried+=batch.length;
      try{return await queryTrackBatchWithFallback({batch,query:codes=>client.confirmQuery(codes),apiName:`v740-${type.toLowerCase()}-confirm-query`,fallbackSizes:[100,50,10,1],onLog:async()=>{}})}
      catch(error){return{successes:[],failures:[{batch,error}]}}
    }));
    for(const outcome of results){
      for(const success of outcome.successes||[]){
        const rows=success.events||[];
        confirmPersistedRows+=persistConfirmRows(type,date,rows);
        for(const row of rows){
          const code=billOf(row);if(!code)continue;
          if(String(row.orderStatus??'').trim()!=='85')continue;
          confirm85++;
          const evidence=confirmTimingEvidence(row);
          if(evidence?.podDate){confirm85WithTime++;confirmTimedBills.add(code);}
          else confirm85WithoutTime++;
        }
      }
      for(const failure of outcome.failures||[])confirmFailed+=(failure.batch||[]).length;
    }
    patch(type,date,snapshotId,{
      status:'RUNNING',phase:'CONFIRM_QUERY',confirmQueried,confirmFailed,confirmPersistedRows,confirm85,confirm85WithTime,confirm85WithoutTime,
      repairRevision:V740_CONFIRM_FIRST_TIMING_REPAIR_REVISION,
      message:`${type} ${date} confirm补证 ${Math.min(offset+4,confirmBatches.length)}/${confirmBatches.length}批：85/POD有时间 ${confirm85WithTime}票，无时间 ${confirm85WithoutTime}票`
    });
  }

  const statusBills=bills.filter(code=>!confirmTimedBills.has(code));
  const statusBatches=splitTrackBatches(statusBills),statusTimedBills=new Set();
  let statusQueried=0,statusFailed=0,statusPersistedRows=0,status60=0,status60WithTime=0,status60WithoutTime=0;
  for(let offset=0;offset<statusBatches.length;offset+=4){
    const wave=statusBatches.slice(offset,offset+4);
    const results=await Promise.all(wave.map(async batch=>{
      statusQueried+=batch.length;
      try{return await queryTrackBatchWithFallback({batch,query:codes=>client.shipmentTrack(codes),apiName:`v737-${type.toLowerCase()}-shipment-status`,fallbackSizes:[25,10,5,1],onLog:async()=>{}})}
      catch(error){return{successes:[],failures:[{batch,error}]}}
    }));
    for(const outcome of results){
      for(const success of outcome.successes||[]){
        const successBatch=success.batch||[],rows=success.events||[];
        statusPersistedRows+=persistShipmentStatusRows(type,date,rows);
        const grouped=rawRowsByBill(rows);
        for(const codeRaw of successBatch){
          const code=String(codeRaw||'').trim().toUpperCase(),row=(grouped.get(code)||[]).at(-1)||null;
          if(!row)continue;
          const truth=classifyShipmentStatus(row);
          if(!truth.pod)continue;
          status60++;
          if(shipmentStatusTime(row)){status60WithTime++;statusTimedBills.add(code);}
          else status60WithoutTime++;
        }
      }
      for(const failure of outcome.failures||[])statusFailed+=(failure.batch||[]).length;
    }
    patch(type,date,snapshotId,{
      status:'RUNNING',phase:'SHIPMENT_STATUS_QUERY',statusQueried,statusFailed,statusPersistedRows,status60,status60WithTime,status60WithoutTime,
      confirmQueried,confirmFailed,confirmPersistedRows,confirm85,confirm85WithTime,confirm85WithoutTime,repairRevision:V740_CONFIRM_FIRST_TIMING_REPAIR_REVISION,
      message:`${type} ${date} shipmentStatus补证 ${Math.min(offset+4,statusBatches.length)}/${statusBatches.length}批：60/POD有时间 ${status60WithTime}票，无时间 ${status60WithoutTime}票`
    });
  }

  const timedBills=new Set([...confirmTimedBills,...statusTimedBills]);
  const trackBills=bills.filter(code=>!timedBills.has(code));
  const batches=splitTrackBatches(trackBills),totalBatches=batches.length;
  let completed=timedBills.size,failed=0,queried=0,persistedEvents=0;
  for(let offset=0;offset<totalBatches;offset+=4){
    const wave=batches.slice(offset,offset+4);
    const results=await Promise.all(wave.map(async batch=>{
      queried+=batch.length;
      try{return await queryTrackBatchWithFallback({batch,query:codes=>queryTimingEvidenceRows(client,codes),apiName:`v686-${type.toLowerCase()}-selected-date-timing`,fallbackSizes:[25,10,5,1],onLog:async()=>{}})}
      catch(error){return{successes:[],failures:[{batch,error}]}}
    }));
    for(const outcome of results){
      for(const success of outcome.successes||[]){
        const successBatch=success.batch||[];
        try{await archiveV485TrackQueryResponse(successBatch,success.events||[])}catch{}
        const grouped=groupRows(success.events||[],successBatch);
        for(const codeRaw of successBatch){
          const code=String(codeRaw||'').trim().toUpperCase(),rows=grouped.get(code)||[];
          if(rows.length){persistedEvents+=persistBillEvents(type,date,code,rows);completed+=1}else failed+=1;
        }
      }
      for(const failure of outcome.failures||[])failed+=(failure.batch||[]).length;
    }
    patch(type,date,snapshotId,{status:'RUNNING',phase:'TRACK_QUERY',completed,failed,queried,persistedEvents,confirmQueried,confirmFailed,confirmPersistedRows,confirm85,confirm85WithTime,confirm85WithoutTime,statusQueried,statusFailed,statusPersistedRows,status60,status60WithTime,status60WithoutTime,repairRevision:V740_CONFIRM_FIRST_TIMING_REPAIR_REVISION,message:`${type} ${date} 轨迹补证 ${Math.min(offset+4,totalBatches)}/${totalBatches}批：已有POD时间 ${timedBills.size}，轨迹成功 ${Math.max(0,completed-timedBills.size)}，失败 ${failed}`});
  }
  if(bills.length>0&&timedBills.size===0&&completed===0&&failed>=trackBills.length&&persistedEvents===0&&reportAgeDays(date)>HISTORICAL_AUTO_REPAIR_MAX_AGE_DAYS){
    const durable=writeDurableStop(
      type,date,snapshotId,bills.length,
      `${type} ${date} 已完成一次实时轨迹补证，但仍未取得真实60/70→80轨迹；为避免重复无效查询，后续自动补查已停止。`,
      {completed,failed,queried,persistedEvents,confirmQueried,confirmFailed,confirmPersistedRows,confirm85,confirm85WithTime,confirm85WithoutTime,statusQueried,statusFailed,statusPersistedRows,status60,status60WithTime,status60WithoutTime,repairRevision:V740_CONFIRM_FIRST_TIMING_REPAIR_REVISION,exhaustionSource:'POST_CONFIRM_STATUS_AND_TRACK_QUERY_EXHAUSTED'}
    );
    return patch(type,date,snapshotId,durable);
  }
  return patch(type,date,snapshotId,{status:failed?'COMPLETED_WITH_GAPS':'COMPLETED',phase:'DONE',completed,failed,queried,persistedEvents,confirmQueried,confirmFailed,confirmPersistedRows,confirm85,confirm85WithTime,confirm85WithoutTime,statusQueried,statusFailed,statusPersistedRows,status60,status60WithTime,status60WithoutTime,repairRevision:V740_CONFIRM_FIRST_TIMING_REPAIR_REVISION,completedAt:now(),message:failed?`${type} ${date} 补证完成：confirm85有时间 ${confirm85WithTime}票，shipmentStatus60有时间 ${status60WithTime}票，轨迹仍缺 ${failed}票。`:`${type} ${date} 签收时效补证完成。`});
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
  let current=stateFor(type,date,snap),status=String(current.status||'').toUpperCase();
  if(status==='HISTORICAL_EVIDENCE_UNAVAILABLE'){
    // V740 adds live confirm-query before shipmentStatus/event fallback. Older
    // durable stops are reopened exactly once because confirm-query is the same
    // source that originally established many historical POD memberships.
    if(String(current.repairRevision||'')===V740_CONFIRM_FIRST_TIMING_REPAIR_REVISION&&Number(current.confirmQueried||0)>0)return current;
    clearDurableStop(type,date);
    states.delete(keyOf(type,date,snap));
    current=baseState(type,date,snap);
    status='IDLE';
  }
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
