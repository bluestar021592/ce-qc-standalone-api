import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  V241_TYPES as TYPES,
  v241ReadLatestValidBatch,
  v241AuditType,
  v241ShopeeOverlap,
  v241TableExists
} from './v241-readonly-canonical-membership.mjs';

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const root=path.resolve(__dirname,'..');
const DEFAULT_DATA_DIR='D:\\CE CCSL金边数据库';
const resolvePath=value=>path.isAbsolute(value)?path.normalize(value):path.resolve(root,value);
const dataDir=resolvePath(process.env.DATA_DIR||DEFAULT_DATA_DIR);
const dbFile=resolvePath(process.env.DB_FILE||path.join(dataDir,'ce_qc_monitor.db'));
const requestedDate=String(process.argv[2]||'').trim();
const pad=(value,width)=>String(value).padEnd(width);
const now=()=>Number(process.hrtime.bigint())/1e6;

function timed(label,fn){const started=now();const value=fn();const elapsed=now()-started;console.log(`[PERF] ${label}: ${elapsed.toFixed(1)} ms`);return{value,elapsed};}
function runStatus(db,reportDate){
  const ccsl=v241TableExists(db,'run_locks')?db.prepare('SELECT status,currentStage,runId FROM run_locks WHERE reportDate=?').get(reportDate)||null:null;
  const business=v241TableExists(db,'business_run_locks')?db.prepare(`SELECT businessType,status,currentStage,runId FROM business_run_locks WHERE reportDate=? AND UPPER(COALESCE(businessType,'')) IN ('SHOPEE','WHPP') ORDER BY businessType`).all(reportDate):[];
  return{ccsl,business};
}
function latestDate(db){
  try{return String(db.prepare("SELECT reportDate FROM unified_import_batches WHERE UPPER(COALESCE(status,'VALID'))='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT 1").get()?.reportDate||'');}
  catch{return'';}
}

if(!fs.existsSync(dbFile)){
  console.error('GO_LIVE_RESULT: BLOCKED_DATABASE_NOT_FOUND');
  console.error(`Database: ${dbFile}`);
  process.exit(20);
}

const before=fs.statSync(dbFile);
const db=new DatabaseSync(dbFile,{readOnly:true});
let exitCode=20;
try{
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1500;');
  console.log('\nCE QC FIRST-DAY GO-LIVE VERIFY - V244 RECOVERED SHOPEE EFFECTIVE CURRENT TRUTH - STRICT READ ONLY');
  console.log(`Database: ${dbFile}`);
  console.log(`Database size: ${(before.size/1024/1024/1024).toFixed(2)} GB`);
  console.log('Integrity rule: canonical source membership must survive normalized/current layers; current POD may only progress forward. Recovered Shopee rows may use exact normalized truth only when mutable current state has no newer row.');

  const reportDate=/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)?requestedDate:latestDate(db);
  console.log(`Report date: ${reportDate||'NONE'}`);
  const batch=reportDate?timed('load latest VALID batch',()=>v241ReadLatestValidBatch(db,reportDate)).value:null;
  if(!batch){
    console.log('GO_LIVE_RESULT: BLOCKED_NO_VALID_IMPORT');
    exitCode=20;
  }else{
    console.log(`Latest VALID batch: ${batch.batchId}`);
    console.log(`Latest VALID snapshot: ${batch.snapshotId}`);
    console.log(`Latest VALID snapshot status: ${batch.snapshotStatus||'MISSING'}`);
    const runs=runStatus(db,reportDate);
    console.log(`RUN CCSL: ${runs.ccsl?.status||'NONE'} | ${runs.ccsl?.currentStage||''}`);
    for(const item of runs.business)console.log(`RUN ${item.businessType}: ${item.status||'NONE'} | ${item.currentStage||''}`);

    let slowestMs=0;
    let allPass=String(batch.snapshotStatus||'').toUpperCase()==='COMPLETED';
    const results=[];
    for(const type of TYPES){
      const measured=timed(`${type} canonical audit`,()=>v241AuditType(db,reportDate,type,batch));
      slowestMs=Math.max(slowestMs,measured.elapsed);
      results.push(measured.value);
      if(!measured.value.pass)allPass=false;
    }
    const overlap=v241ShopeeOverlap(db,reportDate,batch);
    if(overlap.count>0)allPass=false;

    console.log('\nBUSINESS      SOURCE  NORMAL  NORM_POD  OBS_CUR  FALLBACK  EFFECTIVE  CUR_POD  POD+  REGRESS  TYPE_CONFLICT  RESULT');
    console.log('------------  ------  ------  --------  -------  --------  ---------  -------  ----  -------  -------------  ----------------');
    for(const row of results){
      console.log(`${pad(row.type,12)}  ${pad(row.sourceCount,6)}  ${pad(row.normalizedCount,6)}  ${pad(row.normalizedPod,8)}  ${pad(row.observedCurrentCount,7)}  ${pad(row.normalizedFallbackCurrentCount,8)}  ${pad(row.currentCount,9)}  ${pad(row.currentPod,7)}  ${pad(row.podProgression,4)}  ${pad(row.podRegressionCount,7)}  ${pad(row.currentTypeConflictCount,13)}  ${row.pass?'PASS':'BLOCKED'}`);
      console.log(`  sourceMode=${row.sourceMode} latest=${row.latestValidSnapshotCount} archive=${row.archiveUnifiedCount} parse=${row.businessParseCount} persistedAdded=${row.persistedFinalSupplementCount} declared=${row.declaredDailyCount===null?'-':row.declaredDailyCount}`);
      if(row.normalizedFallbackCurrentCount>0)console.log(`  normalized fallback current sample: ${JSON.stringify(row.normalizedFallbackSample)}`);
      if(!row.pass){
        console.log(`  ${row.type} diagnostics: missingNormalized=${row.missingNormalizedCount} ${JSON.stringify(row.missingNormalizedSample)} missingCurrent=${row.missingCurrentCount} ${JSON.stringify(row.missingCurrentSample)} typeConflict=${row.currentTypeConflictCount} ${JSON.stringify(row.currentTypeConflictSample)} podRegression=${row.podRegressionCount} ${JSON.stringify(row.podRegressionSample)}`);
      }
    }
    console.log(`SHOPEE CN/VN cross-board overlap: ${overlap.count}${overlap.count?` sample=${JSON.stringify(overlap.sample)}`:''}`);

    const sourceTotal=results.reduce((sum,row)=>sum+Number(row.sourceCount||0),0);
    const normalizedTotal=results.reduce((sum,row)=>sum+Number(row.normalizedCount||0),0);
    const observedCurrentTotal=results.reduce((sum,row)=>sum+Number(row.observedCurrentCount||0),0);
    const fallbackCurrentTotal=results.reduce((sum,row)=>sum+Number(row.normalizedFallbackCurrentCount||0),0);
    const currentTotal=results.reduce((sum,row)=>sum+Number(row.currentCount||0),0);
    console.log(`\nTOTAL canonicalSource=${sourceTotal} normalized=${normalizedTotal} observedCurrent=${observedCurrentTotal} normalizedFallback=${fallbackCurrentTotal} effectiveCurrent=${currentTotal}`);
    console.log(`SLOWEST_DB_CHECK_MS: ${slowestMs.toFixed(1)}`);
    if(slowestMs>3000){console.log('PERFORMANCE_RESULT: BLOCKED_SLOW_DB_QUERY');allPass=false;}
    else if(slowestMs>1000)console.log('PERFORMANCE_RESULT: WARN_QUERY_OVER_1S');
    else console.log('PERFORMANCE_RESULT: PASS');

    console.log(`GO_LIVE_RESULT: ${allPass?'READY':'BLOCKED'}`);
    exitCode=allPass?0:10;
  }
}catch(error){
  console.error('GO_LIVE_RESULT: BLOCKED_AUDIT_ERROR');
  console.error(error?.stack||error);
  exitCode=30;
}finally{db.close();}

const after=fs.statSync(dbFile);
console.log('READ-ONLY CONFIRMED');
console.log(`DATABASE MODIFIED: ${before.size===after.size&&before.mtimeMs===after.mtimeMs?'NO':'YES'}`);
process.exitCode=exitCode;
