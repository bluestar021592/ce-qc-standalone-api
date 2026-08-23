import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v245-'));
process.env.DATA_DIR=tempRoot;
process.env.DB_FILE=path.join(tempRoot,'v245-smoke.db');
process.env.ACCESS_MODE='LOCAL';
process.env.SQLITE_MMAP_BYTES='0';
process.env.SQLITE_CACHE_KIB='8192';

const {getDb,closeDb}=await import('../src/db.js');
const {readV245ShopeeTrends,V245_SHOPEE_TREND_ID}=await import('../src/v244ShopeeTrendRuntimePatch.js');
const db=getDb();

db.exec(`CREATE TABLE IF NOT EXISTS dashboard_daily_cache(
  reportDate TEXT NOT NULL,businessType TEXT NOT NULL,regionCode TEXT NOT NULL DEFAULT '',metricsJson TEXT NOT NULL,
  snapshotId TEXT NOT NULL DEFAULT '',snapshotStatus TEXT NOT NULL DEFAULT '',sourceFingerprint TEXT NOT NULL DEFAULT '',refreshedAt TEXT NOT NULL,
  PRIMARY KEY(reportDate,businessType,regionCode));`);

const fixtures=[
  {date:'2026-08-20',podDates:['2026-08-20','2026-08-21'],oc:1,attempt1:1,attempt2:1,attempt3:0},
  {date:'2026-08-21',podDates:['2026-08-23',null],oc:2,attempt1:0,attempt2:0,attempt3:1},
  {date:'2026-08-22',podDates:[null,null],oc:0,attempt1:0,attempt2:0,attempt3:0},
  {date:'2026-08-23',podDates:['2026-08-23'],oc:0,attempt1:0,attempt2:0,attempt3:0}
];
for(let i=0;i<fixtures.length;i++){
  const f=fixtures[i],date=f.date,snapshotId=`V245-S${i+1}`,batchId=`V245-B${i+1}`,now=`${date}T23:00:00.000Z`;
  db.prepare('INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)').run(snapshotId,batchId,date,'COMPLETED','{}',now);
  db.prepare('INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)').run(batchId,snapshotId,date,'v245-smoke.xlsx',`hash-${i}`,'VALID','{}','[]',now);
  const insertImport=db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertFinal=db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,rawJson,createdAt,updatedAt,podAttemptNo)
    VALUES('SHOPEE',?,?,?,?,?,?,?,?)`);
  for(let j=0;j<f.podDates.length;j++){
    const code=`CN-${i}-${j}`,podDate=f.podDates[j];
    insertImport.run(batchId,snapshotId,date,'SHOPEECN',code,'PP','SHOPEECN','SHOPEECN','日报',j+1,'SMOKE','{}',now);
    insertFinal.run(code,date,podDate?1:0,podDate?'POD':'Pending',JSON.stringify(podDate?{'POD时间':`${podDate} 12:00:00`}:{'Pending次数':1}),now,now,0);
  }
  const podCount=f.podDates.filter(Boolean).length;
  db.prepare('INSERT INTO dashboard_daily_cache(reportDate,businessType,regionCode,metricsJson,snapshotId,snapshotStatus,sourceFingerprint,refreshedAt) VALUES(?,?,?,?,?,?,?,?)')
    .run(date,'SHOPEECN','PP',JSON.stringify({total:f.podDates.length,pod:podCount,ocCurrent:f.oc,attempt1:f.attempt1,attempt2:f.attempt2,attempt3:f.attempt3}),snapshotId,'COMPLETED','V245',now);
}

const dates=fixtures.map(f=>f.date);
const result=readV245ShopeeTrends('SHOPEECN',dates[0],dates.at(-1));
assert.equal(result.readId,V245_SHOPEE_TREND_ID);
assert.deepEqual(result.dates,dates);
assert.deepEqual(result.ticket,[2,2,2,1]);
assert.deepEqual(result.pod,[2,1,0,1]);
assert.deepEqual(result.podRate,[100,50,0,100]);
assert.deepEqual(result.oc,[1,2,0,0]);
assert.deepEqual(result.ocRate,[50,100,0,0]);
assert.deepEqual(result.avgPodDays,[1.5,3,null,1],'average signing days must use inclusive report-date to POD-date days and ignore non-POD rows');
assert.deepEqual(result.attempt1,[1,0,0,0]);
assert.deepEqual(result.attempt2,[1,0,0,0]);
assert.deepEqual(result.attempt3,[0,1,0,0]);
assert.deepEqual(result.attempt1Rate,[50,0,null,null]);
assert.deepEqual(result.attempt2Rate,[50,0,null,null]);
assert.deepEqual(result.attempt3Rate,[0,100,null,null]);
assert.deepEqual(result.attemptUnknown,[0,0,0,1],'POD without validated attempt evidence must stay explicit instead of becoming fake 0% dispatch');
assert.deepEqual(result.attemptCoverageRate,[100,100,null,0]);
assert.equal(result.daily[3].attemptEvidenceComplete,false);
assert.match(result.definitions.attemptRate,/无真实派次证据时显示—/);
const lastSeven=readV245ShopeeTrends('SHOPEECN',dates.at(-1),dates.at(-1));
assert.deepEqual(lastSeven.dates,dates,'single-day dashboard selection must still expose up to seven recent cached report dates');

closeDb();
fs.rmSync(tempRoot,{recursive:true,force:true});
console.log('[V245] SHOPEECN/SHOPEEVN smoke passed: ticket + POD + POD rate + average signing days + OC + real 1/2/3 attempt evidence + unknown POD');
