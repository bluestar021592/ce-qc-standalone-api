import {parentPort,workerData} from 'node:worker_threads';
import {getDb,getRuntimeConfig,closeDb} from './db.js';
import {getCurrentReportDate} from './store.js';
import {SHOPEE,getBusinessCurrentReportDate} from './businessStore.js';
import {buildHomeQualitySummary} from './homeQualitySummary.js';

// V766 worker: isolated main-thread CPU/SQLite computations. The launcher
// sets CE_QC_DASHBOARD_READ_WORKER=1 before module import. DB is strictly
// read-only and the path is pinned to the main-process configured SQLite file.
function ensureReadOnlySource(){
  if(process.env.CE_QC_DASHBOARD_READ_WORKER!=='1')throw new Error('V766_READONLY_REQUIRED');
  if(String(getRuntimeConfig().dbFile)!==String(workerData.dbFile))throw new Error('V766_DB_PATH_MISMATCH');
  return getDb();
}
function familyProof(reportDate){
  const date=String(reportDate||'').slice(0,10);
  if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(date))throw new Error('REPORT_DATE_INVALID');
  ensureReadOnlySource();
  const db=getDb();
  const batch=db.prepare("SELECT snapshotId, batchId FROM unified_import_batches WHERE reportDate=? AND status='VALID' ORDER BY createdAt DESC,batchId DESC LIMIT 1").get(date);
  if(!batch)return res.status(404).json({ok:false,code:'VALID_BATCH_MISSING',error:'该日期缺少有效的综合日报'});
  const snapshotId=String(batch.snapshotId||'');
  const currentCcsl=String(getCurrentReportDate()||'').slice(0,10);
  const currentShopee=String(getBusinessCurrentReportDate(SHOPEE)||'').slice(0,10);
  const groups=[
    {name:'CCSL',types:['CE','CEAF','TBKH','ALI1688'],lockTable:'run_locks',scanTable:'scan_results',finalTable:'final_rows',currentDate:currentCcsl},
    {name:'SHOPEE',types:['SHOPEECN','SHOPEEVN'],lockTable:'business_run_locks',scanTable:'business_scan_results',finalTable:'business_final_rows',currentDate:currentShopee}
  ];
  const result={};
  for(const group of groups){
    const markers=group.types.map(()=>'?').join(',');
    const sourceCount=Number(db.prepare(`SELECT COUNT(DISTINCT UPPER(TRIM(shipmentCode))) AS count FROM unified_import_rows WHERE snapshotId=? AND reportDate=? AND businessType IN (${markers})`).get(snapshotId,date,...group.types)?.count||0);
    const where=group.name==='SHOPEE'?'businessType=? AND reportDate=?':'reportDate=?';
    const args=group.name==='SHOPEE'?['SHOPEE',date]:[date];
    const lock=db.prepare(`SELECT runId,status,currentStage,errorMessage,completedAt,updatedAt FROM ${group.lockTable} WHERE ${where} LIMIT 1`).get(...args)||null;
    const scanCount=Number(db.prepare(`SELECT COUNT(DISTINCT shipmentCode) AS count FROM ${group.scanTable} WHERE ${where}`).get(...args)?.count||0);
    const finalCount=Number(db.prepare(`SELECT COUNT(DISTINCT shipmentCode) AS count FROM ${group.finalTable} WHERE ${where}`).get(...args)?.count||0);
    const trajectoryTables=group.name==='SHOPEE'?['business_shipment_tracks','business_track_events']:['track_events'];
    let trackCount=0,evidenceReadable=true;
    try{
      for(const table of trajectoryTables){
        const row=db.prepare(`SELECT COUNT(DISTINCT shipmentCode) AS count FROM ${table} WHERE ${where}`).get(...args);
        trackCount+=Number(row?.count||0);
      }
    }catch{evidenceReadable=false}
    const status=String(lock?.status||'').toLowerCase();
    // V762: matching quantities alone cannot prove matching shipment identity.
    // Validate exact July-04 source membership against both independently saved
    // ledgers before allowing a historical completed run to repair UI progress.
    let exactMemberVerified=false,scanMissing=-1,finalMissing=-1;
    if(sourceCount>0&&scanCount===sourceCount&&finalCount===sourceCount&&['finished','completed'].includes(status)){
      try{
        const source=`SELECT DISTINCT UPPER(TRIM(shipmentCode)) AS code FROM unified_import_rows WHERE snapshotId=? AND reportDate=? AND businessType IN (${markers})`;
        const scanWhere=group.name==='SHOPEE'?"businessType='SHOPEE' AND reportDate=?":"reportDate=?";
        const scanSet=`SELECT DISTINCT UPPER(TRIM(shipmentCode)) AS code FROM ${group.scanTable} WHERE ${scanWhere}`;
        const finalSet=`SELECT DISTINCT UPPER(TRIM(shipmentCode)) AS code FROM ${group.finalTable} WHERE ${scanWhere}`;
        const missingQuery=part=>`SELECT COUNT(*) AS count FROM (${source} EXCEPT ${part})`;
        scanMissing=Number(db.prepare(missingQuery(scanSet)).get(snapshotId,date,...group.types,date)?.count??-1);
        finalMissing=Number(db.prepare(missingQuery(finalSet)).get(snapshotId,date,...group.types,date)?.count??-1);
        exactMemberVerified=scanMissing===0&&finalMissing===0;
      }catch(error){console.warn('[CE-QC][V762] read-only exact completion membership unavailable',date,group.name,error?.message||error)}
    }
    let action='BLOCKED',reason='';
    if(sourceCount===0){action='ZERO_TICKET';reason='该日期该业务确实0票'}
    else if(status==='finished'||status==='completed'){action='DONE';reason='存在业务完成锁；不重复扫描'}
    else if(status==='running'){action='WAIT';reason='已有运行任务；不重复启动'}
    else if(group.currentDate!==date){action='BLOCKED';reason='后台当前业务日期与诊断日期不一致'}
    else if(['paused','failed'].includes(status)&&lock?.runId){action='RESUME';reason='存在中断任务，允许从断点恢复'}
    else if(evidenceReadable&&!lock?.runId&&scanCount===0&&finalCount===0&&trackCount===0){action='START';reason='没有运行锁且无已保存扫描/最终记录，可首次启动'}
    else {action='BLOCKED';reason='存在扫描、轨迹、最终记录、读取失败或不可辨识运行锁，需要保留历史证据并人工排查'}
    result[group.name]={sourceCount,scanCount,finalCount,scanMissing,finalMissing,exactMemberVerified,trackCount,evidenceReadable,runId:String(lock?.runId||''),runStatus:status||'NOT_STARTED',phase:String(lock?.currentStage||''),error:String(lock?.errorMessage||''),currentDate:group.currentDate,action,reason};
  }

  return {ok:true,reportDate:date,snapshotId,businesses:result};
}
parentPort.on('message',async message=>{
  const started=Date.now();
  try{
    ensureReadOnlySource();
    let result;
    if(message.kind==='FAMILY_PROOF')result=familyProof(message.reportDate);
    else if(message.kind==='HOME_FULL')result=buildHomeQualitySummary({
      reportDate:message.reportDate||'',snapshotId:message.snapshotId||''
    });
    else throw new Error('V766_READ_JOB_UNKNOWN');
    parentPort.postMessage({id:message.id,ok:true,result,elapsedMs:Date.now()-started});
  }catch(error){
    parentPort.postMessage({id:message.id,ok:false,error:String(error?.message||error),elapsedMs:Date.now()-started});
  }
});
