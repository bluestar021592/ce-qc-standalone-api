import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { collectShopeeShipmentTruth, queryShopeeAttemptFacts } from '../src/v191ShopeeTruth.js';

function fixtureDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE unified_import_batches(reportDate TEXT,snapshotId TEXT,createdAt TEXT,batchId TEXT,status TEXT);
    CREATE TABLE unified_import_rows(reportDate TEXT,snapshotId TEXT,businessType TEXT,shipmentCode TEXT,regionCode TEXT);
    CREATE TABLE shipment_current_state(shipmentCode TEXT,businessType TEXT,state TEXT,apiStatus TEXT,lastEventTime TEXT,stateJson TEXT,updatedAt TEXT);
    CREATE TABLE business_final_rows(businessType TEXT,shipmentCode TEXT,reportDate TEXT,isPod INTEGER,primaryCategory TEXT,currentMainCategory TEXT,apiStatus TEXT,latestEventTime TEXT,latestEventDesc TEXT,latestNode TEXT,currentAttemptNo INTEGER,podAttemptNo INTEGER,rawJson TEXT,updatedAt TEXT);
    CREATE TABLE business_scan_results(businessType TEXT,shipmentCode TEXT,reportDate TEXT,isPod INTEGER,orderStatus TEXT,rawJson TEXT,updatedAt TEXT);
    CREATE TABLE business_track_events(id INTEGER PRIMARY KEY AUTOINCREMENT,businessType TEXT,shipmentCode TEXT,reportDate TEXT,eventTime TEXT,eventCode TEXT,rawJson TEXT,createdAt TEXT);
  `);
  const insBatch = db.prepare('INSERT INTO unified_import_batches VALUES(?,?,?,?,?)');
  const insRow = db.prepare('INSERT INTO unified_import_rows VALUES(?,?,?,?,?)');
  for (const date of ['2026-08-10','2026-08-11','2026-08-16']) insBatch.run(date, `s${date}`, `${date}T01`, `b${date}`, 'VALID');
  insRow.run('2026-08-10','s2026-08-10','SHOPEECN','A','PP');
  insRow.run('2026-08-11','s2026-08-11','SHOPEECN','B','PV');
  insRow.run('2026-08-16','s2026-08-16','SHOPEECN','C','PP');

  // A is imported on 8/10 but only closes on 8/12. The later POD/attempt must
  // reconcile back to its original report day instead of leaving 8/10 at zero.
  db.prepare('INSERT INTO business_final_rows VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('SHOPEE','A','2026-08-12',1,'POD','POD','SUCCESS','2026-08-12 15:00','POD','',2,2,JSON.stringify({ POD时间:'2026-08-12 15:00' }),'2026-08-12T16');

  // B has a POD lock but no explicit attempt number. Two persisted delivery days
  // must recover it as second-attempt POD without treating code 30 itself as delivery.
  db.prepare('INSERT INTO shipment_current_state VALUES(?,?,?,?,?,?,?)')
    .run('B','SHOPEECN','POD','SUCCESS','2026-08-13 18:00',JSON.stringify({ 是否POD:'是', POD时间:'2026-08-13 18:00' }),'2026-08-13T19');
  for (const [time, text] of [
    ['2026-08-11 10:00','delivery assign courier'],
    ['2026-08-12 10:00','out for delivery'],
    ['2026-08-13 18:00','POD delivered']
  ]) {
    db.prepare('INSERT INTO business_track_events(businessType,shipmentCode,reportDate,eventTime,eventCode,rawJson,createdAt) VALUES(?,?,?,?,?,?,?)')
      .run('SHOPEE','B','2026-08-13',time,'',JSON.stringify({ trackingEventDesc:text }),'2026-08-13T19');
  }
  return db;
}

test('V191 reconciles later Shopee POD/attempt truth to original source dates and keeps newest VALID day', () => {
  const db = fixtureDb();
  const truth = collectShopeeShipmentTruth({ db, businessType:'SHOPEECN', bills:['A','B','C'] });
  assert.equal(truth.get('A').pod, true);
  assert.equal(truth.get('A').attemptNo, 2);
  assert.equal(truth.get('B').pod, true);
  assert.equal(truth.get('B').attemptNo, 2);
  assert.equal(truth.get('B').attemptSource, 'TRACK_DELIVERY_DATES');
  assert.equal(truth.get('C').hasEvidence, false);

  const facts = queryShopeeAttemptFacts({ db, fromDate:'2026-08-10', toDate:'2026-08-16' });
  const f10 = facts.find(row => row.reportDate === '2026-08-10');
  const f11 = facts.find(row => row.reportDate === '2026-08-11');
  const f16 = facts.find(row => row.reportDate === '2026-08-16');
  assert.deepEqual({ total:f10.total, pod:f10.pod, attempt2:f10.attempt2 }, { total:1, pod:1, attempt2:1 });
  assert.deepEqual({ total:f11.total, pod:f11.pod, attempt2:f11.attempt2 }, { total:1, pod:1, attempt2:1 });
  assert.deepEqual({ total:f16.total, pod:f16.pod, evidence:f16.evidenceCount }, { total:1, pod:0, evidence:0 });
  db.close();
});
