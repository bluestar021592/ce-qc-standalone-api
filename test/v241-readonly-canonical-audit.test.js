import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
    CREATE TABLE unified_import_rows(id INTEGER PRIMARY KEY AUTOINCREMENT,snapshotId TEXT,businessType TEXT,shipmentCode TEXT);
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
    INSERT INTO unified_import_rows(snapshotId,businessType,shipmentCode) VALUES
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
    assert.equal(ce.declaredMismatch,false);
    const cn=v241CollectSourceMembership(db,'2026-08-17','SHOPEECN',batch);
    assert.equal(cn.latestValidSnapshotCount,0);
    assert.equal(cn.archiveUnifiedCount,1);
    assert.equal(cn.businessParseCount,2);
    assert.equal(cn.persistedFinalSupplementCount,0);
    assert.equal(cn.sourceMode,'CANONICAL_SOURCE_LEDGER');
    assert.equal(cn.sourceCount,2);
    assert.equal(cn.declaredMismatch,false);
    const vn=v241CollectSourceMembership(db,'2026-08-17','SHOPEEVN',batch);
    assert.equal(vn.sourceCount,2);
    const whpp=v241CollectSourceMembership(db,'2026-08-17','WHPP',batch);
    assert.equal(whpp.sourceCount,1);
    assert.equal(v241ShopeeOverlap(db,'2026-08-17',batch).count,0);
  }finally{db.close();}
});

test('V241 newest completed observation wins if a waybill was reclassified across same-day snapshots',()=>{
  const db=fixture();
  try{
    db.prepare("INSERT INTO unified_import_rows(snapshotId,businessType,shipmentCode) VALUES('S_NEW','CEAF','CE-OLD')").run();
    const batch=v241ReadLatestValidBatch(db,'2026-08-17');
    const ce=v241CollectSourceMembership(db,'2026-08-17','CE',batch);
    const ceaf=v241CollectSourceMembership(db,'2026-08-17','CEAF',batch);
    assert.equal(ce.members.has('CE-OLD'),false);
    assert.equal(ceaf.members.has('CE-OLD'),true);
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

test('V241 declared business total is a fail-closed source-membership cross-check',()=>{
  const db=fixture();
  try{
    db.prepare("UPDATE business_daily_reports SET totalCount=3 WHERE businessType='CE' AND reportDate='2026-08-17'").run();
    const batch=v241ReadLatestValidBatch(db,'2026-08-17');
    const ce=v241AuditType(db,'2026-08-17','CE',batch);
    assert.equal(ce.declaredMismatch,true);
    assert.equal(ce.pass,false);
  }finally{db.close();}
});

test('V242 restores a fully missing ShopeeCN source ledger from exact report-date persisted final membership',()=>{
  const db=fixture();
  try{
    db.prepare("DELETE FROM unified_import_rows WHERE businessType='SHOPEECN'").run();
    db.prepare("DELETE FROM business_daily_parse_rows WHERE recipient_group='CN'").run();
    db.prepare("DELETE FROM business_daily_reports WHERE businessType='SHOPEECN'").run();
    db.prepare("DELETE FROM business_final_rows WHERE shipmentCode IN ('CN-OLD','CN-PARSE')").run();
    db.prepare("DELETE FROM shipment_current_state WHERE shipmentCode IN ('CN-OLD','CN-PARSE')").run();
    db.prepare("INSERT INTO business_final_rows VALUES('SHOPEECN','CN-FINAL-1','2026-08-17',1,'POD')").run();
    db.prepare("INSERT INTO business_final_rows VALUES('SHOPEECN','CN-FINAL-2','2026-08-17',0,'Pending1次')").run();
    db.prepare("INSERT INTO shipment_current_state VALUES('CN-FINAL-1','SHOPEECN','2026-08-18','S_NEW','POD','SUCCESS','{\"currentState\":\"POD\"}','2026-08-18 10:00:00')").run();
    db.prepare("INSERT INTO shipment_current_state VALUES('CN-FINAL-2','SHOPEECN','2026-08-18','S_NEW','PENDING','SUCCESS','{}','2026-08-18 10:00:00')").run();
    const batch=v241ReadLatestValidBatch(db,'2026-08-17');
    const truth=v241CollectSourceMembership(db,'2026-08-17','SHOPEECN',batch);
    assert.equal(truth.archiveUnifiedCount,0);
    assert.equal(truth.businessParseCount,0);
    assert.equal(truth.persistedFinalCandidateCount,2);
    assert.equal(truth.persistedFinalSupplementCount,2);
    assert.equal(truth.sourceMode,'PERSISTED_FINAL_MEMBERSHIP_RECOVERY');
    assert.equal(truth.sourceCount,2);
    const audit=v241AuditType(db,'2026-08-17','SHOPEECN',batch);
    assert.equal(audit.normalizedCount,2);
    assert.equal(audit.currentCount,2);
    assert.equal(audit.pass,true);
    assert.equal(v241ShopeeOverlap(db,'2026-08-17',batch).count,0);
  }finally{db.close();}
});

test('V242 supplements a partially truncated ShopeeVN ledger and excludes a bill explicitly reclassified to ShopeeCN',()=>{
  const db=fixture();
  try{
    db.prepare("DELETE FROM business_daily_reports WHERE businessType='SHOPEEVN'").run();
    db.prepare("INSERT INTO business_final_rows VALUES('SHOPEEVN','VN-PERSISTED-ONLY','2026-08-17',0,'Pending1次')").run();
    db.prepare("INSERT INTO shipment_current_state VALUES('VN-PERSISTED-ONLY','SHOPEEVN','2026-08-18','S_NEW','PENDING','SUCCESS','{}','2026-08-18 10:00:00')").run();
    db.prepare("INSERT INTO business_final_rows VALUES('SHOPEEVN','CN-PARSE','2026-08-17',0,'Pending1次')").run();
    const batch=v241ReadLatestValidBatch(db,'2026-08-17');
    const vn=v241CollectSourceMembership(db,'2026-08-17','SHOPEEVN',batch);
    assert.equal(vn.sourceMode,'CANONICAL_PLUS_PERSISTED_FINAL');
    assert.equal(vn.persistedFinalSupplementCount,1);
    assert.equal(vn.members.has('VN-PERSISTED-ONLY'),true);
    assert.equal(vn.members.has('CN-PARSE'),false);
    assert.equal(vn.sourceCount,3);
    const audit=v241AuditType(db,'2026-08-17','SHOPEEVN',batch);
    assert.equal(audit.pass,true);
    assert.equal(v241ShopeeOverlap(db,'2026-08-17',batch).count,0);
  }finally{db.close();}
});

test('V241 WHPP read-only audit uses mutable terminal truth and does not block on historical final-row lag alone',()=>{
  const url=new URL('../scripts/CE_QC_WHPP_Terminal_Authority_Audit_ReadOnly.mjs',import.meta.url);
  const source=fs.readFileSync(url,'utf8');
  const syntax=spawnSync(process.execPath,['--check',fileURLToPath(url)],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
  assert.match(source,/v241-whpp-current-terminal-readonly-v1/);
  assert.match(source,/podLockCurrentMismatch/);
  assert.match(source,/latestScanMismatch/);
  assert.match(source,/latestTrackMismatch/);
  assert.match(source,/currentTerminalCarryOpen/);
  assert.match(source,/currentTerminalLegacyCarryActive/);
  assert.match(source,/historical normalized final-row lag \(diagnostic only\)/);
  assert.match(source,/const total=podLockCurrentMismatch\+latestScanMismatch\+latestTrackMismatch\+currentTerminalCarryOpen\+currentTerminalLegacyCarryActive/);
  assert.doesNotMatch(source,/const total=.*historicalFinalLag/);
});
