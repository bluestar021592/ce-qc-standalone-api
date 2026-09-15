import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

import { auditSevenBusinessHistoryWithDb, V142_HISTORY_AUDIT_ID } from '../src/v142SevenBusinessHistoryAudit.js';

const PATCH_ID='2026-09-15-v543-history-audit-worker-v1';
const dbFile=String(process.env.CE_QC_HISTORY_AUDIT_DB_FILE||'').trim();
const fromDate=String(process.env.CE_QC_HISTORY_AUDIT_FROM_DATE||'2026-07-01').trim();
const toDate=String(process.env.CE_QC_HISTORY_AUDIT_TO_DATE||'').trim();
let db=null;

function send(payload){
  try{if(typeof process.send==='function')process.send(payload);else process.stdout.write(`${JSON.stringify(payload)}\n`);}catch{}
}

try{
  if(!dbFile)throw new Error('V543_HISTORY_AUDIT_DB_PATH_REQUIRED');
  if(!fs.existsSync(dbFile)||!fs.statSync(dbFile).isFile())throw new Error('V543_HISTORY_AUDIT_DB_MISSING');
  db=new DatabaseSync(dbFile,{readOnly:true});
  db.exec('PRAGMA busy_timeout=5000');
  db.exec('PRAGMA query_only=ON');
  const queryOnly=Number(db.prepare('PRAGMA query_only').get()?.query_only||0);
  if(queryOnly!==1)throw new Error('V543_HISTORY_AUDIT_QUERY_ONLY_NOT_ENFORCED');
  const result=auditSevenBusinessHistoryWithDb(db,{fromDate,toDate});
  send({type:'RESULT',ok:true,patchId:PATCH_ID,auditPatchId:V142_HISTORY_AUDIT_ID,result:{...result,workerIsolation:PATCH_ID,readOnly:true}});
  process.exitCode=0;
}catch(error){
  send({type:'RESULT',ok:false,patchId:PATCH_ID,error:String(error?.message||error)});
  process.exitCode=1;
}finally{
  try{db?.close();}catch{}
}
