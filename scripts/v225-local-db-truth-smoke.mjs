import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { getRuntimeConfig } from '../src/db.js';

// QC11 final launcher contract: persisted business data is diagnostic only.
// Startup must remain available even when old reports are partial, empty, or
// intentionally cleared for re-import. The only hard requirement here is that
// an existing SQLite file can be opened safely read-only.
const cfg=getRuntimeConfig();
const file=cfg.dbFile;
if(!fs.existsSync(file)){
  console.log(`[V225] local DB truth smoke skipped: database file not present in this environment (${file}).`);
  process.exit(0);
}

const before=fs.statSync(file);
const db=new DatabaseSync(file,{readOnly:true});
try{
  db.exec('PRAGMA query_only=ON');
  db.exec('PRAGMA busy_timeout=800');
  db.prepare('SELECT 1 AS ok').get();
  const exists=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));
  const scalar=(sql,fallback='')=>{try{return db.prepare(sql).get()?.value??fallback;}catch{return fallback;}};
  const dates=[];
  if(exists('unified_import_batches')) dates.push(String(scalar("SELECT COALESCE(MAX(reportDate),'') value FROM unified_import_batches WHERE status='VALID'",'')));
  if(exists('business_daily_reports')) dates.push(String(scalar("SELECT COALESCE(MAX(reportDate),'') value FROM business_daily_reports",'')));
  if(exists('daily_reports')) dates.push(String(scalar("SELECT COALESCE(MAX(reportDate),'') value FROM daily_reports",'')));
  const latest=dates.filter(v=>/^\d{4}-\d{2}-\d{2}$/.test(v)).sort().at(-1)||'';
  const activeUsers=exists('users')?Number(scalar("SELECT COUNT(*) value FROM users WHERE COALESCE(status,'ACTIVE')='ACTIVE' AND COALESCE(enabled,1)=1",0)||0):0;
  console.log(`[V225] local DB truth smoke passed: file=${file} sizeMB=${(before.size/1024/1024).toFixed(1)} latest=${latest||'EMPTY'} activeUsers=${activeUsers}. Read-only diagnostic only; business-data completeness never blocks startup.`);
}finally{
  try{db.close();}catch{}
}
const after=fs.statSync(file);
if(before.size!==after.size||before.mtimeMs!==after.mtimeMs) throw new Error('read-only launcher diagnostic changed the SQLite file');
