import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DEFAULT_DB='D:\\CE CCSL金边数据库\\ce_qc_monitor.db';
const dbFile=path.isAbsolute(String(process.env.DB_FILE||''))
  ? path.normalize(String(process.env.DB_FILE))
  : path.resolve(root,String(process.env.DB_FILE||DEFAULT_DB));

function out(text=''){process.stdout.write(String(text).endsWith('\n')?String(text):`${text}\n`);}
function run(label,args,timeoutMs=120000){
  out(`\n[V238] ${label}`);
  const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',env:process.env,windowsHide:true,timeout:timeoutMs});
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`${label} failed exit=${result.status}`);
  return `${result.stdout||''}\n${result.stderr||''}`;
}
function tableExists(db,name){
  try{return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}
  catch{return false;}
}
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
    for(const [table,sql] of probes){
      if(!tableExists(db,table))continue;
      try{const value=String(db.prepare(sql).get()?.value||'');if(/^\d{4}-\d{2}-\d{2}$/.test(value))dates.push(value);}catch{}
    }
    return dates.sort().at(-1)||'';
  }finally{try{db.close();}catch{}}
}

if(!fs.existsSync(dbFile)){
  out(`[V238] local production audit skipped: production database is not present in this environment (${dbFile}).`);
  out('CE_QC_V238_LOCAL_PRODUCTION_READONLY=SKIPPED_NO_LOCAL_DB');
  process.exit(0);
}

const before=fs.statSync(dbFile);
let blocked=false;
try{
  const reportDate=latestDate();
  if(!reportDate)throw new Error('persisted production database has no recoverable report date');
  out(`[V238] production DB=${dbFile}`);
  out(`[V238] latest persisted reportDate=${reportDate}`);

  const firstDay=run('latest-date source -> normalized -> current-state parity', ['scripts/CE_QC_First_Day_GoLive_Verify_ReadOnly.mjs',reportDate], 120000);
  if(!/GO_LIVE_RESULT:\s*READY/.test(firstDay)||!/DATABASE MODIFIED:\s*NO/.test(firstDay))throw new Error('first-day read-only audit did not return READY + DATABASE MODIFIED:NO');

  const snapshots=run('all seven business snapshot parity + bounded query speed', ['scripts/CE_QC_Business_Snapshot_Audit_ReadOnly.mjs',reportDate,'ALL'], 120000);
  if(!/RESULT:\s*READY/.test(snapshots)||!/DATABASE MODIFIED:\s*NO/.test(snapshots))throw new Error('seven-business read-only audit did not return READY + DATABASE MODIFIED:NO');

  const whpp=run('WHPP terminal authority contradictions', ['scripts/CE_QC_WHPP_Terminal_Authority_Audit_ReadOnly.mjs'], 120000);
  if(!/RESULT:\s*READY/.test(whpp))throw new Error('WHPP terminal authority audit did not return READY');

  const after=fs.statSync(dbFile);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error('production SQLite size/mtime changed during read-only acceptance');

  out(`CE_QC_V238_LATEST_DATE=${reportDate}`);
  out('CE_QC_V238_SOURCE_NORMALIZED_CURRENT=PASS');
  out('CE_QC_V238_SEVEN_BUSINESS_SNAPSHOT=PASS');
  out('CE_QC_V238_WHPP_TERMINAL_AUTHORITY=PASS');
  out('CE_QC_V238_DATABASE_UNCHANGED=PASS');
  out('CE_QC_V238_LOCAL_PRODUCTION_READONLY=PASS');
}catch(error){
  blocked=true;
  console.error(`CE_QC_V238_LOCAL_PRODUCTION_READONLY=BLOCKED ${error?.message||error}`);
}
process.exitCode=blocked?10:0;
