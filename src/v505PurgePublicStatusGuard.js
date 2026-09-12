import fs from 'node:fs';
import path from 'node:path';

import { getRuntimeConfig } from './db.js';

export const V505_PURGE_PUBLIC_STATUS_GUARD_ID='2026-09-12-v505-public-status-allowlist-v1';
const STATUS_PATH=/^\/purge-status\/([a-f0-9]{48})\.json$/i;
const SAFE_KEYS=new Set([
  'ok','patchId','recoveryPatch','externalActivityGate','kind','jobId','status',
  'submittedAt','startedAt','heartbeatAt','completedAt','failedAt','heartbeatStale'
]);

function safeMessage(status=''){
  const state=String(status||'').toUpperCase();
  if(state==='FAILED')return '后台任务失败；请重新进入数据管理，由受保护控制接口读取真实任务状态。';
  if(state==='SUCCEEDED')return '后台任务已完成。';
  if(state==='COMMITTED')return '业务数据事务已提交，正在完成可恢复的后置清理。';
  if(state==='QUEUED')return '后台任务已排队。';
  if(state==='RUNNING')return '后台任务正在运行。';
  return '后台任务状态暂时无法确认。';
}

export function sanitizePurgePublicStatus(value={}){
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const clean={};
  for(const key of SAFE_KEYS)if(Object.hasOwn(source,key))clean[key]=source[key];
  clean.ok=source.ok!==false;
  clean.jobId=String(source.jobId||'');
  clean.status=String(source.status||'UNKNOWN').toUpperCase();
  clean.message=safeMessage(clean.status);
  clean.error=clean.status==='FAILED'?'后台任务失败；详细原因仅通过管理员控制接口提供。':'';
  clean.publicStatusGuard=V505_PURGE_PUBLIC_STATUS_GUARD_ID;
  return clean;
}

export function v505PurgePublicStatusGuard(req,res,next){
  const method=String(req.method||'GET').toUpperCase();
  if(!['GET','HEAD'].includes(method))return next();
  const pathname=String(req.originalUrl||req.url||req.path||'').split('?')[0];
  const match=pathname.match(STATUS_PATH);
  if(!match)return next();

  const token=String(match[1]||'').toLowerCase();
  const file=path.join(getRuntimeConfig().projectRoot,'public','purge-status',`${token}.json`);
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  res.setHeader('Pragma','no-cache');
  res.setHeader('X-Content-Type-Options','nosniff');
  let raw;
  try{raw=JSON.parse(fs.readFileSync(file,'utf8'));}
  catch{return res.status(404).json({ok:false,code:'PURGE_STATUS_NOT_FOUND',error:'后台任务状态不存在或已经过期。',publicStatusGuard:V505_PURGE_PUBLIC_STATUS_GUARD_ID});}
  const clean=sanitizePurgePublicStatus(raw);
  if(method==='HEAD')return res.status(200).end();
  return res.status(200).json(clean);
}
