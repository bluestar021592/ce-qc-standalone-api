import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { getDb, getRuntimeConfig } from './db.js';

export const V505_PURGE_EXECUTE_READONLY_PREFLIGHT_ID='2026-09-12-v505-execute-readonly-preflight-v6-sealed-db-recovery';
const PURGE_BLOCK_KEY='data_purge_block_until';
const PURGE_COMMIT_RECEIPT_KEY='data_purge_last_commit_receipt';
const CACHE_WORKER_ACTIVE_KEY='dashboard_cache_worker_active';
const CACHE_WORKER_ACTIVE_UNTIL_KEY='dashboard_cache_worker_active_until';
const PREPARE_JOB_DIR='.purge_prepare_jobs';

function coded(code,message){const error=new Error(message);error.code=code;return error;}
function readJson(file){
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}
  catch(error){throw coded('V505_PURGE_EXECUTE_JOB_UNREADABLE',`无法读取后台清空任务状态，已阻止破坏性操作：${error?.message||String(error)}`);}
}
function readEvidence(file,label){
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}
  catch(error){throw coded('V505_PURGE_EXECUTE_SEALED_DB_EVIDENCE_UNREADABLE',`无法读取${label}，系统不会打开任何候选数据库：${error?.message||String(error)}`);}
}
function identityKey(user={}){
  const identity=String(user.id||user.email||user.username||'').trim().toLowerCase();
  if(!identity)return '';
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0,24);
}
function normalizedFilePath(value=''){
  const text=String(value||'').trim();
  if(!text)return '';
  const resolved=path.resolve(text);
  return process.platform==='win32'?resolved.toLowerCase():resolved;
}
function sameFilePath(a,b){
  const left=normalizedFilePath(a),right=normalizedFilePath(b);
  return Boolean(left&&right&&left===right);
}
function readMeta(db,key){
  try{return db.prepare('SELECT value FROM app_meta WHERE key=?').get(key)?.value;}
  catch(error){throw coded('V505_PURGE_EXECUTE_META_UNREADABLE',`无法只读核对清空安全元数据，已阻止破坏性操作：${error?.message||String(error)}`);}
}
function strictReceipt(db){
  const raw=String(readMeta(db,PURGE_COMMIT_RECEIPT_KEY)||'');
  if(!raw)return null;
  let receipt;
  try{receipt=JSON.parse(raw);}catch(error){throw coded('V505_PURGE_COMMIT_RECEIPT_INVALID',`检测到无法解析的清空事务提交凭证，系统不会猜测“未提交”：${error?.message||String(error)}`);}
  if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))throw coded('V505_PURGE_COMMIT_RECEIPT_INVALID','检测到无效的清空事务提交凭证，系统不会猜测“未提交”。');
  const challengeId=String(receipt.challengeId||'').trim();
  const executeJobId=String(receipt.executeJobId||'').trim();
  const committedAt=String(receipt.committedAt||'').trim();
  const finalizedAt=String(receipt.finalizedAt||'').trim();
  const finalizationState=String(receipt.finalizationState||'').trim();
  if(!challengeId||!executeJobId||!committedAt||!Number.isFinite(Date.parse(committedAt))){
    throw coded('V505_PURGE_COMMIT_RECEIPT_INVALID','清空事务提交凭证缺少 challengeId、executeJobId 或有效 committedAt；系统不会猜测“未提交”。');
  }
  if(finalizedAt&&!Number.isFinite(Date.parse(finalizedAt))){
    throw coded('V505_PURGE_COMMIT_RECEIPT_INVALID','清空事务提交凭证包含无效 finalizedAt；系统不会猜测最终清理已经成功。');
  }
  if(finalizedAt&&finalizationState!=='SAFE_POSTCHECK_PASSED'){
    throw coded('V505_PURGE_COMMIT_RECEIPT_INVALID','清空事务提交凭证包含 finalizedAt，但缺少精确 SAFE_POSTCHECK_PASSED 最终状态；系统保持停止。');
  }
  if(!finalizedAt&&finalizationState){
    throw coded('V505_PURGE_COMMIT_RECEIPT_INVALID','清空事务提交凭证包含 finalizationState，但缺少 finalizedAt；系统保持停止。');
  }
  return receipt;
}
function exactReceipt(receipt,job={}){
  if(!receipt)return false;
  const challengeId=String(job.challengeId||job.request?.challengeId||'');
  const executeJobId=String(job.jobId||'');
  return Boolean(challengeId&&executeJobId&&String(receipt.challengeId||'')===challengeId&&String(receipt.executeJobId||'')===executeJobId);
}
function receiptIsFinalized(receipt={}){
  const finalizedAt=String(receipt?.finalizedAt||'').trim();
  return Boolean(finalizedAt&&Number.isFinite(Date.parse(finalizedAt))&&String(receipt?.finalizationState||'')==='SAFE_POSTCHECK_PASSED');
}
function activeRunLock(db){
  try{
    const main=db.prepare("SELECT runId,'CCSL' family FROM run_locks WHERE status IN ('running','paused','paused_write') LIMIT 1").get();
    if(main)return main;
    return db.prepare("SELECT runId,COALESCE(businessType,'BUSINESS') family FROM business_run_locks WHERE status IN ('running','paused','paused_write') LIMIT 1").get()||null;
  }catch(error){throw coded('V505_PURGE_EXECUTE_RUN_LOCK_UNREADABLE',`无法只读核对运行锁，已阻止破坏性操作：${error?.message||String(error)}`);}
}

export function assertPurgeExecuteSealedDatabasePath(payload={}){
  const jobFile=String(payload.jobFile||'');
  const jobId=String(payload.jobId||'');
  if(!jobFile||!jobId)throw coded('V505_PURGE_EXECUTE_PREFLIGHT_PAYLOAD_INVALID','后台清空任务缺少数据库路径封存预检参数。');
  const job=readJson(jobFile);
  if(String(job?.jobId||'')!==jobId)throw coded('V505_PURGE_EXECUTE_JOB_MISMATCH','后台清空任务编号与持久化状态不一致，已阻止破坏性操作。');
  const challengeId=String(job.challengeId||job.request?.challengeId||payload.request?.challengeId||'').trim();
  if(!challengeId)throw coded('V505_PURGE_EXECUTE_SEALED_DB_EVIDENCE_MISSING','后台清空任务缺少 challengeId，系统不会打开任何候选数据库。');

  const cfg=getRuntimeConfig();
  const runtimeDatabasePath=String(cfg.dbFile||'').trim();
  const jobStatus=String(job?.status||'').toUpperCase();
  const sidecarDatabasePath=String(job?.sealedDatabasePath||'').trim();
  const payloadDatabasePath=String(payload?.sealedDatabasePath||'').trim();
  if(sidecarDatabasePath){
    if(payloadDatabasePath&&!sameFilePath(payloadDatabasePath,sidecarDatabasePath)){
      throw coded('V505_PURGE_EXECUTE_SEALED_DB_PATH_MISMATCH','EXECUTE worker payload 的封存数据库路径与 durable sidecar 不一致，系统不会打开数据库。');
    }
    if(!sameFilePath(runtimeDatabasePath,sidecarDatabasePath)){
      throw coded('V505_PURGE_EXECUTE_SEALED_DB_PATH_CHANGED',`当前运行时数据库路径已从 durable EXECUTE 封存路径发生变化，系统不会打开 fallback 或其他数据库。sealed=${sidecarDatabasePath} current=${runtimeDatabasePath}`);
    }
  }

  const user=job.user&&typeof job.user==='object'?job.user:(payload.user||{});
  const key=identityKey(user);
  if(!key)throw coded('V505_PURGE_EXECUTE_SEALED_DB_EVIDENCE_MISSING','后台清空任务缺少管理员身份，无法定位已封存数据库路径证据。');
  const prepareDir=path.join(cfg.backupsDir,PREPARE_JOB_DIR);
  let prepare,persisted;
  try{
    prepare=readEvidence(path.join(prepareDir,`${key}.job.json`),'清空前安全备份任务证据');
    persisted=readEvidence(path.join(prepareDir,`${key}.challenge.json`),'清空前持久化验证凭证');
  }catch(error){
    if(sidecarDatabasePath&&jobStatus==='COMMITTED'){
      return {ok:true,jobId,challengeId,sealedDatabasePath:sidecarDatabasePath,currentDatabasePath:runtimeDatabasePath,evidence:'COMMITTED_EXECUTE_SIDECAR',preflight:V505_PURGE_EXECUTE_READONLY_PREFLIGHT_ID};
    }
    throw error;
  }
  if(String(prepare?.status||'').toUpperCase()!=='SUCCEEDED'||String(prepare?.payload?.challengeId||'')!==challengeId){
    throw coded('V505_PURGE_EXECUTE_SEALED_DB_EVIDENCE_MISMATCH','清空前安全备份任务与当前 destructive job 的 challengeId 不一致，系统不会打开数据库。');
  }
  if(String(persisted?.challengeId||'')!==challengeId||!persisted?.challenge){
    throw coded('V505_PURGE_EXECUTE_SEALED_DB_EVIDENCE_MISMATCH','持久化清空验证凭证与当前 destructive job 不一致，系统不会打开数据库。');
  }

  const prepareDatabasePath=String(prepare?.payload?.databasePath||'').trim();
  const persistedDatabasePath=String(persisted?.payload?.databasePath||'').trim();
  const manifestPath=String(persisted?.challenge?.backup?.manifestPath||'').trim();
  if(!prepareDatabasePath||!persistedDatabasePath||!manifestPath){
    if(sidecarDatabasePath&&jobStatus==='COMMITTED'){
      return {ok:true,jobId,challengeId,sealedDatabasePath:sidecarDatabasePath,currentDatabasePath:runtimeDatabasePath,evidence:'COMMITTED_EXECUTE_SIDECAR',preflight:V505_PURGE_EXECUTE_READONLY_PREFLIGHT_ID};
    }
    throw coded('V505_PURGE_EXECUTE_SEALED_DB_EVIDENCE_MISSING','已验证安全备份缺少数据库路径或备份 manifest 路径，系统不会打开数据库。');
  }
  let manifest;
  try{manifest=readEvidence(manifestPath,'清空前安全备份 manifest');}
  catch(error){
    if(sidecarDatabasePath&&jobStatus==='COMMITTED'){
      return {ok:true,jobId,challengeId,sealedDatabasePath:sidecarDatabasePath,currentDatabasePath:runtimeDatabasePath,evidence:'COMMITTED_EXECUTE_SIDECAR',preflight:V505_PURGE_EXECUTE_READONLY_PREFLIGHT_ID};
    }
    throw error;
  }
  const manifestDatabasePath=String(manifest?.databasePath||'').trim();
  if(!manifestDatabasePath||!sameFilePath(prepareDatabasePath,persistedDatabasePath)||!sameFilePath(prepareDatabasePath,manifestDatabasePath)){
    throw coded('V505_PURGE_EXECUTE_SEALED_DB_PATH_MISMATCH','PREPARE、持久化 challenge 与备份 manifest 记录的数据库路径不一致，系统不会打开数据库。');
  }
  if(sidecarDatabasePath&&!sameFilePath(sidecarDatabasePath,prepareDatabasePath)){
    throw coded('V505_PURGE_EXECUTE_SEALED_DB_PATH_MISMATCH','EXECUTE sidecar 的封存数据库路径与安全备份证据不一致，系统不会打开数据库。');
  }
  if(payloadDatabasePath&&!sameFilePath(payloadDatabasePath,prepareDatabasePath)){
    throw coded('V505_PURGE_EXECUTE_SEALED_DB_PATH_MISMATCH','EXECUTE worker payload 的封存数据库路径与安全备份证据不一致，系统不会打开数据库。');
  }
  if(!sameFilePath(runtimeDatabasePath,prepareDatabasePath)){
    throw coded('V505_PURGE_EXECUTE_SEALED_DB_PATH_CHANGED',`当前运行时数据库路径已从安全备份封存路径发生变化，系统不会打开 fallback 或其他数据库。sealed=${prepareDatabasePath} current=${runtimeDatabasePath}`);
  }
  return {ok:true,jobId,challengeId,sealedDatabasePath:prepareDatabasePath,currentDatabasePath:runtimeDatabasePath,evidence:'PREPARE_CHALLENGE_MANIFEST',preflight:V505_PURGE_EXECUTE_READONLY_PREFLIGHT_ID};
}

export function assertPurgeExecuteReadOnlyPreflight(payload={}){
  const jobFile=String(payload.jobFile||'');
  const jobId=String(payload.jobId||'');
  if(!jobFile||!jobId)throw coded('V505_PURGE_EXECUTE_PREFLIGHT_PAYLOAD_INVALID','后台清空任务缺少只读预检参数。');
  const job=readJson(jobFile);
  if(String(job?.jobId||'')!==jobId)throw coded('V505_PURGE_EXECUTE_JOB_MISMATCH','后台清空任务编号与持久化状态不一致，已阻止破坏性操作。');

  const db=getDb();
  const receipt=strictReceipt(db);
  if(exactReceipt(receipt,job)){
    return {ok:true,committed:true,jobId,preflight:V505_PURGE_EXECUTE_READONLY_PREFLIGHT_ID};
  }

  const jobStatus=String(job?.status||'').toUpperCase();
  if(jobStatus==='COMMITTED'){
    throw coded('V505_PURGE_COMMITTED_RECEIPT_MISSING','后台任务状态已经进入 COMMITTED，但当前不存在与该 challengeId + executeJobId 精确匹配的SQLite事务提交凭证。系统不会把已提交状态降级为“未提交”，也不会再次执行DELETE。');
  }
  if(receipt&&!receiptIsFinalized(receipt)){
    throw coded('V505_PURGE_OTHER_COMMIT_RECEIPT_PENDING','检测到另一份尚未最终完成的SQLite清空事务提交凭证。系统不会在其恢复完成前启动新的DELETE。');
  }

  const blockUntil=Number(readMeta(db,PURGE_BLOCK_KEY)||0);
  if(!Number.isFinite(blockUntil)||blockUntil<=Date.now())throw coded('V505_PURGE_EXECUTE_SAFETY_BLOCK_MISSING','清空安全锁已失效，后台删除不会继续。');

  const lock=activeRunLock(db);
  if(lock)throw coded('V505_PURGE_EXECUTE_RUN_LOCK_PRESENT',`安全备份封存后检测到运行中或暂停中的任务锁，后台删除不会修改该锁，也不会继续删除。runId：${lock.runId||'unknown'}`);

  const cacheOwner=String(readMeta(db,CACHE_WORKER_ACTIVE_KEY)||'');
  const cacheUntil=Number(readMeta(db,CACHE_WORKER_ACTIVE_UNTIL_KEY)||0);
  if(cacheOwner&&Number.isFinite(cacheUntil)&&cacheUntil>Date.now()){
    throw coded('V505_PURGE_EXECUTE_CACHE_WORKER_PRESENT','安全备份封存后检测到看板缓存任务标记。后台删除不会清理该标记，也不会继续删除。');
  }

  return {ok:true,committed:false,jobId,blockUntil,preflight:V505_PURGE_EXECUTE_READONLY_PREFLIGHT_ID};
}
