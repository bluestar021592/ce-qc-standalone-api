import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {persistConfirmRows} from '../src/selectedDateTimingEvidenceRepair.js';
import {explicitWhppConfirm85PodTime,trustedWhppPodTime} from '../src/whppPodTimeEvidence.js';
const date='2026-07-02';
assert.equal(explicitWhppConfirm85PodTime({orderStatus:'85',POD时间:'2026-07-03 10:35:00'},date),'2026-07-03 10:35:00');
assert.equal(explicitWhppConfirm85PodTime({orderStatus:'84',POD时间:'2026-07-03 10:35:00'},date),'');
assert.equal(explicitWhppConfirm85PodTime({orderStatus:'85',updateTime:'2026-07-03 10:35:00'},date),'');
assert.equal(explicitWhppConfirm85PodTime({orderStatus:'85',podTime:'2026-07-01 10:35:00'},date),'');
const db=new DatabaseSync(':memory:');
try{
db.exec([
"CREATE TABLE business_scan_results(businessType TEXT,shipmentCode TEXT,reportDate TEXT,isPod INTEGER,orderStatus TEXT,recipient_raw TEXT,recipient_normalized TEXT,recipient_group TEXT,recipient_group_reason TEXT,source_row_number INTEGER,rawJson TEXT,createdAt TEXT,updatedAt TEXT,PRIMARY KEY(businessType,shipmentCode,reportDate))",
"CREATE TABLE business_pod_locks(businessType TEXT NOT NULL,shipmentCode TEXT NOT NULL,podTime TEXT,source TEXT,createdAt TEXT,updatedAt TEXT,PRIMARY KEY(businessType,shipmentCode))"
].join(';')+';');
const rows=[
 {shipmentCode:'V788CONFIRM85',orderStatus:'85',podTime:'2026-07-03 14:15:00'},
 {shipmentCode:'V788METADATA',orderStatus:'85',lastUpdateDate:'2026-07-03 17:30:00'},
 {shipmentCode:'V788NONPOD',orderStatus:'84',podTime:'2026-07-03 11:00:00'},
 {shipmentCode:'V788UNREQUESTED',orderStatus:'85',podTime:'2026-07-03 10:05:00'}
];
assert.equal(persistConfirmRows('WHPP',date,rows,db,rows.slice(0,3).map(x=>x.shipmentCode)),3);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM business_scan_results").get().n,3);
assert.deepEqual({...db.prepare("SELECT podTime,source FROM business_pod_locks WHERE shipmentCode='V788CONFIRM85'").get()},
{podTime:'2026-07-03 14:15:00',source:'whpp_confirm_85_explicit_pod_time'});
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM business_pod_locks").get().n,1);
assert.equal(trustedWhppPodTime(db.prepare("SELECT podTime,source FROM business_pod_locks WHERE shipmentCode='V788CONFIRM85'").get(),date),'2026-07-03 14:15:00');
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM business_scan_results WHERE shipmentCode='V788UNREQUESTED'").get().n,0);
assert.equal(db.prepare("SELECT shipmentCode FROM business_pod_locks WHERE shipmentCode='V788NONPOD'").get(),undefined);
// Proven signed event must remain unchanged when confirm result repeats
// with a later generic (or even a later explicit) timestamp.
db.prepare("INSERT INTO business_pod_locks VALUES('WHPP','V788LOCKED','2026-07-03 08:00:00','whpp_strict_track_event','','')").run();
persistConfirmRows('WHPP',date,[{shipmentCode:'V788LOCKED',orderStatus:'85',podTime:'2026-07-04 13:00:00'}],db,['V788LOCKED']);
assert.equal(db.prepare("SELECT podTime FROM business_pod_locks WHERE shipmentCode='V788LOCKED'").get().podTime,'2026-07-03 08:00:00');
console.log('[V788 CONFIRM85 POD TIME] exact WHPP confirm85 verified timestamp saved; generic update, unrelated status and overfetch excluded; trusted older evidence preserved PASS');
}finally{db.close();}
