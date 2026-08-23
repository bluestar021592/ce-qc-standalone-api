import fs from 'fs';
import path from 'path';
import { getRuntimeConfig } from './db.js';

export const V256_R2_ZERO_COST_GUARD_ID='2026-08-23-v256-r2-zero-cost-guard-v1';
const GIB=1024*1024*1024;
const R2_FREE_STANDARD_BYTES=10*GIB;
const DEFAULT_SAFE_STORAGE_BYTES=8*GIB;
const DEFAULT_SAFE_CLASS_A_OPS=800_000;
const DEFAULT_SAFE_CLASS_B_OPS=8_000_000;

function finiteInt(value,fallback){const n=Number(value);return Number.isFinite(n)&&n>=0?Math.floor(n):fallback;}
function clampSafeStorage(value){return Math.min(finiteInt(value,DEFAULT_SAFE_STORAGE_BYTES),DEFAULT_SAFE_STORAGE_BYTES);}
function boolEnv(name){return /^(?:1|true|yes|on)$/i.test(String(process.env[name]||''));}

export function getR2ZeroCostConfig(){
  const requested=boolEnv('CE_QC_R2_ENABLED');
  const bucket=String(process.env.CE_QC_R2_BUCKET||'').trim();
  const accountId=String(process.env.CE_QC_R2_ACCOUNT_ID||'').trim();
  const accessKeyId=String(process.env.CE_QC_R2_ACCESS_KEY_ID||'').trim();
  const secretAccessKey=String(process.env.CE_QC_R2_SECRET_ACCESS_KEY||'').trim();
  const credentialsReady=Boolean(bucket&&accountId&&accessKeyId&&secretAccessKey);
  return{
    guardId:V256_R2_ZERO_COST_GUARD_ID,
    requested,
    enabled:requested&&credentialsReady,
    credentialsReady,
    bucket:bucket||null,
    storageClass:'STANDARD',
    safeStorageBytes:clampSafeStorage(process.env.CE_QC_R2_SAFE_STORAGE_BYTES),
    freeTierReferenceBytes:R2_FREE_STANDARD_BYTES,
    safeClassAOps:Math.min(finiteInt(process.env.CE_QC_R2_SAFE_CLASS_A_OPS,DEFAULT_SAFE_CLASS_A_OPS),DEFAULT_SAFE_CLASS_A_OPS),
    safeClassBOps:Math.min(finiteInt(process.env.CE_QC_R2_SAFE_CLASS_B_OPS,DEFAULT_SAFE_CLASS_B_OPS),DEFAULT_SAFE_CLASS_B_OPS),
    zeroCostMode:true,
    secretPresent:Boolean(secretAccessKey),
    note:requested&&!credentialsReady?'R2_REQUESTED_BUT_CREDENTIALS_MISSING_UPLOAD_DISABLED':'ZERO_COST_GUARD_ACTIVE'
  };
}

export function canArchiveToR2({currentStoredBytes=0,objectBytes=0,classAUsed=0,classBUsed=0,storageClass='STANDARD'}={}){
  const cfg=getR2ZeroCostConfig();
  if(!cfg.enabled)return{allowed:false,reason:cfg.requested?'R2_CREDENTIALS_NOT_READY':'R2_DISABLED',config:publicConfig(cfg)};
  if(String(storageClass||'').toUpperCase()!=='STANDARD')return{allowed:false,reason:'ZERO_COST_STANDARD_ONLY',config:publicConfig(cfg)};
  const projectedBytes=Math.max(0,Number(currentStoredBytes)||0)+Math.max(0,Number(objectBytes)||0);
  if(projectedBytes>cfg.safeStorageBytes)return{allowed:false,reason:'ZERO_COST_SAFE_STORAGE_LIMIT',projectedBytes,config:publicConfig(cfg)};
  if((Number(classAUsed)||0)+1>cfg.safeClassAOps)return{allowed:false,reason:'ZERO_COST_CLASS_A_LIMIT',config:publicConfig(cfg)};
  if((Number(classBUsed)||0)>cfg.safeClassBOps)return{allowed:false,reason:'ZERO_COST_CLASS_B_LIMIT',config:publicConfig(cfg)};
  return{allowed:true,reason:'ZERO_COST_GUARD_OK',projectedBytes,config:publicConfig(cfg)};
}

function publicConfig(cfg){
  return{guardId:cfg.guardId,enabled:cfg.enabled,requested:cfg.requested,credentialsReady:cfg.credentialsReady,bucket:cfg.bucket,storageClass:cfg.storageClass,safeStorageBytes:cfg.safeStorageBytes,safeClassAOps:cfg.safeClassAOps,safeClassBOps:cfg.safeClassBOps,zeroCostMode:true,note:cfg.note};
}

function writeStatus(){
  try{
    const cfg=getR2ZeroCostConfig();
    const runtime=getRuntimeConfig();
    const dir=runtime.logsDir||path.join(path.dirname(runtime.dbFile),'logs');
    fs.mkdirSync(dir,{recursive:true});
    const status={...publicConfig(cfg),checkedAt:new Date().toISOString(),uploadPolicy:'NO_UPLOAD_UNLESS_ENABLED_AND_WITHIN_SAFE_LIMITS',manualCloudflareUploadsAreOutsideAppGuard:true};
    fs.writeFileSync(path.join(dir,'r2_zero_cost_guard_latest.json'),JSON.stringify(status,null,2),'utf8');
    console.log('[CE-QC][V256_R2_ZERO_COST]',JSON.stringify(status));
  }catch(error){console.warn('[CE-QC][V256_R2_ZERO_COST] status write skipped:',error?.message||error);}
}

const timer=setTimeout(writeStatus,15_000);timer.unref?.();
