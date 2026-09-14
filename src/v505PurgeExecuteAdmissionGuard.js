import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { getDb, getRuntimeConfig } from './db.js';

export const V505_PURGE_EXECUTE_ADMISSION_ID='2026-09-14-v505-execute-admission-v9-finalized-generation-yield';
const PREPARE_JOB_DIR='.purge_prepare_jobs';
const EXECUTE_JOB_DIR='.purge_execute_jobs';
const PURGE_COMMIT_RECEIPT_KEY='data_purge_last_commit_receipt';
const ACTIVE_EXECUTE=new Set(['QUEUED','RUNNING','COMMITTED']);
const KNOWN_EXECUTE=new Set(['QUEUED','RUNNING','COMMITTED','SUCCEEDED','FAILED']);

function identityKey(user={}){
  const identity=String(user.id||user.email||user.username||'').trim().toLowerCase();
  if(!identity)return '';
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0,24);
}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
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
function validExecuteSidecar(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const status=String(value.status||'').toUpperCase();
  const jobId=String(value.jobId||'').trim();
  const challengeId=String(value.challengeId||value.request?.challengeId||'').trim();
  return Boolean(jobId&&challengeId&&KNOWN_EXECUTE.has(status));
}
function readJsonState(file){
  if(!fs.existsSync(file))return {exists:false,value:null,error:''};
  try{
    const value=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!validExecuteSidecar(value))return {exists:true,value:null,error:'JSON结构缺少有效 jobId / challengeId / status'};
    return {exists:true,value,error:''};
  }catch(error){return {exists:true,value:null,error:String(error?.message||error)};}
}
function strictCommitReceiptState(){
  let raw='';
  try{raw=String(getDb().prepare('SELECT value FROM app_meta WHERE key=?').get(PURGE_COMMIT_RECEIPT_KEY)?.value||'');}
  catch(error){return {present:true,receipt:null,unreadable:true,error:`无法读取SQLite提交凭证：${error?.message||String(error)}`};}
  if(!raw)return {present:false,receipt:null,unreadable:false,error:''};
  try{
    const receipt=JSON.parse(raw);
    if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))return {present:true,receipt:null,unreadable:true,error:'提交凭证JSON不是对象'};
    const receiptChallenge=String(receipt.challengeId||'').trim();
    const executeJobId=String(receipt.executeJobId||'').trim();
    const committedAt=String(receipt.committedAt||'').trim();
    const finalizedAt=String(receipt.finalizedAt||'').trim();
    const finalizationState=String(receipt.finalizationState||'').trim();
    if(!receiptChallenge||!executeJobId||!committedAt||!Number.isFinite(Date.parse(committedAt))){
      return {present:true,receipt:null,unreadable:true,error:'提交凭证缺少 challengeId / executeJobId / 有效 committedAt'};
    }
    if(finalizedAt&&!Number.isFinite(Date.parse(finalizedAt))){
      return {present:true,receipt:null,unreadable:true,error:'提交凭证 finalizedAt 无效'};
    }
    if(finalizedAt&&finalizationState!=='SAFE_POSTCHECK_PASSED'){
      return {present:true,receipt:null,unreadable:true,error:'提交凭证 finalizedAt 存在但 finalizationState 不是 SAFE_POSTCHECK_PASSED'};
    }
    if(!finalizedAt&&finalizationState){
      return {present:true,receipt:null,unreadable:true,error:'提交凭证存在 finalizationState 但缺少 finalizedAt'};
    }
    return {present:true,receipt,unreadable:false,error:''};
  }catch(error){return {present:true,receipt:null,unreadable:true,error:String(error?.message||error)};}
}
function receiptMatches(receipt,challengeId,jobId){
  return Boolean(receipt&&String(receipt.challengeId||'')===String(challengeId||'')&&String(receipt.executeJobId||'')===String(jobId||''));
}
function receiptIsFinalized(receipt={}){
  const finalizedAt=String(receipt?.finalizedAt||'').trim();
  return Boolean(finalizedAt&&Number.isFinite(Date.parse(finalizedAt))&&String(receipt?.finalizationState||'')==='SAFE_POSTCHECK_PASSED');
}
function filesFor(user={}){
  const key=identityKey(user);
  if(!key)return null;
  const root=getRuntimeConfig().backupsDir;
  return {
    prepareJob:path.join(root,PREPARE_JOB_DIR,`${key}.job.json`),
    challenge:path.join(root,PREPARE_JOB_DIR,`${key}.challenge.json`),
    executeJob:path.join(root,EXECUTE_JOB_DIR,`${key}.job.json`)
  };
}
function fail(res,code,error,detail={}){
  return res.status(409).json({ok:false,code,error,...detail,admissionPatch:V505_PURGE_EXECUTE_ADMISSION_ID});
}
function future(value){
  const parsed=typeof value==='number'?Number(value):Date.parse(String(value||''));
  return Number.isFinite(parsed)&&parsed>Date.now();
}

export function inspectPurgeExecuteAdmission(user={},request={}){
  const challengeId=String(request.challengeId||'').trim();
  if(!challengeId)return {ok:false,code:'V505_PURGE_EXECUTE_CHALLENGE_MISSING',error:'缺少清空验证凭证，后台删除不会启动。'};
  const files=filesFor(user);
  if(!files)return {ok:false,code:'V505_PURGE_EXECUTE_IDENTITY_MISSING',error:'缺少管理员身份，后台删除不会启动。'};

  const executeState=readJsonState(files.executeJob);
  if(executeState.exists&&!executeState.value){
    return {ok:false,code:'V505_PURGE_EXECUTE_SIDECAR_UNREADABLE',error:`检测到无法确认的后台清空任务状态文件。系统不会覆盖它或启动第二个删除任务：${executeState.error||'UNKNOWN'}`};
  }
  const existingExecute=executeState.value;
  const existingSealedDatabasePath=String(existingExecute?.sealedDatabasePath||'').trim();
  if(existingSealedDatabasePath&&!sameFilePath(existingSealedDatabasePath,getRuntimeConfig().dbFile)){
    return {ok:false,code:'V505_PURGE_EXECUTE_SEALED_DB_PATH_CHANGED',error:'已有 destructive job 绑定的数据库路径与当前运行时路径不同。系统不会打开 fallback 或其他数据库读取提交凭证，也不会启动/接管删除任务。'};
  }

  const receiptState=strictCommitReceiptState();
  if(receiptState.unreadable){
    return {ok:false,code:'V505_PURGE_COMMIT_RECEIPT_UNREADABLE',error:`检测到无法验证的SQLite清空事务提交凭证。后台删除不会启动或接管：${receiptState.error||'UNKNOWN'}`};
  }
  const durableReceipt=receiptState.receipt;
  if(existingExecute){
    const status=String(existingExecute.status||'').toUpperCase();
    const existingChallenge=String(existingExecute.challengeId||existingExecute.request?.challengeId||'');
    const jobId=String(existingExecute.jobId||'');
    const exactReceipt=receiptMatches(durableReceipt,existingChallenge,jobId)?durableReceipt:null;
    if(exactReceipt){
      const finalizedExact=receiptIsFinalized(exactReceipt);
      if(existingChallenge===challengeId){
        return {ok:true,recovery:true,status:finalizedExact?'FINALIZED':'COMMITTED',jobId,challengeId,durableReceipt:true,receiptFinalized:finalizedExact,sealedDatabasePath:existingSealedDatabasePath};
      }
      // Only a fully finalized, already-SUCCEEDED older generation may yield to
      // a newer independently verified PREPARE. RUNNING/QUEUED/COMMITTED and
      // FAILED sidecars stay fail-closed even if stale filesystem evidence exists.
      if(!(finalizedExact&&status==='SUCCEEDED')){
        return {ok:false,code:'V505_PURGE_EXECUTE_ACTIVE_CHALLENGE_MISMATCH',error:'已有精确SQLite提交凭证绑定另一份清空验证。系统不会启动新的删除任务，必须先恢复已提交任务。'};
      }
    }
    if(durableReceipt&&!receiptIsFinalized(durableReceipt)){
      return {ok:false,code:'V505_PURGE_COMMIT_RECEIPT_PENDING_RECOVERY',error:'检测到SQLite已提交但尚未最终完成的另一份清空凭证。系统不会启动或接管新的删除任务。'};
    }
    if(ACTIVE_EXECUTE.has(status)){
      if(existingChallenge===challengeId){
        return {ok:true,recovery:true,status,jobId,challengeId,sealedDatabasePath:existingSealedDatabasePath};
      }
      return {ok:false,code:'V505_PURGE_EXECUTE_ACTIVE_CHALLENGE_MISMATCH',error:'已有受保护清空任务使用另一份验证凭证。系统不会并发启动第二个删除任务。'};
    }
    if(status==='SUCCEEDED'&&existingChallenge===challengeId){
      return {ok:true,recovery:true,status,jobId,challengeId,sealedDatabasePath:existingSealedDatabasePath};
    }
    // A terminal SUCCEEDED/FAILED job for an older challenge is not an active
    // owner unless SQLite has an exact durable unfinalized receipt. A finalized
    // SUCCEEDED receipt from an older generation is historical and may yield to
    // a newly completed PREPARE after all new PREPARE evidence validates below.
  }else if(durableReceipt&&!receiptIsFinalized(durableReceipt)){
    return {ok:false,code:'V505_PURGE_COMMIT_RECEIPT_PENDING_RECOVERY',error:'检测到SQLite已提交但尚未最终完成的清空凭证，同时后台任务状态文件不存在。系统不会猜测“未提交”或启动第二次DELETE。'};
  }

  const prepare=readJson(files.prepareJob);
  if(!prepare)return {ok:false,code:'V505_PURGE_EXECUTE_PREPARE_MISSING',error:'未找到已完成的清空前安全备份任务，后台删除不会启动。'};
  if(String(prepare.status||'').toUpperCase()!=='SUCCEEDED'){
    return {ok:false,code:'V505_PURGE_EXECUTE_PREPARE_NOT_SUCCEEDED',error:'清空前安全备份尚未成功完成，后台删除不会启动。',prepareStatus:String(prepare.status||'')};
  }
  const preparedChallenge=String(prepare.payload?.challengeId||'');
  if(!preparedChallenge||preparedChallenge!==challengeId){
    return {ok:false,code:'V505_PURGE_EXECUTE_PREPARE_CHALLENGE_MISMATCH',error:'当前删除请求与已验证安全备份的 challengeId 不一致，后台删除不会启动。'};
  }
  if(!future(prepare.payload?.expiresAt)){
    return {ok:false,code:'V505_PURGE_EXECUTE_PREPARE_EXPIRED',error:'清空前安全备份验证凭证已经过期，请重新创建安全备份。'};
  }

  const persisted=readJson(files.challenge);
  const persistedId=String(persisted?.challengeId||'');
  const challenge=persisted?.challenge;
  if(!persistedId||persistedId!==challengeId||!challenge){
    return {ok:false,code:'V505_PURGE_EXECUTE_PERSISTED_CHALLENGE_MISMATCH',error:'持久化清空凭证与已验证备份不一致，后台删除不会启动。'};
  }
  if(!future(Number(challenge.expiresAt||0))){
    return {ok:false,code:'V505_PURGE_EXECUTE_PERSISTED_CHALLENGE_EXPIRED',error:'持久化清空凭证已经过期，请重新创建安全备份。'};
  }

  const prepareDatabasePath=String(prepare.payload?.databasePath||'').trim();
  const persistedDatabasePath=String(persisted?.payload?.databasePath||'').trim();
  const manifestPath=String(challenge?.backup?.manifestPath||'').trim();
  if(!prepareDatabasePath||!persistedDatabasePath||!manifestPath){
    return {ok:false,code:'V505_PURGE_EXECUTE_SEALED_DB_EVIDENCE_INCOMPLETE',error:'安全备份验证证据缺少数据库路径或 backup manifest，后台删除不会启动。'};
  }
  const manifest=readJson(manifestPath);
  const manifestDatabasePath=String(manifest?.databasePath||'').trim();
  if(!manifestDatabasePath||!sameFilePath(prepareDatabasePath,persistedDatabasePath)||!sameFilePath(prepareDatabasePath,manifestDatabasePath)){
    return {ok:false,code:'V505_PURGE_EXECUTE_SEALED_DB_PATH_MISMATCH',error:'PREPARE、持久化 challenge 与 backup manifest 记录的数据库路径不一致，后台删除不会启动。'};
  }
  const runtimeDatabasePath=String(getRuntimeConfig().dbFile||'').trim();
  if(!sameFilePath(runtimeDatabasePath,prepareDatabasePath)){
    return {ok:false,code:'V505_PURGE_EXECUTE_SEALED_DB_PATH_CHANGED',error:'当前运行时数据库路径已不同于安全备份封存路径。系统不会对 fallback 或其他数据库启动删除。'};
  }

  const backup=challenge.backup||{};
  if(!String(backup.filePath||'')||!String(backup.sha256||'')||Number(backup.size||0)<=0||!challenge.sourceFingerprint){
    return {ok:false,code:'V505_PURGE_EXECUTE_PREPARED_EVIDENCE_INCOMPLETE',error:'已验证备份凭证缺少完整备份或源数据库指纹证据，后台删除不会启动。'};
  }
  return {ok:true,recovery:false,challengeId,prepareJobId:String(prepare.jobId||''),sealedDatabasePath:prepareDatabasePath};
}

export function v505PurgeExecuteAdmissionGuard(req,res,next){
  const result=inspectPurgeExecuteAdmission(req.user||{},req.body||{});
  req.v505PurgeExecuteAdmission=result;
  if(result.ok)return next();
  return fail(res,result.code,result.error,{prepareStatus:result.prepareStatus||''});
}
