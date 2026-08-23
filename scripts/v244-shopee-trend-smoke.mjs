import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v244-'));
process.env.DATA_DIR=tempRoot;
process.env.DB_FILE=path.join(tempRoot,'v244-smoke.db');
process.env.ACCESS_MODE='LOCAL';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';

const {getDb,closeDb}=await import('../src/db.js');
const {readV244ShopeeTrends,V244_SHOPEE_TREND_ID}=await import('../src/v244ShopeeTrendRuntimePatch.js');
const db=getDb();

db.exec(`CREATE TABLE IF NOT EXISTS dashboard_daily_cache(
  reportDate TEXT NOT NULL,businessType TEXT NOT NULL,regionCode TEXT NOT NULL DEFAULT '',metricsJson TEXT NOT NULL,
  snapshotId TEXT NOT NULL DEFAULT '',snapshotStatus TEXT NOT NULL DEFAULT '',sourceFingerprint TEXT NOT NULL DEFAULT '',refreshedAt TEXT NOT NULL,
  PRIMARY KEY(reportDate,businessType,regionCode));`);

const dates=['2026-08-20','2026-08-21','2026-08-22'];
const podDates=[['2026-08-20','2026-08-21'],['2026-08-23',null],[null,null]];
const oc=[1,2,0];
for(let i=0;i<dates.length;i++){
  const date=dates[i],snapshotId=`V244-S${i+1}`,batchId=`V244-B${i+1}`,now=`${date}T23:00:00.000Z`;
  db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)').run(snapshotId,batchId,date,'COMPLETED','{}',now);
  db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)').run(batchId,snapshotId,date,'v244-smoke.xlsx',`hash-${i}`,'VALID','{}','[]',now);
  const insertImport=db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for(let j=0;j<2;j++)insertImport.run(batchId,snapshotId,date,'SHOPEECN',`CN-${i}-${j}`,'PP','SHOPEECN','SHOPEECN','日报',j+1,'SMOKE','{}',now);
  const insertFinal=db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,rawJson,createdAt,updatedAt,podAttemptNo)
    VALUES('SHOPEE',?,?,?,?,?,?,?,?)`);
  for(let j=0;j<2;j++){
    const podDate=podDates[i][j];
    insertFinal.run(`CN-${i}-${j}`,date,podDate?1:0,podDate?'POD':'Pending',JSON.stringify(podDate?{'POD时间':`${podDate} 12:00:00`}:{'Pending次数':1}),now,now,podDate?1:0);
  }
  const podCount=podDates[i].filter(Boolean).length;
  db.prepare('INSERT INTO dashboard_daily_cache(reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?,?,?,?)')
    .run(date,'SHOPEECN','PP',JSON.stringify({total:2,pod:podCount,ocCurrent:oc[i]}),snapshotId,'COMPLETED','V244',now);
}

const result=readV244ShopeeTrends('SHOPEECN',dates[0],dates[2]);
assert.equal(result.readId,V244_SHOPEE_TREND_ID);
assert.deepEqual(result.dates,dates);
assert.deepEqual(result.ticket,[2,2,2]);
assert.deepEqual(result.pod,[2,1,0]);
assert.deepEqual(result.oc,oc);
assert.deepEqual(result.avgPodDays,[1.5,3,null],'average signing days must use inclusive report-date to POD-date days and ignore non-POD rows');
const lastSeven=readV244ShopeeTrends('SHOPEECN',dates[2],dates[2]);
assert.deepEqual(lastSeven.dates,dates,'single-day dashboard selection must still expose up to seven recent cached report dates');

closeDb();
fs.rmSync(tempRoot,{recursive:true,force:true});
console.log('[V244] SHOPEECN/SHOPEEVN operational trend smoke passed: ticket + POD + average signing days + OC');
