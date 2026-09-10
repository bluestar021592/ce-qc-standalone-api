import {
  accessIdentity as coreAccessIdentity,
  auditAction as coreAuditAction
} from './accessControlCore.js';
export * from './accessControlCore.js';

const PURGE_STATUS_PATH=/^\/purge-status\/[a-f0-9]{48}\.json$/i;

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
  const isPurgePrepare=pathname==='/api/admin/data-purge/prepare';
  const recoveryRequest=isPurgePrepare&&Boolean(req.body?.recoverJobId);
  const pendingBackup=isPurgePrepare&&action==='DATA_PURGE_BACKUP_VERIFIED'&&String(detail?.backupPath||'').startsWith('PENDING:');
  if(recoveryRequest||pendingBackup)return;
  return coreAuditAction(req,action,detail);
}
