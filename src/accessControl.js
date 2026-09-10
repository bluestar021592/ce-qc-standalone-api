import {
  accessIdentity as coreAccessIdentity,
  auditAction as coreAuditAction
} from './accessControlCore.js';
export * from './accessControlCore.js';

const PURGE_STATUS_PATH=/^\/purge-status\/[a-f0-9]{48}\.json$/i;
const PURGE_PREPARE_AUDITS=new Set(['DATA_PURGE_REQUESTED','DATA_PURGE_BACKUP_VERIFIED']);

export async function accessIdentity(req,res,next){
  if(String(req.method||'').toUpperCase()==='GET'&&PURGE_STATUS_PATH.test(String(req.path||''))){
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
    res.setHeader('Pragma','no-cache');
    return next();
  }
  return coreAccessIdentity(req,res,next);
}

export function auditAction(req,action,detail={}){
  const pathname=String(req.path||'');
  if(pathname==='/api/admin/data-purge/prepare'&&PURGE_PREPARE_AUDITS.has(String(action||'')))return;
  return coreAuditAction(req,action,detail);
}
