import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { getRuntimeConfig } from '../src/db.js';

const cfg=getRuntimeConfig();
const file=cfg.dbFile;
if(!fs.existsSync(file)){
  console.log(`[V225] local DB truth smoke skipped: database file not present in this environment (${file}).`);
  process.exit(0);
}

const size=Number(fs.statSync(file).size||0);
const db=new DatabaseSync(file,{readOnly:true});
try{
  db.exec('PRAGMA query_only=ON');
  db.exec('PRAGMA busy_timeout=800');
  const exists=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));
  const scalar=(sql,fallback='')=>{try{return db.prepare(sql).get()?.value??fallback;}catch{return fallback;}};
  const dateCandidates=[];
  if(exists('unified_import_batches')) dateCandidates.push(String(scalar("SELECT COALESCE(MAX(reportDate),'') value FROM unified_import_batches WHERE status='VALID'",'')));
  if(exists('business_daily_reports')) dateCandidates.push(String(scalar("SELECT COALESCE(MAX(reportDate),'') value FROM business_daily_reports",'')));
  if(exists('daily_reports')) dateCandidates.push(String(scalar("SELECT COALESCE(MAX(reportDate),'') value FROM daily_reports",'')));
  if(exists('business_history_summary')) dateCandidates.push(String(scalar("SELECT COALESCE(MAX(reportDate),'') value FROM business_history_summary",'')));
  if(exists('history_summary')) dateCandidates.push(String(scalar("SELECT COALESCE(MAX(reportDate),'') value FROM history_summary",'')));
  if(exists('dashboard_daily_cache')) dateCandidates.push(String(scalar("SELECT COALESCE(MAX(reportDate),'') value FROM dashboard_daily_cache",'')));
  const reportDate=dateCandidates.filter(v=>/^\d{4}-\d{2}-\d{2}$/.test(v)).sort().at(-1)||'';

  let summaryTotal=0;
  if(reportDate&&exists('business_daily_reports')){
    summaryTotal+=Number(scalar(`SELECT COALESCE(SUM(totalCount),0) value FROM business_daily_reports WHERE reportDate='${reportDate.replaceAll("'","''")}'`,0)||0);
  }
  if(reportDate&&exists('daily_reports')){
    summaryTotal+=Number(scalar(`SELECT COALESCE(MAX(totalUniqueCount),0) value FROM daily_reports WHERE reportDate='${reportDate.replaceAll("'","''")}'`,0)||0);
  }
  if(reportDate&&exists('dashboard_daily_cache')){
    summaryTotal+=Number(scalar(`SELECT COALESCE(SUM(CAST(json_extract(metricsJson,'$.total') AS REAL)),0) value FROM dashboard_daily_cache WHERE reportDate='${reportDate.replaceAll("'","''")}'`,0)||0);
  }
  let canonicalRows=0;
  if(reportDate&&exists('unified_import_batches')&&exists('unified_import_rows')){
    try{
      const latest=db.prepare("SELECT snapshotId FROM unified_import_batches WHERE status='VALID' AND reportDate=? ORDER BY createdAt DESC LIMIT 1").get(reportDate);
      if(latest?.snapshotId) canonicalRows=Number(db.prepare('SELECT COUNT(*) count FROM unified_import_rows WHERE snapshotId=?').get(latest.snapshotId)?.count||0);
    }catch{}
  }
  const activeUsers=exists('users')?Number(scalar("SELECT COUNT(*) value FROM users WHERE COALESCE(status,'ACTIVE')='ACTIVE' AND COALESCE(enabled,1)=1",0)||0):0;
  const hasPersistedTables=['business_daily_reports','daily_reports','business_history_summary','history_summary','unified_import_batches','dashboard_daily_cache'].some(exists);
  const hasData=summaryTotal>0||canonicalRows>0;

  if(size>100*1024*1024&&hasPersistedTables&&!reportDate){
    throw new Error(`large persisted database (${(size/1024/1024).toFixed(1)} MB) has no recoverable report date; refusing update`);
  }
  if(reportDate&&!hasData){
    throw new Error(`persisted report date ${reportDate} exists but all lightweight/canonical totals are zero; refusing update`);
  }
  console.log(`[V225] local DB truth smoke passed: file=${file} sizeMB=${(size/1024/1024).toFixed(1)} latest=${reportDate||'EMPTY'} summaryTotal=${summaryTotal} canonicalRows=${canonicalRows} activeUsers=${activeUsers}. Read-only; no reupload and no DB writes.`);
}finally{
  try{db.close();}catch{}
}
