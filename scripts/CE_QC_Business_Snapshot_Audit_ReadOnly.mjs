import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  V241_TYPES,
  v241ReadLatestValidBatch,
  v241AuditType,
  v241ShopeeOverlap
} from './v241-readonly-canonical-membership.mjs';

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const projectRoot=path.resolve(__dirname,'..');
const DEFAULT_DATA_DIR='D:\\CE CCSL金边数据库';
const VALID_TYPES=new Set(V241_TYPES);
const resolveProjectPath=value=>path.isAbsolute(value)?path.normalize(value):path.resolve(projectRoot,value);
const pct=(n,d)=>d?`${(Number(n||0)/Number(d||0)*100).toFixed(2)}%`:'0.00%';
const now=()=>Number(process.hrtime.bigint())/1e6;

function config(){const dataDir=resolveProjectPath(process.env.DATA_DIR||DEFAULT_DATA_DIR);return{dataDir,dbFile:resolveProjectPath(process.env.DB_FILE||path.join(dataDir,'ce_qc_monitor.db'))};}

function main(){
  const reportDate=String(process.argv[2]||'').trim();
  const requestedType=String(process.argv[3]||'ALL').trim().toUpperCase();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)){console.error('Usage: node scripts/CE_QC_Business_Snapshot_Audit_ReadOnly.mjs YYYY-MM-DD [BUSINESS_TYPE|ALL]');process.exitCode=2;return;}
  if(requestedType!=='ALL'&&!VALID_TYPES.has(requestedType)){console.error(`Unsupported business type: ${requestedType}`);process.exitCode=2;return;}

  const cfg=config();
  if(!fs.existsSync(cfg.dbFile)){console.error(`RESULT: BLOCKED_DATABASE_NOT_FOUND ${cfg.dbFile}`);process.exitCode=3;return;}
  const before=fs.statSync(cfg.dbFile);
  const db=new DatabaseSync(cfg.dbFile,{readOnly:true});
  let blocked=false;
  try{
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1500;');
    console.log('\nCE QC BUSINESS SNAPSHOT AUDIT - V241 CANONICAL MEMBERSHIP / MONOTONIC POD - STRICT READ ONLY');
    console.log(`Database: ${cfg.dbFile}`);
    console.log(`Report date: ${reportDate}`);
    console.log('Rule: archive-union + business parse source membership must be fully represented in normalized/current truth; POD may advance after the daily run but cannot regress.');
    const batch=v241ReadLatestValidBatch(db,reportDate);
    if(!batch){console.log('RESULT: BLOCKED_NO_VALID_BATCH');process.exitCode=10;return;}
    console.log(`Latest VALID batch: ${batch.batchId}`);
    console.log(`Latest VALID snapshot: ${batch.snapshotId}`);
    console.log(`Latest VALID snapshot status: ${batch.snapshotStatus||'MISSING'}`);
    if(String(batch.snapshotStatus||'').toUpperCase()!=='COMPLETED')blocked=true;

    const types=requestedType==='ALL'?[...V241_TYPES]:[requestedType];
    console.log('\nBUSINESS      SOURCE  LATEST  ARCHIVE  PARSE  NORMAL  NORM_POD  CURRENT  CUR_POD  POD+  REGRESS  BLANK  QUERY_MS  RESULT');
    console.log('------------  ------  ------  -------  -----  ------  --------  -------  -------  ----  -------  -----  --------  ----------------------');
    for(const type of types){
      const started=now();
      const row=v241AuditType(db,reportDate,type,batch);
      const elapsed=now()-started;
      if(!row.pass||elapsed>3000)blocked=true;
      console.log(`${type.padEnd(12)}  ${String(row.sourceCount).padEnd(6)}  ${String(row.latestValidSnapshotCount).padEnd(6)}  ${String(row.archiveUnifiedCount).padEnd(7)}  ${String(row.businessParseCount).padEnd(5)}  ${String(row.normalizedCount).padEnd(6)}  ${String(row.normalizedPod).padEnd(8)}  ${String(row.currentCount).padEnd(7)}  ${String(row.currentPod).padEnd(7)}  ${String(row.podProgression).padEnd(4)}  ${String(row.podRegressionCount).padEnd(7)}  ${String(row.blankCategory).padEnd(5)}  ${elapsed.toFixed(1).padEnd(8)}  ${row.pass?(elapsed>3000?'BLOCKED_SLOW_QUERY':'CONSISTENT'):'BLOCKED_MISMATCH'}`);
      console.log(`  current POD rate: ${pct(row.currentPod,row.sourceCount)} · normalized POD rate: ${pct(row.normalizedPod,row.sourceCount)} · declared daily total: ${row.declaredDailyCount===null?'-':row.declaredDailyCount} · recovered beyond latest VALID snapshot: ${row.recoveredBeyondLatest}`);
      if(!row.pass)console.log(`  diagnostics: missingNormalized=${row.missingNormalizedCount} ${JSON.stringify(row.missingNormalizedSample)} missingCurrent=${row.missingCurrentCount} ${JSON.stringify(row.missingCurrentSample)} podRegression=${row.podRegressionCount} ${JSON.stringify(row.podRegressionSample)}`);
    }
    if(requestedType==='ALL'||requestedType==='SHOPEECN'||requestedType==='SHOPEEVN'){
      const overlap=v241ShopeeOverlap(db,reportDate,batch);
      console.log(`SHOPEE CN/VN cross-board overlap: ${overlap.count}${overlap.count?` sample=${JSON.stringify(overlap.sample)}`:''}`);
      if(overlap.count>0)blocked=true;
    }
    console.log(`\nRESULT: ${blocked?'BLOCKED':'READY'}`);
    process.exitCode=blocked?10:0;
  }catch(error){
    console.error('RESULT: BLOCKED_AUDIT_ERROR');
    console.error(error?.stack||error);
    process.exitCode=20;
  }finally{db.close();}
  const after=fs.statSync(cfg.dbFile);
  console.log('READ-ONLY CONFIRMED');
  console.log(`DATABASE MODIFIED: ${before.size===after.size&&before.mtimeMs===after.mtimeMs?'NO':'YES'}`);
}

main();
