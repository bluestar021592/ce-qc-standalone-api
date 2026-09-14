import 'dotenv/config';

import { closeDb, getDb, nowIso } from './db.js';
import {
  getDashboardCacheStatus,
  markDashboardCacheDirty,
  refreshDashboardCacheDirty,
  warmDashboardCacheRange
} from './rangeDashboardStore.js';
import {
  refreshV235CurrentDashboardCacheDate,
  V235_DASHBOARD_CURRENT_CACHE_ID
} from './v235DashboardCurrentCache.js';
import { readV237DashboardTrends } from './v237DashboardTrendRead.js';

const args = process.argv.slice(2);
const valueAfter = flag => { const index=args.indexOf(flag); return index>=0?String(args[index+1]||'').trim():''; };
const reportDate=valueAfter('--date');
const reason=valueAfter('--reason')||(reportDate?'EVENT_REFRESH':'SCHEDULED_REFRESH');
const warmDays=Math.max(1,Math.min(180,Number(process.env.DASHBOARD_CACHE_WARM_DAYS||60)));
const WORKER_ACTIVE_KEY='dashboard_cache_worker_active';
const WORKER_ACTIVE_UNTIL_KEY='dashboard_cache_worker_active_until';
const PURGE_BLOCK_KEY='data_purge_block_until';
const WORKER_LEASE_MS=5*60_000;
const TREND_AUDIT_ID='2026-09-01-persisted-dashboard-cache-no-startup-rebuild-v1';
const TREND_AUDIT_META_KEY='v243_trend_audit_latest';
export const FINALIZED_HISTORY_BACKFILL_REVISION='2026-09-02-finalized-dashboard-history-backfill-once-v1';
export const FINALIZED_HISTORY_BACKFILL_META_KEY='finalized_dashboard_history_backfill_revision';
export const V419_DASHBOARD_CACHE_SAFE_MODE_GUARD_ID='2026-09-02-v419-dashboard-cache-auto-safe-mode-guard-v1';
export const V536_MANUAL_ONLY_DASHBOARD_CACHE_ID='2026-09-14-v536-manual-only-dashboard-cache-v1';
const AUDIT_TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP','CCSL','SHOPEE','ALL'];
const AUTOMATIC_REASONS=new Set(['SCHEDULED_REFRESH','STARTUP_WARM','V235_INTERACTIVE_STARTUP','TEN_MINUTE_REFRESH']);
const workerId=`${process.pid}-${Date.now()}`;
const workerStartedAt=Date.now();
let workerLeaseOwned=false;

function writeResult(result){process.stdout.write(`${JSON.stringify({ok:true,reason,reportDate,cacheId:V235_DASHBOARD_CURRENT_CACHE_ID,elapsedMs:Date.now()-workerStartedAt,result})}\n`);}
function writeSkip(skipReason){writeResult({skipped:true,reason:skipReason});}
function automaticCacheSkip(){return !reportDate&&AUTOMATIC_REASONS.has(reason);}
function recoverySafeAutomaticSkip(){return !reportDate&&String(process.env.CE_QC_RECOVERY_SAFE_MODE||'')==='1'&&AUTOMATIC_REASONS.has(reason);}
function activeForegroundRun(db=getDb()){if(db.prepare("SELECT 1 FROM run_locks WHERE status IN ('running','paused_write') LIMIT 1").get())return true;return Boolean(db.prepare("SELECT 1 FROM business_run_locks WHERE status IN ('running','paused_write') LIMIT 1").get());}
function ownerPid(owner=''){const pid=Number(String(owner||'').split('-')[0]);return Number.isInteger(pid)&&pid>0?pid:0;}
function pidAlive(pid){if(!pid)return false;try{process.kill(pid,0);return true;}catch(error){return error?.code==='EPERM';}}
function acquireWorkerLease(){const db=getDb();db.exec('BEGIN IMMEDIATE');try{const purgeUntil=Number(db.prepare('SELECT value FROM app_meta WHERE key=?').get(PURGE_BLOCK_KEY)?.value||0);if(Number.isFinite(purgeUntil)&&purgeUntil>Date.now()){db.exec('ROLLBACK');return false;}const existingUntil=Number(db.prepare('SELECT value FROM app_meta WHERE key=?').get(WORKER_ACTIVE_UNTIL_KEY)?.value||0),existingOwner=String(db.prepare('SELECT value FROM app_meta WHERE key=?').get(WORKER_ACTIVE_KEY)?.value||''),existingPid=ownerPid(existingOwner),activeExistingLease=existingOwner&&Number.isFinite(existingUntil)&&existingUntil>Date.now()&&existingOwner!==workerId;if(activeExistingLease&&pidAlive(existingPid)){db.exec('ROLLBACK');return false;}if(activeExistingLease&&!pidAlive(existingPid)){db.prepare('DELETE FROM app_meta WHERE key IN (?,?)').run(WORKER_ACTIVE_KEY,WORKER_ACTIVE_UNTIL_KEY);process.stderr.write(`[CE-QC][V239] cleared stale dashboard-cache lease owner=${existingOwner} until=${existingUntil}\n`);}const until=Date.now()+WORKER_LEASE_MS,upsert=db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`);upsert.run(WORKER_ACTIVE_KEY,workerId,nowIso());upsert.run(WORKER_ACTIVE_UNTIL_KEY,String(until),nowIso());db.exec('COMMIT');workerLeaseOwned=true;return true;}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
function releaseWorkerLease(){if(!workerLeaseOwned)return;try{const db=getDb();db.exec('BEGIN IMMEDIATE');try{const owner=String(db.prepare('SELECT value FROM app_meta WHERE key=?').get(WORKER_ACTIVE_KEY)?.value||'');if(owner===workerId)db.prepare('DELETE FROM app_meta WHERE key IN (?,?)').run(WORKER_ACTIVE_KEY,WORKER_ACTIVE_UNTIL_KEY);db.exec('COMMIT');}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}catch{}workerLeaseOwned=false;}
function markHistoryBackfillDone(result){const stamp=nowIso(),payload={revision:FINALIZED_HISTORY_BACKFILL_REVISION,completedAt:stamp,warmDays,result};getDb().prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(FINALIZED_HISTORY_BACKFILL_META_KEY,JSON.stringify(payload),stamp);}
function uniqueCount(rows,key){return new Set(rows.map(row=>row?.[key]).filter(value=>value!==null&&value!==undefined).map(value=>String(value))).size;}
function auditRecentTrendSeries(dates=[]){const ordered=[...new Set(dates.map(value=>String(value||'').slice(0,10)).filter(Boolean))].sort();if(!ordered.length)return{auditId:TREND_AUDIT_ID,fromDate:'',toDate:'',dates:[],byType:{},suspiciousFlatSeries:[]};const fromDate=ordered[0],toDate=ordered.at(-1),byType={},suspiciousFlatSeries=[];for(const type of AUDIT_TYPES){const trend=readV237DashboardTrends(type,fromDate,toDate),ready=(trend.daily||[]).filter(row=>row?.ready),flatRateKeys=['podRate','ocRate','sameDayPodRate'].filter(key=>ready.length>=3&&uniqueCount(ready,key)<=1),suspicious=ready.length>=3&&flatRateKeys.length===3&&ready.some(row=>Number(row.total||0)>0),daily=ready.map(row=>({reportDate:row.reportDate,total:Number(row.total||0),pod:Number(row.pod||0),podRate:Number(row.podRate||0),ocCurrent:Number(row.ocCurrent||0),ocRate:Number(row.ocRate||0),sameDayPod:Number(row.sameDayPod||0),sameDayPodRate:Number(row.sameDayPodRate||0)}));byType[type]={readyDates:ready.length,missingDates:Array.isArray(trend.missingDates)?trend.missingDates:[],unique:{total:uniqueCount(ready,'total'),podRate:uniqueCount(ready,'podRate'),ocRate:uniqueCount(ready,'ocRate'),sameDayPodRate:uniqueCount(ready,'sameDayPodRate')},flatRateKeys,status:suspicious?'SUSPICIOUS_FLAT_SERIES':(ready.length?'OK':'NO_READY_DATES'),daily};if(suspicious)suspiciousFlatSeries.push(type);}const audit={auditId:TREND_AUDIT_ID,fromDate,toDate,dates:ordered,byType,suspiciousFlatSeries};try{getDb().prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`).run(TREND_AUDIT_META_KEY,JSON.stringify(audit),nowIso());}catch(error){audit.persistError=error?.message||String(error);}return audit;}

try{
  if(automaticCacheSkip()){writeSkip('AUTOMATIC_DASHBOARD_CACHE_DISABLED');process.exit(0);}
  if(recoverySafeAutomaticSkip()){writeSkip('RECOVERY_SAFE_MODE_AUTOMATIC_CACHE_SKIP');process.exit(0);}
  if(/^(?:UNIFIED_IMPORT|DAILY_IMPORT|SHOPEE_IMPORT)$/.test(reason)){writeSkip('IMPORT_DIRTY_ONLY_WAIT_FOR_RUN_COMPLETED');process.exit(0);}
  if(activeForegroundRun()){writeSkip('FOREGROUND_PROCESSING_ACTIVE');closeDb();process.exit(0);}
  if(!acquireWorkerLease()){writeSkip('CACHE_OR_PURGE_WORKER_ALREADY_ACTIVE');closeDb();process.exit(0);}
  let result;
  if(reportDate){markDashboardCacheDirty(reportDate,reason);result=refreshV235CurrentDashboardCacheDate(reportDate,{force:true});}
  else if(reason==='FINALIZED_HISTORY_BACKFILL'){
    const warmed=warmDashboardCacheRange({days:warmDays});result={mode:'FINALIZED_HISTORY_BACKFILL',revision:FINALIZED_HISTORY_BACKFILL_REVISION,...warmed};markHistoryBackfillDone(result);
    const dates=(getDb().prepare("SELECT reportDate FROM dashboard_cache_dates WHERE status='COMPLETED' ORDER BY reportDate DESC LIMIT ?").all(warmDays)||[]).map(row=>String(row.reportDate||'')).filter(Boolean).reverse();
    result.trendAudit=auditRecentTrendSeries(dates);
  }else if(reason==='V235_INTERACTIVE_STARTUP'||reason==='STARTUP_WARM'){
    const status=getDashboardCacheStatus();
    if(Number(status.cachedDates||0)===0)result={mode:'INITIAL_CACHE_WARM_ONCE',...warmDashboardCacheRange({days:warmDays})};
    else{const refreshed=refreshDashboardCacheDirty({ limit: 24, recentDays: 30 });result={mode:'PERSISTED_CACHE_STARTUP_READ_ONLY',cachedDates:Number(status.cachedDates||0),...refreshed};}
  }else{
    const status=getDashboardCacheStatus();if(Number(status.cachedDates||0)===0)result=warmDashboardCacheRange({days:warmDays});else result=refreshDashboardCacheDirty({ limit: 24, recentDays: 30 });
  }
  writeResult(result);releaseWorkerLease();closeDb();process.exit(0);
}catch(error){process.stderr.write(`${JSON.stringify({ok:false,reason,cacheId:V235_DASHBOARD_CURRENT_CACHE_ID,elapsedMs:Date.now()-workerStartedAt,error:error?.stack||error?.message||String(error)})}\n`);try{releaseWorkerLease();}catch{}try{closeDb();}catch{}process.exit(1);}
