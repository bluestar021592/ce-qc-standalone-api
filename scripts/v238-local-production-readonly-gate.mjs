import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DEFAULT_DB='D:\\CE CCSL金边数据库\\ce_qc_monitor.db';
const dbFile=path.isAbsolute(String(process.env.DB_FILE||''))?path.normalize(String(process.env.DB_FILE)):path.resolve(root,String(process.env.DB_FILE||DEFAULT_DB));
const out=text=>process.stdout.write(String(text||'').endsWith('\n')?String(text||''):`${text||''}\n`);
function tableExists(db,name){try{return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}catch{return false;}}
function latestDate(){
  const db=new DatabaseSync(dbFile,{readOnly:true});
  try{
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1200;');
    const dates=[];
    const probes=[
      ['unified_import_batches',"SELECT COALESCE(MAX(reportDate),'') value FROM unified_import_batches WHERE UPPER(COALESCE(status,'VALID'))='VALID'"],
      ['business_daily_reports',"SELECT COALESCE(MAX(reportDate),'') value FROM business_daily_reports"],
      ['dashboard_daily_cache',"SELECT COALESCE(MAX(reportDate),'') value FROM dashboard_daily_cache"],
      ['business_final_rows',"SELECT COALESCE(MAX(reportDate),'') value FROM business_final_rows"],
      ['final_rows',"SELECT COALESCE(MAX(reportDate),'') value FROM final_rows"]
    ];
    for(const [table,sql] of probes){if(!tableExists(db,table))continue;try{const value=String(db.prepare(sql).get()?.value||'');if(/^\d{4}-\d{2}-\d{2}$/.test(value))dates.push(value);}catch{}}
    return dates.sort().at(-1)||'';
  }finally{try{db.close();}catch{}}
}
function diagnostic(label,args,timeoutMs=120000){
  out(`\n[V246 DATA DIAGNOSTIC] ${label}`);
  const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',env:process.env,windowsHide:true,timeout:timeoutMs});
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  if(result.error){console.warn(`[V246][DATA_WARNING] ${label}: ${result.error.message}`);return false;}
  if(result.status!==0){console.warn(`[V246][DATA_WARNING] ${label}: exit=${result.status}. Existing business data may be cleared/re-imported; software installation is not blocked.`);return false;}
  return true;
}

if(!fs.existsSync(dbFile)){
  out(`[V246] local production data audit skipped: database is not present (${dbFile}).`);
  out('CE_QC_V238_LOCAL_PRODUCTION_READONLY=SKIPPED_NO_LOCAL_DB');
  process.exit(0);
}

const before=fs.statSync(dbFile);
try{
  // Prove the database itself can be opened strictly read-only. This is the only
  // hard requirement here. Operational business-data completeness is disposable
  // and must not make login/settings/WHPP or a software update unavailable.
  const probe=new DatabaseSync(dbFile,{readOnly:true});
  try{probe.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1200;');probe.prepare('SELECT 1 ok').get();}finally{probe.close();}
  const reportDate=latestDate();
  if(!reportDate){
    out('[V246] existing business data: EMPTY; clean system is valid and ready for fresh report import.');
    out('CE_QC_V246_EXISTING_DATA_AUDIT=EMPTY_BUSINESS_DATA');
  }else{
    out(`[V246] production DB=${dbFile}`);
    out(`[V246] latest persisted reportDate=${reportDate}`);
    const a=diagnostic('canonical source / normalized / current audit',['scripts/CE_QC_First_Day_GoLive_Verify_ReadOnly.mjs',reportDate]);
    const b=diagnostic('seven-business snapshot audit',['scripts/CE_QC_Business_Snapshot_Audit_ReadOnly.mjs',reportDate,'ALL']);
    const c=diagnostic('WHPP terminal authority audit',['scripts/CE_QC_WHPP_Terminal_Authority_Audit_ReadOnly.mjs']);
    out(`CE_QC_V246_EXISTING_DATA_AUDIT=${a&&b&&c?'READY':'WARNING_REIMPORT_ALLOWED'}`);
  }
  const after=fs.statSync(dbFile);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error('production SQLite size/mtime changed during read-only data audit');
  out('CE_QC_V238_DATABASE_UNCHANGED=PASS');
  out('CE_QC_V238_LOCAL_PRODUCTION_READONLY=PASS');
}catch(error){
  console.error(`CE_QC_V238_LOCAL_PRODUCTION_READONLY=BLOCKED_DATABASE_READ_ERROR ${error?.message||error}`);
  process.exitCode=10;
}
