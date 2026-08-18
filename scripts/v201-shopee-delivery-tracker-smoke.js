import { DatabaseSync } from 'node:sqlite';
import {
  ensureShopeeDeliveryTrackingSchema,
  resolveTrackedShopeeAttempt,
  SHOPEE_DELIVERY_TRACKER_VERSION,
  syncShopeeDeliveryTrackingForRange,
  trackerNaturalDays
} from '../src/shopeeDeliveryTracker.js';

function must(condition, message) { if (!condition) throw new Error(message); }

const pure = resolveTrackedShopeeAttempt({ dispatchDates: ['2026-08-01','2026-08-02','2026-08-03'], podDate: '2026-08-03', fallbackAttempt: 1 });
must(pure.attemptNo === 3, 'three distinct dispatch dates must be third-attempt+');
must(resolveTrackedShopeeAttempt({ dispatchDates: [], assignDates: [], fallbackAttempt: 1 }).attemptNo === 0, 'default first-attempt field must never fabricate attempt one');
must(trackerNaturalDays('2026-08-01','2026-08-04') === 4, 'inclusive signing days must match reference workbook');

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT,updatedAt TEXT);
  CREATE TABLE unified_import_batches(batchId TEXT PRIMARY KEY,snapshotId TEXT,reportDate TEXT,sourceName TEXT,fileHash TEXT,status TEXT,summaryJson TEXT,warningsJson TEXT,createdAt TEXT);
  CREATE TABLE unified_snapshots(snapshotId TEXT PRIMARY KEY,batchId TEXT,reportDate TEXT,status TEXT,payloadJson TEXT,createdAt TEXT);
  CREATE TABLE unified_import_rows(id INTEGER PRIMARY KEY AUTOINCREMENT,batchId TEXT,snapshotId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT,regionCode TEXT,recipientRaw TEXT,recipientNormalized TEXT,sheetName TEXT,rowNumber INTEGER,classificationReason TEXT,rowJson TEXT,createdAt TEXT);
  CREATE TABLE business_track_events(id INTEGER PRIMARY KEY AUTOINCREMENT,businessType TEXT,shipmentCode TEXT,reportDate TEXT,eventTime TEXT,eventCode TEXT,rawJson TEXT,createdAt TEXT);
  CREATE TABLE business_pod_locks(businessType TEXT,shipmentCode TEXT,podTime TEXT,source TEXT,createdAt TEXT,updatedAt TEXT,PRIMARY KEY(businessType,shipmentCode));
`);
ensureShopeeDeliveryTrackingSchema(db);
const addDay = (date, snapshot, batch, status) => {
  db.prepare(`INSERT INTO unified_import_batches VALUES(?,?,?,?,?,'VALID','{}','{}',?)`).run(batch,snapshot,date,'test',`${date}-hash`,`${date}T12:00:00Z`);
  db.prepare(`INSERT INTO unified_snapshots VALUES(?,?,?,'COMPLETED','{}',?)`).run(snapshot,batch,date,`${date}T12:00:00Z`);
  const rowJson = JSON.stringify({ raw: { 状态标识: status, 收件省份: 'Phnom Penh' } });
  db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,'PP','','','Sheet1',1,'test',?,?)`).run(batch,snapshot,date,'SHOPEECN','CNTEST001',rowJson,`${date}T12:00:00Z`);
};
addDay('2026-08-01','S1','B1','W');
addDay('2026-08-02','S2','B2','Y');
db.prepare(`INSERT INTO business_track_events(businessType,shipmentCode,reportDate,eventTime,eventCode,rawJson,createdAt) VALUES('SHOPEE','CNTEST001','2026-08-01','2026-08-01 09:00:00','70','{}','2026-08-01T09:00:00Z')`).run();
db.prepare(`INSERT INTO business_track_events(businessType,shipmentCode,reportDate,eventTime,eventCode,rawJson,createdAt) VALUES('SHOPEE','CNTEST001','2026-08-02','2026-08-02 09:00:00','70','{}','2026-08-02T09:00:00Z')`).run();
db.prepare(`INSERT INTO business_track_events(businessType,shipmentCode,reportDate,eventTime,eventCode,rawJson,createdAt) VALUES('SHOPEE','CNTEST001','2026-08-02','2026-08-02 18:00:00','80','{}','2026-08-02T18:00:00Z')`).run();
db.prepare(`INSERT INTO business_pod_locks VALUES('SHOPEE','CNTEST001','2026-08-02 18:00:00','TEST','2026-08-02T18:00:00Z','2026-08-02T18:00:00Z')`).run();

const result = syncShopeeDeliveryTrackingForRange({ db, fromDate: '2026-08-01', toDate: '2026-08-02', businessTypes: ['SHOPEECN'], reason: 'SMOKE' });
const fact = db.prepare(`SELECT * FROM shopee_delivery_tracking WHERE businessType='SHOPEECN' AND shipmentCode='CNTEST001'`).get();
must(result.tracked === 1, 'exactly one Shopee CN shipment must be tracked');
must(fact.attemptNo === 2, 'two real W/Y+70 dispatch dates must persist as second attempt');
must(fact.podStatus === 1 && fact.podDate === '2026-08-02', 'POD date must persist');
must(fact.signNaturalDays === 2, 'first report to POD inclusive must persist as two days');
must(fact.area === '金边', 'PP region must persist as Phnom Penh');
must(JSON.parse(fact.dispatchDatesJson).join('|') === '2026-08-01|2026-08-02', 'dispatch date evidence must be persisted');
must(SHOPEE_DELIVERY_TRACKER_VERSION.includes('v201'), 'unexpected tracker version');
db.close();
console.log('[V201] persistent SHOPEE CN/VN dispatch/POD/signing-day tracker smoke passed');
