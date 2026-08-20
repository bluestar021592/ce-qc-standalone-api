import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { getRuntimeConfig } from '../src/db.js';

const REQUIRED_TYPES=Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);
const cfg=getRuntimeConfig();
const file=cfg.dbFile;

if(!fs.existsSync(file)){
  console.log(`[V233] seven-board local truth skipped: database file not present in this environment (${file}).`);
  process.exit(0);
}

const before=fs.statSync(file);
const db=new DatabaseSync(file,{readOnly:true});
let failed=false;

function n(value){const parsed=Number(value||0);return Number.isFinite(parsed)?parsed:0;}
function exists(name){
  try{return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}
  catch{return false;}
}
function columns(name){
  if(!exists(name))return new Set();
  try{return new Set(db.prepare(`PRAGMA table_info(${name})`).all().map(row=>String(row.name||'')));}
  catch{return new Set();}
}
function scalar(sql,params=[],fallback=''){
  try{return db.prepare(sql).get(...params)?.value??fallback;}
  catch{return fallback;}
}
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
    if(!exists(table))continue;
    const value=String(scalar(sql,[],''));
    if(/^\d{4}-\d{2}-\d{2}$/.test(value))candidates.push(value);
  }
  return candidates.sort().at(-1)||'';
}
function emptyCounts(){return Object.fromEntries(REQUIRED_TYPES.map(type=>[type,0]));}
function apply(counts,type,value){
  const key=String(type||'').toUpperCase();
  if(Object.hasOwn(counts,key))counts[key]=Math.max(n(counts[key]),n(value));
}
function exactBusinessSummary(counts,reportDate){
  if(!exists('business_daily_reports'))return;
  try{
    for(const row of db.prepare("SELECT UPPER(COALESCE(businessType,'')) businessType,MAX(COALESCE(totalCount,0)) total FROM business_daily_reports WHERE reportDate=? GROUP BY UPPER(COALESCE(businessType,''))").all(reportDate)) apply(counts,row.businessType,row.total);
  }catch{}
}
function dashboardCache(counts,reportDate){
  if(!exists('dashboard_daily_cache'))return;
  try{
    for(const row of db.prepare("SELECT UPPER(COALESCE(businessType,'')) businessType,COALESCE(SUM(CAST(json_extract(metricsJson,'$.total') AS REAL)),0) total FROM dashboard_daily_cache WHERE reportDate=? GROUP BY UPPER(COALESCE(businessType,''))").all(reportDate)) apply(counts,row.businessType,row.total);
  }catch{}
}
function canonicalRows(counts,reportDate){
  if(!exists('unified_import_batches')||!exists('unified_import_rows'))return;
  try{
    const batch=db.prepare("SELECT snapshotId FROM unified_import_batches WHERE UPPER(COALESCE(status,'VALID'))='VALID' AND reportDate=? ORDER BY createdAt DESC LIMIT 1").get(reportDate);
    if(!batch?.snapshotId)return;
    const cols=columns('unified_import_rows');
    if(cols.has('businessType')){
      for(const row of db.prepare("SELECT UPPER(COALESCE(businessType,'')) businessType,COUNT(DISTINCT shipmentCode) total FROM unified_import_rows WHERE snapshotId=? GROUP BY UPPER(COALESCE(businessType,''))").all(batch.snapshotId)) apply(counts,row.businessType,row.total);
      if(cols.has('recipient_group')){
        const sql="SELECT UPPER(COALESCE(recipient_group,'')) recipientGroup,COUNT(DISTINCT shipmentCode) total FROM unified_import_rows WHERE snapshotId=? AND UPPER(COALESCE(businessType,''))='SHOPEE' GROUP BY UPPER(COALESCE(recipient_group,''))";
        for(const row of db.prepare(sql).all(batch.snapshotId)){
          if(row.recipientGroup==='CN')apply(counts,'SHOPEECN',row.total);
          if(row.recipientGroup==='VN')apply(counts,'SHOPEEVN',row.total);
        }
      }
    }
  }catch{}
}
function finalRows(counts,reportDate){
  if(exists('final_rows')){
    try{
      for(const row of db.prepare("SELECT UPPER(COALESCE(sourceType,'')) businessType,COUNT(DISTINCT shipmentCode) total FROM final_rows WHERE reportDate=? GROUP BY UPPER(COALESCE(sourceType,''))").all(reportDate)) apply(counts,row.businessType,row.total);
    }catch{}
  }
  if(exists('business_final_rows')){
    try{
      const cols=columns('business_final_rows');
      for(const row of db.prepare("SELECT UPPER(COALESCE(businessType,'')) businessType,COUNT(DISTINCT shipmentCode) total FROM business_final_rows WHERE reportDate=? GROUP BY UPPER(COALESCE(businessType,''))").all(reportDate)) apply(counts,row.businessType,row.total);
      if(cols.has('recipient_group')){
        const sql="SELECT UPPER(COALESCE(recipient_group,'')) recipientGroup,COUNT(DISTINCT shipmentCode) total FROM business_final_rows WHERE reportDate=? AND UPPER(COALESCE(businessType,''))='SHOPEE' GROUP BY UPPER(COALESCE(recipient_group,''))";
        for(const row of db.prepare(sql).all(reportDate)){
          if(row.recipientGroup==='CN')apply(counts,'SHOPEECN',row.total);
          if(row.recipientGroup==='VN')apply(counts,'SHOPEEVN',row.total);
        }
      }
    }catch{}
  }
}
function parseRows(counts,reportDate){
  if(!exists('business_daily_parse_rows'))return;
  try{
    const cols=columns('business_daily_parse_rows');
    if(!cols.has('businessType')||!cols.has('shipmentCode'))return;
    for(const row of db.prepare("SELECT UPPER(COALESCE(businessType,'')) businessType,COUNT(DISTINCT shipmentCode) total FROM business_daily_parse_rows WHERE reportDate=? GROUP BY UPPER(COALESCE(businessType,''))").all(reportDate)) apply(counts,row.businessType,row.total);
    if(cols.has('recipient_group')){
      const sql="SELECT UPPER(COALESCE(recipient_group,'')) recipientGroup,COUNT(DISTINCT shipmentCode) total FROM business_daily_parse_rows WHERE reportDate=? AND UPPER(COALESCE(businessType,''))='SHOPEE' GROUP BY UPPER(COALESCE(recipient_group,''))";
      for(const row of db.prepare(sql).all(reportDate)){
        if(row.recipientGroup==='CN')apply(counts,'SHOPEECN',row.total);
        if(row.recipientGroup==='VN')apply(counts,'SHOPEEVN',row.total);
      }
    }
  }catch{}
}

try{
  db.exec('PRAGMA query_only=ON');
  db.exec('PRAGMA busy_timeout=1200');
  const reportDate=latestDate();
  if(!reportDate){
    const sizeMb=before.size/1024/1024;
    if(sizeMb>100)throw new Error(`large persisted database (${sizeMb.toFixed(1)} MB) has no recoverable latest report date`);
    console.log(`[V233] seven-board local truth: EMPTY_INSTALL file=${file}`);
  }else{
    const counts=emptyCounts();
    exactBusinessSummary(counts,reportDate);
    dashboardCache(counts,reportDate);
    canonicalRows(counts,reportDate);
    finalRows(counts,reportDate);
    parseRows(counts,reportDate);
    const zero=REQUIRED_TYPES.filter(type=>n(counts[type])<=0);
    const total=Object.values(counts).reduce((sum,value)=>sum+n(value),0);
    const detail=REQUIRED_TYPES.map(type=>`${type}=${n(counts[type])}`).join(' ');
    console.log(`[V233] latest persisted reportDate=${reportDate} ${detail} total=${total}`);
    if(zero.length)throw new Error(`latest persisted date ${reportDate} is missing/zero for: ${zero.join(', ')}`);
    console.log(`CE_QC_V233_LATEST_DATE=${reportDate}`);
    console.log('CE_QC_V233_SEVEN_BOARD_TRUTH=PASS_READ_ONLY');
  }
}catch(error){
  failed=true;
  console.error(`CE_QC_V233_SEVEN_BOARD_TRUTH=BLOCKED ${error?.message||error}`);
}finally{
  try{db.close();}catch{}
}

const after=fs.statSync(file);
if(before.size!==after.size||before.mtimeMs!==after.mtimeMs){
  failed=true;
  console.error('CE_QC_V233_READ_ONLY=BLOCKED database size/mtime changed during truth audit');
}else{
  console.log('CE_QC_V233_READ_ONLY=CONFIRMED');
}
process.exitCode=failed?10:0;
