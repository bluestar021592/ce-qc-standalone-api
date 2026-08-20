import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  v241ReadLatestValidBatch,
  v241CollectSourceMembership,
  v241AuditType,
  v241ShopeeOverlap
} from '../scripts/v241-readonly-canonical-membership.mjs';

function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE unified_snapshots(snapshotId TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE unified_import_batches(batchId TEXT PRIMARY KEY,snapshotId TEXT,reportDate TEXT,status TEXT,createdAt TEXT);
    CREATE TABLE unified_import_rows(snapshotId TEXT,businessType TEXT,shipmentCode TEXT);
    CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT,recipient_group TEXT);
    CREATE TABLE business_daily_reports(businessType TEXT,reportDate TEXT,totalCount INTEGER);
    CREATE TABLE final_rows(shipmentCode TEXT,reportDate TEXT,isPod INTEGER,primaryCategory TEXT);
    CREATE TABLE business_final_rows(businessType TEXT,shipmentCode TEXT,reportDate TEXT,isPod INTEGER,primaryCategory TEXT);
    CREATE TABLE shipment_current_state(shipmentCode TEXT PRIMARY KEY,businessType TEXT,reportDate TEXT,snapshotId TEXT,state TEXT,apiStatus TEXT,stateJson TEXT,lastEventTime TEXT);
  `);
  db.exec(`
    INSERT INTO unified_snapshots VALUES('S_OLD','COMPLETED'),('S_NEW','COMPLETED');
    INSERT INTO unified_import_batches VALUES
      ('B_OLD','S_OLD','2026-08-17','SUPERSEDED','2026-08-17T10:00:00Z'),
      ('B_NEW','S_NEW','2026-08-17','VALID','2026-08-17T12:00:00Z');
    INSERT INTO unified_import_rows VALUES
      ('S_OLD','CE','CE-OLD'),('S_NEW','CE','CE-NEW'),
      ('S_OLD','SHOPEECN','CN-OLD'),('S_NEW','SHOPEEVN','VN-NEW');
    INSERT INTO business_daily_parse_rows VALUES
      ('SHOPEE','2026-08-17','CN-OLD','CN'),('SHOPEE','2026-08-17','CN-PARSE','CN'),
      ('SHOPEE','2026-08-17','VN-NEW','VN'),('SHOPEE','2026-08-17','VN-PARSE','VN'),
      ('WHPP','2026-08-17','WHPP-1','OTHER');
    INSERT INTO business_daily_reports VALUES
      ('CE','2026-08-17',2),('SHOPEECN','2026-08-17',2),('SHOPEEVN','2026-08-17',2),('WHPP','2026-08-17',1);
    INSERT INTO final_rows VALUES
      ('CE-OLD','2026-08-17',1,'POD'),('CE-NEW','2026-08-17',0,'Pending1次');
    INSERT INTO business_final_rows VALUES
      ('SHOPEE','CN-OLD','2026-08-17',1,'POD'),('SHOPEE','CN-PARSE','2026-08-17',0,'Pending1次'),
      ('SHOPEE','VN-NEW','2026-08-17',0,'Pending1次'),('SHOPEE','VN-PARSE','2026-08-17',0,'Pending1次'),
      ('WHPP','WHPP-1','2026-08-17',0,'WHPP滞留');
    INSERT INTO shipment_current_state VALUES
      ('CE-OLD','CE','2026-08-18','S_NEW','POD','SUCCESS','{"orderStatus":"85"}','2026-08-18 10:00:00'),
      ('CE-NEW','CE','2026-08-18','S_NEW','POD','SUCCESS','{"orderStatus":"85"}','2026-08-18 11:00:00'),
      ('CN-OLD','SHOPEE','2026-08-18','S_NEW','POD','SUCCESS','{"currentState":"POD"}','2026-08-18 10:00:00'),
      ('CN-PARSE','SHOPEE','2026-08-18','S_NEW','PENDING','SUCCESS','{}','2026-08-18 10:00:00'),
      ('VN-NEW','SHOPEE','2026-08-18','S_NEW','POD','SUCCESS','{"isPod":1}','2026-08-18 10:00:00'),
      ('VN-PARSE','SHOPEE','2026-08-18','S_NEW','PENDING','SUCCESS','{}','2026-08-18 10:00:00'),
      ('WHPP-1','WHPP','2026-08-18','S_NEW','PENDING','SUCCESS','{}','2026-08-18 10:00:00');
  `);
  return db;
}

test('V241 canonical source membership unions completed superseded history with business parse truth',()=>{
  const db=fixture();
  try{
    const batch=v241ReadLatestValidBatch(db,'2026-08-17');
    assert.equal(batch.snapshotId,'S_NEW');
    const ce=v241CollectSourceMembership(db,'2026-08-17','CE',batch);
    assert.equal(ce.latestValidSnapshotCount,1);
    assert.equal(ce.archiveUnifiedCount,2);
    assert.equal(ce.sourceCount,2);
    assert.equal(ce.recoveredBeyondLatest,1);
    const cn=v241CollectSourceMembership(db,'2026-08-17','SHOPEECN',batch);
    assert.equal(cn.latestValidSnapshotCount,0);
    assert.equal(cn.archiveUnifiedCount,1);
    assert.equal(cn.businessParseCount,2);
    assert.equal(cn.sourceCount,2);
    const vn=v241CollectSourceMembership(db,'2026-08-17','SHOPEEVN',batch);
    assert.equal(vn.sourceCount,2);
    const whpp=v241CollectSourceMembership(db,'2026-08-17','WHPP',batch);
    assert.equal(whpp.sourceCount,1);
    assert.equal(v241ShopeeOverlap(db,'2026-08-17',batch).count,0);
  }finally{db.close();}
});

test('V241 current POD may advance beyond normalized daily POD without failing integrity',()=>{
  const db=fixture();
  try{
    const batch=v241ReadLatestValidBatch(db,'2026-08-17');
    const ce=v241AuditType(db,'2026-08-17','CE',batch);
    assert.equal(ce.sourceCount,2);
    assert.equal(ce.normalizedCount,2);
    assert.equal(ce.currentCount,2);
    assert.equal(ce.normalizedPod,1);
    assert.equal(ce.currentPod,2);
    assert.equal(ce.podProgression,1);
    assert.equal(ce.podRegressionCount,0);
    assert.equal(ce.pass,true);
  }finally{db.close();}
});

test('V241 blocks an actual POD regression per waybill even if aggregate counts could look healthy',()=>{
  const db=fixture();
  try{
    db.prepare("UPDATE shipment_current_state SET state='PENDING',stateJson='{}' WHERE shipmentCode='CE-OLD'").run();
    const batch=v241ReadLatestValidBatch(db,'2026-08-17');
    const ce=v241AuditType(db,'2026-08-17','CE',batch);
    assert.equal(ce.podRegressionCount,1);
    assert.deepEqual(ce.podRegressionSample,['CE-OLD']);
    assert.equal(ce.pass,false);
  }finally{db.close();}
});
