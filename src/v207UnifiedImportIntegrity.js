import { getDb, nowIso } from './db.js';
import { BUSINESS_DATA_TABLES } from './store.js';

export const V207_IMPORT_INTEGRITY_VERSION='2026-08-19-v207-seven-business-clean-rebaseline-no-loss-v2';
export const V207_TYPES=Object.freeze(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']);

function safeJson(value,fallback={}){if(value&&typeof value==='object')return value;try{return JSON.parse(String(value||''))||fallback;}catch{return fallback;}}
function billOf(value=''){return String(value||'').trim().toUpperCase();}
function typeOf(value=''){return String(value||'').trim().toUpperCase();}
function countByType(rows=[]){return Object.fromEntries(V207_TYPES.map(type=>[type,rows.filter(row=>typeOf(row.businessType)===type).length]));}
function sumCounts(counts={}){return V207_TYPES.reduce((sum,type)=>sum+Number(counts[type]||0),0);}

export function ensureV207ImportIntegritySchema(){
  const db=getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS v207_daily_ownership (
      reportDate TEXT NOT NULL,
      shipmentCode TEXT NOT NULL,
      businessType TEXT NOT NULL,
      regionCode TEXT,
      sourceName TEXT,
      sourceFileHash TEXT,
      sourceBatchId TEXT,
      sourceSnapshotId TEXT,
      rowJson TEXT NOT NULL,
      firstSeenAt TEXT NOT NULL,
      lastSeenAt TEXT NOT NULL,
      lastSeenUploadAt TEXT NOT NULL,
      seenUploadCount INTEGER NOT NULL DEFAULT 1,
      recoveredFromPrior INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(reportDate,shipmentCode)
    );
    CREATE INDEX IF NOT EXISTS idx_v207_ownership_type_date ON v207_daily_ownership(businessType,reportDate,shipmentCode);
    CREATE INDEX IF NOT EXISTS idx_v207_ownership_last_seen ON v207_daily_ownership(reportDate,lastSeenUploadAt,shipmentCode);
  `);
  if(!BUSINESS_DATA_TABLES.includes('v207_daily_ownership'))BUSINESS_DATA_TABLES.push('v207_daily_ownership');
  return true;
}

// Legacy seeding is intentionally explicit-only. During the user's clean historical
// rebuild, the FIRST V207 upload for a date becomes that date's authoritative baseline.
// Old V205/V206 history remains readable for dates not rebuilt yet, but it is never
// silently copied into the new no-loss ledger because that could reintroduce old ghost
// membership or old misclassification into the clean rebuild.
export function seedV207OwnershipForDate(){return{seeded:false,reason:'LEGACY_AUTO_SEED_DISABLED_CLEAN_REBASELINE'};}

export function inspectV207BeforeUpload(parsed={}){
  ensureV207ImportIntegritySchema();
  const reportDate=String(parsed.reportDate||'').slice(0,10);
  if(!reportDate)throw new Error('V207完整性检查缺少日报日期。');
  const rows=Array.isArray(parsed.rows)?parsed.rows:[];
  const currentBills=new Set(rows.map(row=>billOf(row.shipmentCode)).filter(Boolean));
  if(currentBills.size!==rows.length){const error=new Error(`V207导入前守恒失败：解析${rows.length}行，但唯一运单${currentBills.size}票。`);error.code='V207_PARSED_DUPLICATE';throw error;}
  const counts=countByType(rows);
  if(sumCounts(counts)!==rows.length){const error=new Error(`V207七业务守恒失败：唯一运单${rows.length}票，板块合计${sumCounts(counts)}票。`);error.code='V207_BUSINESS_RECONCILIATION';throw error;}
  const prior=getDb().prepare('SELECT shipmentCode,businessType,regionCode,rowJson FROM v207_daily_ownership WHERE reportDate=? ORDER BY shipmentCode').all(reportDate);
  const priorByBill=new Map(prior.map(row=>[billOf(row.shipmentCode),row]));
  const missingFromUpload=prior.filter(row=>!currentBills.has(billOf(row.shipmentCode)));
  const reclassified=[];
  for(const row of rows){const previous=priorByBill.get(billOf(row.shipmentCode));if(previous&&typeOf(previous.businessType)!==typeOf(row.businessType))reclassified.push({shipmentCode:billOf(row.shipmentCode),from:typeOf(previous.businessType),to:typeOf(row.businessType)});}
  return{
    version:V207_IMPORT_INTEGRITY_VERSION,
    reportDate,
    firstCleanBaseline:prior.length===0,
    uploadUnique:rows.length,
    uploadCounts:counts,
    priorCanonical:prior.length,
    missingFromUploadCount:missingFromUpload.length,
    missingFromUploadSamples:missingFromUpload.slice(0,30).map(row=>({shipmentCode:billOf(row.shipmentCode),businessType:typeOf(row.businessType)})),
    reclassifiedCount:reclassified.length,
    reclassifiedSamples:reclassified.slice(0,30),
    uploadContainsAllPreviouslyKnown:missingFromUpload.length===0
  };
}

export function commitV207Ownership(parsed={},meta={}){
  ensureV207ImportIntegritySchema();
  const db=getDb(),reportDate=String(parsed.reportDate||'').slice(0,10),rows=Array.isArray(parsed.rows)?parsed.rows:[],now=nowIso();
  if(!reportDate||!rows.length)throw new Error('V207不能提交空日报底账。');
  const existingRows=db.prepare('SELECT shipmentCode FROM v207_daily_ownership WHERE reportDate=?').all(reportDate);
  const firstCleanBaseline=existingRows.length===0;
  const previous=new Map(existingRows.map(row=>[billOf(row.shipmentCode),true]));
  const upsert=db.prepare(`INSERT INTO v207_daily_ownership(reportDate,shipmentCode,businessType,regionCode,sourceName,sourceFileHash,sourceBatchId,sourceSnapshotId,rowJson,firstSeenAt,lastSeenAt,lastSeenUploadAt,seenUploadCount,recoveredFromPrior)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,0)
    ON CONFLICT(reportDate,shipmentCode) DO UPDATE SET businessType=excluded.businessType,regionCode=excluded.regionCode,sourceName=excluded.sourceName,sourceFileHash=excluded.sourceFileHash,sourceBatchId=excluded.sourceBatchId,sourceSnapshotId=excluded.sourceSnapshotId,rowJson=excluded.rowJson,lastSeenAt=excluded.lastSeenAt,lastSeenUploadAt=excluded.lastSeenUploadAt,seenUploadCount=v207_daily_ownership.seenUploadCount+1,recoveredFromPrior=0`);
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const row of rows){const bill=billOf(row.shipmentCode);upsert.run(reportDate,bill,typeOf(row.businessType),String(row.regionCode||''),String(meta.sourceName||''),String(parsed.fileHash||meta.fileHash||''),String(meta.batchId||''),String(meta.snapshotId||''),JSON.stringify({...row,shipmentCode:bill,reportDate}),now,now,now);previous.delete(bill);}
    if(previous.size){const marks=[...previous.keys()];for(let i=0;i<marks.length;i+=300){const part=marks.slice(i,i+300),q=part.map(()=>'?').join(',');db.prepare(`UPDATE v207_daily_ownership SET recoveredFromPrior=1 WHERE reportDate=? AND shipmentCode IN (${q})`).run(reportDate,...part);}}
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  return{...buildV207DailyIntegrity(reportDate,rows),firstCleanBaseline};
}

export function loadV207CanonicalRowsForDate(reportDate){
  ensureV207ImportIntegritySchema();
  return getDb().prepare('SELECT * FROM v207_daily_ownership WHERE reportDate=? ORDER BY businessType,shipmentCode').all(reportDate).map(record=>{
    const row=safeJson(record.rowJson,{});
    return{...row,shipmentCode:billOf(record.shipmentCode),businessType:typeOf(record.businessType),regionCode:String(record.regionCode||row.regionCode||''),reportDate:record.reportDate,v207RecoveredFromPrior:Boolean(record.recoveredFromPrior),v207SeenUploadCount:Number(record.seenUploadCount||1),v207LastSeenUploadAt:record.lastSeenUploadAt||'',v207OwnershipVersion:V207_IMPORT_INTEGRITY_VERSION};
  });
}

export function loadV207CanonicalRows(type,range={}){
  ensureV207ImportIntegritySchema();
  const from=String(range.from||'').slice(0,10),to=String(range.to||from).slice(0,10),businessType=typeOf(type);
  const params=[];let where='1=1';
  if(from&&to){where+=' AND reportDate BETWEEN ? AND ?';params.push(from,to);}if(businessType){where+=' AND businessType=?';params.push(businessType);}
  const records=getDb().prepare(`SELECT * FROM v207_daily_ownership WHERE ${where} ORDER BY reportDate,lastSeenUploadAt,shipmentCode`).all(...params);
  const byBill=new Map();
  for(const record of records){const bill=billOf(record.shipmentCode),raw=safeJson(record.rowJson,{}),existing=byBill.get(bill);const row={...raw,shipmentCode:bill,businessType:typeOf(record.businessType),regionCode:String(record.regionCode||raw.regionCode||''),reportDate:record.reportDate,v207RecoveredFromPrior:Boolean(record.recoveredFromPrior),v207SeenUploadCount:Number(record.seenUploadCount||1),v207LastSeenUploadAt:record.lastSeenUploadAt||'',v207OwnershipVersion:V207_IMPORT_INTEGRITY_VERSION};if(!existing){row.firstReportDate=row.firstReportDate||record.reportDate;row.lastReportDate=row.lastReportDate||record.reportDate;byBill.set(bill,row);continue;}const first=String(existing.firstReportDate||existing.reportDate||record.reportDate),last=String(existing.lastReportDate||existing.reportDate||record.reportDate);const firstReportDate=first<record.reportDate?first:record.reportDate,lastReportDate=last>record.reportDate?last:record.reportDate;byBill.set(bill,{...existing,...row,firstReportDate,lastReportDate});}
  return[...byBill.values()];
}

export function buildV207DailyIntegrity(reportDate,currentUploadRows=[]){
  const canonical=loadV207CanonicalRowsForDate(reportDate),currentSet=new Set(currentUploadRows.map(row=>billOf(row.shipmentCode)).filter(Boolean)),canonicalCounts=countByType(canonical),uploadCounts=countByType(currentUploadRows),recovered=canonical.filter(row=>!currentSet.has(billOf(row.shipmentCode)));
  return{
    version:V207_IMPORT_INTEGRITY_VERSION,
    reportDate,
    uploadUnique:currentUploadRows.length,
    canonicalUnique:canonical.length,
    uploadCounts,
    canonicalCounts,
    recoveredFromEarlierUpload:recovered.length,
    recoveredCounts:countByType(recovered),
    recoveredSamples:recovered.slice(0,50).map(row=>({shipmentCode:billOf(row.shipmentCode),businessType:typeOf(row.businessType)})),
    completeReupload:recovered.length===0,
    reconciliation:{canonicalSum:sumCounts(canonicalCounts),canonicalUnique:canonical.length,balanced:sumCounts(canonicalCounts)===canonical.length}
  };
}

export function assertV207RuntimeMembership({reportDate,ccslRows=[],shopeeRows=[],whppRows=[]}){
  const canonical=loadV207CanonicalRowsForDate(reportDate),expected=countByType(canonical),actual={CE:0,CEAF:0,TBKH:0,ALI1688:0,SHOPEECN:0,SHOPEEVN:0,WHPP:0};
  for(const row of ccslRows)if(Object.prototype.hasOwnProperty.call(actual,typeOf(row.businessType)))actual[typeOf(row.businessType)]++;
  for(const row of shopeeRows)if(Object.prototype.hasOwnProperty.call(actual,typeOf(row.businessType)))actual[typeOf(row.businessType)]++;
  for(const row of whppRows)actual.WHPP++;
  const checks=V207_TYPES.map(type=>({type,expected:expected[type],actual:actual[type],passed:expected[type]===actual[type]}));
  const all=[...ccslRows,...shopeeRows,...whppRows];
  const duplicateRuntime=all.length!==new Set(all.map(row=>billOf(row.shipmentCode))).size;
  if(duplicateRuntime||checks.some(c=>!c.passed)){const error=new Error(`V207运行时成员对账失败：${checks.filter(c=>!c.passed).map(c=>`${c.type} ${c.actual}/${c.expected}`).join('，')||'存在重复运单'}`);error.code='V207_RUNTIME_MEMBERSHIP_MISMATCH';error.checks=checks;throw error;}
  return{version:V207_IMPORT_INTEGRITY_VERSION,reportDate,checks,total:canonical.length,balanced:true};
}

ensureV207ImportIntegritySchema();
