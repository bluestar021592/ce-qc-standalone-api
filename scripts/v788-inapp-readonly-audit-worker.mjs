// V788: on-demand ADMIN-only isolated SQLite acceptance on a worker thread.
// No CE TMS, downloads, generated reports, production database, or writes.
import fs from 'node:fs';
import {parentPort} from 'node:worker_threads';
import {auditDatabaseFile} from './v788-whpp-real-readonly-audit.mjs';
import {buildV788AcceptanceVerdict} from './v788-real-acceptance-verdict.mjs';
import {DEFAULT_COPY,validateIsolatedCopy} from './v788-run-isolated-readonly-acceptance.mjs';

function fingerprint(file){
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<=0)
    throw Error('ISOLATED_SOURCE_UNSAFE');
  if(fs.realpathSync.native(file).toLowerCase()!==file.toLowerCase())
    throw Error('ISOLATED_SOURCE_REDIRECTED');
  return [stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join('|');
}
function run(){
  if(process.platform!=='win32')throw Error('WINDOWS_ISOLATION_REQUIRED');
  const file=validateIsolatedCopy(DEFAULT_COPY);
  const before=fingerprint(file);
  const audit=auditDatabaseFile(file);
  if(fingerprint(file)!==before)throw Error('ISOLATED_SOURCE_CHANGED_DURING_AUDIT');
  const verdict=buildV788AcceptanceVerdict(audit);
  const totals=audit.whpp.totals;
  // Send only allowlisted aggregate fields, not raw rows, usernames, or paths.
  return {
    ok:true,status:verdict.releaseDecision,readOnly:true,
    readyToPublish:false,readyToClearAndReimport:false,
    productionModified:false,sourceCopyModified:false,
    counts:verdict.counts,
    members:Number(totals.sourceMembers||0),
    normalizedPOD:Number(totals.normalizedPOD||0),
    normalizedReturned:Number(totals.normalizedReturned||0),
    ledgerOpenWithNormalizedTerminal:Number(totals.ledgerOpenWithNormalizedTerminal||0),
    trustedPodLockOnPOD:Number(totals.trustedPodLockOnPOD||0),
    gates:verdict.gates.map(g=>({id:g.id,status:g.status,detail:g.detail}))
  };
}
try{
  parentPort?.postMessage(run());
}catch{
  // Fail closed; never send exception text or internal database locations.
  parentPort?.postMessage({
    ok:false,status:'BLOCKED',code:'ISOLATED_AUDIT_UNAVAILABLE',
    readOnly:true,readyToPublish:false,productionModified:false
  });
}
