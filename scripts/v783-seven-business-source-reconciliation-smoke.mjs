import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readSelectedDateBusinessSourceTruth} from '../src/v783SevenBusinessSourceTruth.js';

const day='2026-07-01', snap='SNAP-v783-fixture-2026-07-01', batch='BATCH-v783';
const db=new DatabaseSync(':memory:');
const seven={CE:5040,CEAF:74,TBKH:0,ALI1688:529,WHPP:0,SHOPEECN:0,SHOPEEVN:588};
try{
  db.exec(`
    CREATE TABLE unified_import_batches(batchId TEXT,snapshotId TEXT,reportDate TEXT,status TEXT,summaryJson TEXT);
    CREATE TABLE unified_import_rows(batchId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT);
    CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT);
    CREATE INDEX v783_unified_by_batch ON unified_import_rows(batchId);
    CREATE INDEX v783_whpp_by_day ON business_daily_parse_rows(businessType,reportDate);
  `);
  const addBatch=db.prepare('INSERT INTO unified_import_batches VALUES(?,?,?,?,?)');
  const addImport=db.prepare('INSERT INTO unified_import_rows VALUES(?,?,?,?)');
  const addWhpp=db.prepare('INSERT INTO business_daily_parse_rows VALUES(?,?,?)');
  addBatch.run(batch,snap,day,'VALID',JSON.stringify({validUniqueWaybills:6231}));
  db.exec('BEGIN');
  try{
    for(const [type,count] of Object.entries(seven)){
      for(let i=1;i<=count;i++)addImport.run(batch,day,type,type+String(i).padStart(8,'0'));
    }
    for(let i=1;i<=190;i++)addWhpp.run('WHPP',day,'CE010726'+String(i).padStart(5,'0'));
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
  let result=readSelectedDateBusinessSourceTruth(db,{reportDate:day,snapshotId:snap});
  assert.equal(result.source.validUniqueWaybills,6231);
  assert.equal(result.source.classifiedTotal,6231);
  assert.equal(result.source.balanced,true);
  assert.equal(result.whppIndependent.total,190);
  assert.equal(result.whppIndependent.alreadyInImport,0);
  assert.equal(result.whppIndependent.separateNotInImport,190);
  assert.equal(result.whppIndependent.crossBusinessOverlap,0);
  assert.equal(result.display.distinctUnion,6421);
  assert.equal(result.status,'WHPP_SEPARATE_SOURCE_ONLY');

  // Same-day original workbook may already have all 6,421 members in the
  // unified source. The separate WHPP lifecycle must not double-count them.
  for(let i=1;i<=190;i++)addImport.run(batch,day,'WHPP','CE010726'+String(i).padStart(5,'0'));
  db.prepare('UPDATE unified_import_batches SET summaryJson=? WHERE batchId=?')
    .run(JSON.stringify({validUniqueWaybills:6421}),batch);
  result=readSelectedDateBusinessSourceTruth(db,{reportDate:day,snapshotId:snap});
  assert.equal(result.source.classifiedTotal,6421);
  assert.equal(result.whppIndependent.alreadyInImport,190);
  assert.equal(result.whppIndependent.separateNotInImport,0);
  assert.equal(result.display.distinctUnion,6421);
  assert.equal(result.status,'SOURCE_COUNTS_RECONCILED');

  // An old WHPP code incorrectly assigned to CE cannot be "reconciled"
  // by arithmetic alone. The exact member collision must be visible.
  addImport.run(batch,day,'CE','CE01072600191');
  addWhpp.run('WHPP',day,'CE01072600191');
  db.prepare('UPDATE unified_import_batches SET summaryJson=? WHERE batchId=?')
    .run(JSON.stringify({validUniqueWaybills:6422}),batch);
  result=readSelectedDateBusinessSourceTruth(db,{reportDate:day,snapshotId:snap});
  assert.equal(result.whppIndependent.crossBusinessOverlap,1);
  assert.equal(result.status,'WHPP_CROSS_BUSINESS_OVERLAP');
  assert.equal(result.display.hasUnresolvedConflict,true);
  assert.equal(result.display.distinctUnion,6422);

  // Source mismatch is never allowed to pass even if final two totals match.
  db.prepare('UPDATE unified_import_batches SET summaryJson=? WHERE batchId=?')
    .run(JSON.stringify({validUniqueWaybills:6421}),batch);
  result=readSelectedDateBusinessSourceTruth(db,{reportDate:day,snapshotId:snap});
  assert.equal(result.status,'SOURCE_IMPORT_MISMATCH');
  assert.equal(result.source.balanced,false);
  console.log('[V783 SEVEN BUSINESS SOURCE] 6231+190=6421 nonoverlapping, 6421 fully unified, duplicate WHPP/CE member conflict, invalid source sum all PASS');
}finally{db.close()}
