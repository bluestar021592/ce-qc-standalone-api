import crypto from 'node:crypto';
import { analyzeShipment, normalizeEvent } from '../src/analyzer.js';
import { analyzeShopeeShipment } from '../src/shopeeAnalyzer.js';
import { classifyScanTerminal } from '../src/scanTerminal.js';
import { queryBatchWithFallback, splitTrackBatches } from '../src/trackBatching.js';
import { NextCeClient } from './ce.js';
import { getDataDb, getSystemDb, nowIso } from './db.js';
import { validBatch } from './store.js';

const ORDER_BATCH=350;

export async function processReport(reportDate,{onProgress=async()=>{}}={}){
  const batch=validBatch(reportDate);if(!batch)throw new Error('该日期没有已导入日报。');
  const db=getDataDb();ensureRunTable(db);const runId=crypto.randomUUID(),startedAt=nowIso();
  db.prepare('INSERT INTO process_runs(runId,reportDate,status,stage,totalCount,doneCount,errorMessage,startedAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)').run(runId,batch.reportDate,'RUNNING','SCAN',0,0,'',startedAt,startedAt);
  const imported=db.prepare('SELECT shipmentCode,businessType,regionCode,rowJson FROM import_rows WHERE batchId=? ORDER BY id').all(batch.batchId);
  db.prepare('UPDATE process_runs SET totalCount=?,updatedAt=? WHERE runId=?').run(imported.length,nowIso(),runId);
  const client=new NextCeClient();
  const confirmByBill=new Map(),scanFailures=new Map();
  await onProgress({stage:'SCAN',done:0,total:imported.length,message:`开始扫描 ${imported.length} 票`});
  try{
    for(let i=0;i<imported.length;i+=ORDER_BATCH){
      const codes=imported.slice(i,i+ORDER_BATCH).map(r=>r.shipmentCode);
      const outcome=await queryBatchWithFallback({batch:codes,query:list=>client.confirmQuery(list),apiName:'next-confirm-query',fallbackSizes:[100,50,10,1],onLog:async message=>onProgress({stage:'SCAN',done:i,total:imported.length,message})});
      for(const success of outcome.successes)for(const row of success.events||[]){const bill=shipmentCodeOf(row);if(bill&&!confirmByBill.has(bill))confirmByBill.set(bill,row);}
      for(const failure of outcome.failures)for(const bill of failure.batch)scanFailures.set(bill,failure.error);
      await onProgress({stage:'SCAN',done:Math.min(i+ORDER_BATCH,imported.length),total:imported.length,message:'订单扫描处理中'});
    }

    const needTrack=[];
    for(const row of imported){
      const raw=confirmByBill.get(row.shipmentCode),requestStatus=raw?'success':'failed',terminal=classifyScanTerminal(raw||{shipmentCode:row.shipmentCode},requestStatus);
      const scanRow={运单号:row.shipmentCode,shipmentCode:row.shipmentCode,reportDate:batch.reportDate,businessType:row.businessType,orderStatus:String(raw?.orderStatus??''),rawJson:raw||{},currentState:terminal.currentState,scanNormalizedState:terminal.currentState,trackRequired:terminal.trackRequired,trackSkippedReason:terminal.trackSkippedReason,是否POD:terminal.currentState==='POD'?'是':'否',退回状态:terminal.currentState==='RETURN_COMPLETED'?'已退回':''};
      if(terminal.currentState==='POD'||terminal.currentState==='RETURN_COMPLETED'){upsertState(row,batch.reportDate,scanResultToAnalysis(scanRow),db);}
      else if(scanFailures.has(row.shipmentCode)){upsertRetry(row,batch.reportDate,'SCAN_RETRY_REQUIRED',scanFailures.get(row.shipmentCode),db);}
      else needTrack.push({...row,scanRow});
    }

    db.prepare("UPDATE process_runs SET stage='TRACK',doneCount=?,updatedAt=? WHERE runId=?").run(imported.length-needTrack.length,nowIso(),runId);
    await onProgress({stage:'TRACK',done:0,total:needTrack.length,message:`进入轨迹查询 ${needTrack.length} 票`});
    const importedByBill=new Map(needTrack.map(r=>[r.shipmentCode,r]));
    const eventMap=new Map(),trackFailures=new Map();
    const chunks=splitTrackBatches(needTrack.map(r=>r.shipmentCode));let done=0;
    for(const codes of chunks){
      const outcome=await queryBatchWithFallback({batch:codes,query:list=>client.trackQuery(list),apiName:'next-track-query',fallbackSizes:[25,10,5,1],onLog:async message=>onProgress({stage:'TRACK',done,total:needTrack.length,message})});
      for(const success of outcome.successes){
        for(const raw of success.events||[]){const event=normalizeEvent(raw);const bill=String(event.shipmentCode||shipmentCodeOf(raw)).trim().toUpperCase();if(!bill)continue;(eventMap.get(bill)||eventMap.set(bill,[]).get(bill)).push(event);}
      }
      for(const failure of outcome.failures)for(const bill of failure.batch)trackFailures.set(bill,failure.error);
      done+=codes.length;await onProgress({stage:'TRACK',done:Math.min(done,needTrack.length),total:needTrack.length,message:'轨迹查询处理中'});
    }

    const shopCodeMap=loadShopMap();
    for(const [bill,row] of importedByBill){
      if(trackFailures.has(bill)){upsertRetry(row,batch.reportDate,'TRACK_RETRY_REQUIRED',trackFailures.get(bill),db);continue;}
      const events=(eventMap.get(bill)||[]).sort((a,b)=>String(a.eventTime||'').localeCompare(String(b.eventTime||'')));
      persistEvents(row,batch.reportDate,events,db);
      let analysis;
      try{analysis=row.businessType==='SHOPEECN'||row.businessType==='SHOPEEVN'?analyzeShopeeShipment({waybill:bill,scanRow:row.scanRow,events,reportDate:batch.reportDate}):analyzeShipment({waybill:bill,scanRow:row.scanRow,events,shopCodeMap,reportDate:batch.reportDate});}
      catch(error){analysis={...row.scanRow,currentState:'ANALYSIS_RETRY_REQUIRED',primaryCategory:'待重试',QC判断:`分析失败：${error.message}`,tags:['ANALYSIS_RETRY_REQUIRED']};}
      upsertState(row,batch.reportDate,analysis,db);
    }

    db.prepare("UPDATE process_runs SET status='COMPLETED',stage='DONE',doneCount=totalCount,updatedAt=?,completedAt=? WHERE runId=?").run(nowIso(),nowIso(),runId);
    await onProgress({stage:'DONE',done:imported.length,total:imported.length,message:'处理完成'});
    return{ok:true,runId,reportDate:batch.reportDate,total:imported.length,trackCount:needTrack.length,scanFailures:scanFailures.size,trackFailures:trackFailures.size};
  }catch(error){db.prepare("UPDATE process_runs SET status='FAILED',errorMessage=?,updatedAt=? WHERE runId=?").run(String(error?.message||error),nowIso(),runId);throw error;}
}

export function latestProcessRun(reportDate=''){const db=getDataDb();ensureRunTable(db);return reportDate?db.prepare('SELECT * FROM process_runs WHERE reportDate=? ORDER BY startedAt DESC LIMIT 1').get(reportDate)||null:db.prepare('SELECT * FROM process_runs ORDER BY startedAt DESC LIMIT 1').get()||null;}

function ensureRunTable(db){db.exec(`CREATE TABLE IF NOT EXISTS process_runs(runId TEXT PRIMARY KEY,reportDate TEXT NOT NULL,status TEXT NOT NULL,stage TEXT NOT NULL,totalCount INTEGER NOT NULL DEFAULT 0,doneCount INTEGER NOT NULL DEFAULT 0,errorMessage TEXT,startedAt TEXT NOT NULL,updatedAt TEXT NOT NULL,completedAt TEXT);CREATE INDEX IF NOT EXISTS idx_next_process_date ON process_runs(reportDate,startedAt);`);}
function shipmentCodeOf(row={}){return String(row.shipmentCode||row.waybill||row.waybillNo||row.trackingNo||row.运单号||row.orderCode||'').trim().toUpperCase();}
function scanResultToAnalysis(scanRow){return{...scanRow,primaryCategory:scanRow.currentState==='POD'?'已签收(POD)':'已退回',specialState:'',Pending次数:0,OC天数:0,最后节点:'',最后节点时间:''};}
function upsertRetry(row,reportDate,state,error,db){upsertState(row,reportDate,{currentState:state,primaryCategory:'待重试',QC判断:String(error?.message||error||'接口失败'),tags:[state]},db);}
function upsertState(row,reportDate,a={},db){
  const state=String(a.currentState||a.scanNormalizedState||a.primaryCategory||a.主分类||'OPEN').toUpperCase();
  const isPod=a.是否POD==='是'||state==='POD';const isReturned=a.退回状态==='已退回'||['RETURNED','RETURN_COMPLETED'].includes(state);
  const pending=Number(a.pendingDistinctDayCount??a.Pending当前次数??a.Pending次数??0);const oc=Number(a.OC天数??a.ocDays??0);
  const special=String(a.specialState||(/SELF_PICKUP|CECN|CEZT|580/.test(state)?state:''));
  const lastTime=String(a.最后节点时间||a.lastEventTime||a.POD时间||'');const lastDesc=String(a.最后节点||a.lastEventDesc||a.QC判断||'');
  db.prepare(`INSERT INTO shipment_state(shipmentCode,businessType,reportDate,state,isPod,isReturned,pendingDays,ocDays,specialState,lastEventTime,lastEventDesc,stateJson,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(shipmentCode) DO UPDATE SET businessType=excluded.businessType,reportDate=excluded.reportDate,state=excluded.state,isPod=excluded.isPod,isReturned=excluded.isReturned,pendingDays=excluded.pendingDays,ocDays=excluded.ocDays,specialState=excluded.specialState,lastEventTime=excluded.lastEventTime,lastEventDesc=excluded.lastEventDesc,stateJson=excluded.stateJson,updatedAt=excluded.updatedAt`).run(row.shipmentCode,row.businessType,reportDate,state,isPod?1:0,isReturned?1:0,pending,oc,special,lastTime,lastDesc,JSON.stringify(a),nowIso());
}
function persistEvents(row,reportDate,events,db){db.prepare('DELETE FROM track_events WHERE shipmentCode=? AND reportDate=?').run(row.shipmentCode,reportDate);const insert=db.prepare('INSERT INTO track_events(shipmentCode,businessType,reportDate,eventCode,eventTime,eventDesc,place,rawJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)');for(const e of events)insert.run(row.shipmentCode,row.businessType,reportDate,String(e.eventCode||e.trackingEventCode||''),String(e.eventTime||''),String(e.trackingEventDescZh||e.trackingEventDesc||''),String(e.place||e.eventShop||''),JSON.stringify(e),nowIso());}
function loadShopMap(){const map=new Map();try{for(const row of getSystemDb().prepare('SELECT shopCode,shopName FROM shop_cp_codes').all())map.set(String(row.shopCode||'').toUpperCase(),row.shopName||row.shopCode);}catch{}return map;}
