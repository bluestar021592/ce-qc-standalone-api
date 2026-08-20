import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { getRuntimeConfig } from '../src/db.js';
import {
  V241_TYPES as REQUIRED_TYPES,
  v241TableExists,
  v241ReadLatestValidBatch,
  v241CollectSourceMembership,
  v241ShopeeOverlap
} from './v241-readonly-canonical-membership.mjs';

const cfg=getRuntimeConfig();
const file=cfg.dbFile;
if(!fs.existsSync(file)){
  console.log(`[V233/V242] seven-board local truth skipped: database file not present in this environment (${file}).`);
  process.exit(0);
}

const before=fs.statSync(file);
const db=new DatabaseSync(file,{readOnly:true});
let failed=false;

function latestDate(){
  const candidates=[];
  const probes=[
    ['unified_import_batches',"SELECT COALESCE(MAX(reportDate),'') value FROM unified_import_batches WHERE UPPER(COALESCE(status,'VALID'))='VALID'"],
    ['business_daily_reports',"SELECT COALESCE(MAX(reportDate),'') value FROM business_daily_reports"],
    ['daily_reports',"SELECT COALESCE(MAX(reportDate),'') value FROM daily_reports"],
    ['dashboard_daily_cache',"SELECT COALESCE(MAX(reportDate),'') value FROM dashboard_daily_cache"],
    ['business_final_rows',"SELECT COALESCE(MAX(reportDate),'') value FROM business_final_rows"],
    ['final_rows',"SELECT COALESCE(MAX(reportDate),'') value FROM final_rows"],
    ['business_daily_parse_rows',"SELECT COALESCE(MAX(reportDate),'') value FROM business_daily_parse_rows"]
  ];
  for(const [table,sql] of probes){
    if(!v241TableExists(db,table))continue;
    try{const value=String(db.prepare(sql).get()?.value||'');if(/^\d{4}-\d{2}-\d{2}$/.test(value))candidates.push(value);}catch{}
  }
  return candidates.sort().at(-1)||'';
}

try{
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1200;');
  const reportDate=latestDate();
  if(!reportDate){
    const sizeMb=before.size/1024/1024;
    if(sizeMb>100)throw new Error(`large persisted database (${sizeMb.toFixed(1)} MB) has no recoverable latest report date`);
    console.log(`[V233/V242] seven-board local truth: EMPTY_INSTALL file=${file}`);
  }else{
    const batch=v241ReadLatestValidBatch(db,reportDate);
    const counts={};
    const diagnostics=[];
    for(const type of REQUIRED_TYPES){
      const truth=v241CollectSourceMembership(db,reportDate,type,batch);
      counts[type]=truth.sourceCount;
      diagnostics.push(`${type}=${truth.sourceCount}(mode=${truth.sourceMode},latest=${truth.latestValidSnapshotCount},archive=${truth.archiveUnifiedCount},parse=${truth.businessParseCount},finalFallback=${truth.persistedFinalFallbackCount},declared=${truth.declaredDailyCount??'-'})`);
    }
    const zero=REQUIRED_TYPES.filter(type=>Number(counts[type]||0)<=0);
    const overlap=v241ShopeeOverlap(db,reportDate,batch);
    const total=Object.values(counts).reduce((sum,value)=>sum+Number(value||0),0);
    console.log(`[V233/V242] latest canonical persisted reportDate=${reportDate} ${diagnostics.join(' ')} total=${total}`);
    if(zero.length)throw new Error(`latest persisted date ${reportDate} is missing/zero canonical/persisted source membership for: ${zero.join(', ')}`);
    if(overlap.count)throw new Error(`SHOPEECN/SHOPEEVN canonical source overlap=${overlap.count} sample=${overlap.sample.join(',')}`);
    console.log(`CE_QC_V233_LATEST_DATE=${reportDate}`);
    console.log('CE_QC_V233_SEVEN_BOARD_TRUTH=PASS_READ_ONLY');
    console.log('CE_QC_V242_CANONICAL_MEMBERSHIP=PASS_READ_ONLY');
  }
}catch(error){
  failed=true;
  console.error(`CE_QC_V233_SEVEN_BOARD_TRUTH=BLOCKED ${error?.message||error}`);
}finally{try{db.close();}catch{}}

const after=fs.statSync(file);
if(before.size!==after.size||before.mtimeMs!==after.mtimeMs){
  failed=true;
  console.error('CE_QC_V233_READ_ONLY=BLOCKED database size/mtime changed during truth audit');
}else console.log('CE_QC_V233_READ_ONLY=CONFIRMED');
process.exitCode=failed?10:0;
