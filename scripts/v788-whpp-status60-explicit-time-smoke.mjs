import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {explicitWhppTms60PodTime,trustedWhppPodTime} from '../src/whppPodTimeEvidence.js';
import {persistShipmentStatusRows} from '../src/selectedDateTimingEvidenceRepair.js';
import {loadWhppCanonicalTruth} from '../src/whppCanonicalTruth.js';
const date='2026-07-02';
assert.equal(explicitWhppTms60PodTime({shipmentStatus:'60',podTime:'2026-07-03 10:20:30'},date),'2026-07-03 10:20:30');
assert.equal(explicitWhppTms60PodTime({shipmentStatus:'80',podTime:'2026-07-03 10:20:30'},date),'');
assert.equal(explicitWhppTms60PodTime({shipmentStatus:'81',podTime:'2026-07-03 10:20:30'},date),'');
assert.equal(explicitWhppTms60PodTime({shipmentStatus:'60',updateTime:'2026-07-03 10:20:30',lastUpdateDate:'2026-07-03 10:20:30'},date),'');
assert.equal(explicitWhppTms60PodTime({shipmentStatus:'60',podTime:'2026-07-01 10:20:30'},date),'');
assert.equal(explicitWhppTms60PodTime({shipmentStatus:'60',podTime:'2026-02-30 10:20:30'},date),'');
assert.equal(trustedWhppPodTime({source:'USER_EDIT',podTime:'2026-07-03 09:00:00'},date),'');
assert.equal(trustedWhppPodTime({source:'whpp_shipment_status_60_explicit_pod_time',podTime:'2026-07-03 09:00:00'},date),'2026-07-03 09:00:00');
const db=new DatabaseSync(':memory:');
try{
db.exec([
"CREATE TABLE business_shipment_tracks(businessType TEXT,shipmentCode TEXT,reportDate TEXT,shipmentStatus TEXT,statusText TEXT,apiStatus TEXT,rawJson TEXT,createdAt TEXT,updatedAt TEXT)",
"CREATE TABLE business_pod_locks(businessType TEXT NOT NULL,shipmentCode TEXT NOT NULL,podTime TEXT,source TEXT,createdAt TEXT,updatedAt TEXT,PRIMARY KEY(businessType,shipmentCode))",
"CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT,rowNumber INTEGER,rowJson TEXT)",
"CREATE TABLE business_scan_results(businessType TEXT,shipmentCode TEXT,reportDate TEXT,isPod INTEGER,orderStatus TEXT,rawJson TEXT)",
"CREATE TABLE business_final_rows(businessType TEXT,shipmentCode TEXT,reportDate TEXT,isPod INTEGER,primaryCategory TEXT,apiStatus TEXT,carryStatus TEXT,latestEventTime TEXT,latestEventDesc TEXT,latestNode TEXT,rawJson TEXT)",
"CREATE TABLE shipment_current_state(shipmentCode TEXT,businessType TEXT,reportDate TEXT,state TEXT,apiStatus TEXT,lastEventTime TEXT,stateJson TEXT)"
].join(';')+';');
const rows=[
{shipmentCode:'V788TIME01',shipmentStatus:'60',podTime:'2026-07-03 09:12:00',lastUpdateDate:'2026-07-06 11:00:00'},
{shipmentCode:'V788TIME02',shipmentStatus:'60',updateTime:'2026-07-04 05:10:00'},
{shipmentCode:'V788RETURN',shipmentStatus:'81',podTime:'2026-07-03 08:00:00'},
{shipmentCode:'V788RETURNING',shipmentStatus:'80',podTime:'2026-07-03 07:00:00'},
{shipmentCode:'V788BADDATE',shipmentStatus:'60',podTime:'2026-07-01 09:12:00'},
{shipmentCode:'WRONGOVERFETCH',shipmentStatus:'60',podTime:'2026-07-03 09:12:00'}
];
const requested=rows.slice(0,5).map(x=>x.shipmentCode);
assert.equal(persistShipmentStatusRows('WHPP',date,rows,db,requested),5);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM business_shipment_tracks').get().n,5);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM business_pod_locks').get().n,1);
assert.deepEqual(db.prepare("SELECT podTime,source FROM business_pod_locks WHERE shipmentCode='V788TIME01'").get(),
{podTime:'2026-07-03 09:12:00',source:'whpp_shipment_status_60_explicit_pod_time'});
assert.equal(db.prepare("SELECT shipmentCode FROM business_pod_locks WHERE shipmentCode='WRONGOVERFETCH'").get(),undefined);
db.prepare("INSERT INTO business_pod_locks VALUES('WHPP','V788TIME02','2026-07-10 12:00:00','USER_EDIT','','')").run();
persistShipmentStatusRows('WHPP',date,[{shipmentCode:'V788TIME02',shipmentStatus:'60',deliveryCompletedAt:'2026-07-04 08:40:00'}],db,['V788TIME02']);
assert.deepEqual(db.prepare("SELECT podTime,source FROM business_pod_locks WHERE shipmentCode='V788TIME02'").get(),
{podTime:'2026-07-04 08:40:00',source:'whpp_shipment_status_60_explicit_pod_time'});
db.prepare("INSERT INTO business_pod_locks VALUES('WHPP','V788PRESERVE','2026-07-03 02:00:00','whpp_strict_track_event','','')").run();
persistShipmentStatusRows('WHPP',date,[{shipmentCode:'V788PRESERVE',shipmentStatus:'60',podTime:'2026-07-04 09:00:00'}],db,['V788PRESERVE']);
assert.equal(db.prepare("SELECT podTime FROM business_pod_locks WHERE shipmentCode='V788PRESERVE'").get().podTime,'2026-07-03 02:00:00');
for(const bill of requested){
  db.prepare("INSERT INTO business_daily_parse_rows VALUES('WHPP',?,?,1,'{}')").run(date,bill);
  db.prepare("INSERT INTO business_scan_results VALUES('WHPP',?,?,0,'','{}')").run(bill,date);
  db.prepare("INSERT INTO business_final_rows VALUES('WHPP',?,?,0,'Pending','success','','','','','{}')").run(bill,date);
  db.prepare("INSERT INTO shipment_current_state VALUES(?,'WHPP',?,'PENDING_SCAN','success','','{}')").run(bill,date);
}
const truth=loadWhppCanonicalTruth(date,'',db);
assert.equal(truth.total,5);
const map=new Map(truth.rows.map(r=>[r.shipmentCode,r]));
assert.equal(map.get('V788TIME01').currentState,'POD');
assert.equal(map.get('V788TIME01').podTime,'2026-07-03 09:12:00');
assert.equal(map.get('V788TIME01').truthEvidence.trustedSavedPodTime,true);
assert.equal(map.get('V788TIME01').truthEvidence.currentTerminalStrict,true);
assert.equal(map.get('V788TIME02').podTime,'2026-07-04 08:40:00');
assert.equal(map.get('V788RETURN').currentState,'RETURNED');
assert.equal(map.get('V788RETURN').podTime,undefined);
assert.equal(map.get('V788RETURNING').currentState,'RETURN_IN_PROGRESS');
assert.equal(map.get('V788BADDATE').podTime,undefined);
console.log('[V788 STATUS60 POD TIME] real explicit POD date saved, updateTime ignored, 80/81 excluded, safe previous lock preserved, correct member-only provenance PASS');
}finally{db.close();}
