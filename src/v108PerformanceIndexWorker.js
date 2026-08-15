import 'dotenv/config';
import fs from 'node:fs';
import { closeDb, getDb, getRuntimeConfig, nowIso } from './db.js';

const PATCH_ID='2026-08-15-v137-deferred-query-index-worker-v3';
const READY_KEY='v108_performance_indexes_ready';
const PURGE_KEY='data_purge_block_until';
const LARGE_DB_BYTES=Math.max(256*1024*1024,Number(process.env.V108_LARGE_DB_DEFER_BYTES||768*1024*1024));

const INDEXES=[
  ['idx_v108_unified_batches_valid_date',`CREATE INDEX IF NOT EXISTS idx_v108_unified_batches_valid_date ON unified_import_batches(status,reportDate DESC,createdAt DESC,snapshotId)`],
  ['idx_v108_unified_rows_snapshot_business',`CREATE INDEX IF NOT EXISTS idx_v108_unified_rows_snapshot_business ON unified_import_rows(snapshotId,businessType,shipmentCode,reportDate)`],
  ['idx_v108_final_report_bill',`CREATE INDEX IF NOT EXISTS idx_v108_final_report_bill ON final_rows(reportDate,shipmentCode,isPod,primaryCategory)`],
  ['idx_v108_business_final_report_type',`CREATE INDEX IF NOT EXISTS idx_v108_business_final_report_type ON business_final_rows(reportDate,businessType,shipmentCode,isPod,primaryCategory)`],
  ['idx_v108_business_scan_report_type',`CREATE INDEX IF NOT EXISTS idx_v108_business_scan_report_type ON business_scan_results(reportDate,businessType,shipmentCode,isPod,orderStatus)`],
  ['idx_v108_business_daily_report_type',`CREATE INDEX IF NOT EXISTS idx_v108_business_daily_report_type ON business_daily_parse_rows(reportDate,businessType,shipmentCode)`],
  ['idx_v108_metric_detail_lookup',`CREATE INDEX IF NOT EXISTS idx_v108_metric_detail_lookup ON metric_detail_members(snapshotId,businessType,metricKey,shipmentCode)`],
  ['idx_v108_current_business_date',`CREATE INDEX IF NOT EXISTS idx_v108_current_business_date ON shipment_current_state(businessType,reportDate,shipmentCode)`],
  ['idx_v137_current_bill',`CREATE INDEX IF NOT EXISTS idx_v137_current_bill ON shipment_current_state(shipmentCode)`],
  ['idx_v137_carry_bill_status',`CREATE INDEX IF NOT EXISTS idx_v137_carry_bill_status ON carryover_open_items(shipmentCode,status,updatedAt)`],
  ['idx_v137_final_bill_updated',`CREATE INDEX IF NOT EXISTS idx_v137_final_bill_updated ON final_rows(shipmentCode,updatedAt)`],
  ['idx_v137_business_final_bill_updated',`CREATE INDEX IF NOT EXISTS idx_v137_business_final_bill_updated ON business_final_rows(shipmentCode,businessType,updatedAt)`]
];

function activeBusinessWrite(db){
  const purgeUntil=Number(db.prepare('SELECT value FROM app_meta WHERE key=?').get(PURGE_KEY)?.value||0);
  if(Number.isFinite(purgeUntil)&&purgeUntil>Date.now())return 'DATA_PURGE_ACTIVE';
  if(db.prepare("SELECT 1 FROM run_locks WHERE status IN ('running','paused','paused_write') LIMIT 1").get())return 'CCSL_RUN_ACTIVE';
  if(db.prepare("SELECT 1 FROM business_run_locks WHERE status IN ('running','paused','paused_write') LIMIT 1").get())return 'BUSINESS_RUN_ACTIVE';
  return '';
}
function setMeta(db,key,value){db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(key,String(value??''),nowIso());}
function present(db,name){return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=? LIMIT 1").get(name));}
function databaseSize(){try{return Number(fs.statSync(getRuntimeConfig().dbFile).size||0);}catch{return 0;}}

try{
  const db=getDb();db.exec('PRAGMA busy_timeout=3000');
  const blocked=activeBusinessWrite(db);
  if(blocked){process.stdout.write(`${JSON.stringify({ok:true,skipped:true,reason:blocked,patchId:PATCH_ID})}\n`);closeDb();process.exit(0);}
  const missing=INDEXES.filter(([name])=>!present(db,name));
  if(!missing.length){setMeta(db,READY_KEY,'1');process.stdout.write(`${JSON.stringify({ok:true,skipped:true,reason:'ALREADY_READY',patchId:PATCH_ID})}\n`);closeDb();process.exit(0);}
  const size=databaseSize();
  if(size>=LARGE_DB_BYTES&&String(process.env.V108_FORCE_LARGE_DB_INDEX_BUILD||'')!=='1'){
    process.stdout.write(`${JSON.stringify({ok:true,skipped:true,reason:'LARGE_LEGACY_DB_DEFER_UNTIL_FAST_PURGE',patchId:PATCH_ID,size,threshold:LARGE_DB_BYTES,missing:missing.map(([name])=>name)})}\n`);
    closeDb();process.exit(0);
  }
  const built=[];
  for(const [name,sql] of missing){
    const newlyBlocked=activeBusinessWrite(db);if(newlyBlocked)break;
    try{db.exec(sql);built.push(name);}catch(error){if(/locked|busy/i.test(String(error?.message||'')))break;throw error;}
  }
  const remaining=INDEXES.filter(([name])=>!present(db,name)).map(([name])=>name);
  if(!remaining.length){try{db.exec('PRAGMA optimize');}catch{}setMeta(db,READY_KEY,'1');}
  process.stdout.write(`${JSON.stringify({ok:true,patchId:PATCH_ID,built,remaining})}\n`);closeDb();process.exit(0);
}catch(error){process.stderr.write(`${JSON.stringify({ok:false,patchId:PATCH_ID,error:error?.message||String(error)})}\n`);try{closeDb();}catch{}process.exit(1);}
