import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {qcDetailRead} from '../src/qcActionDetailRead.js';

const page=fs.readFileSync(new URL('../public/qc-action-detail.html',import.meta.url),'utf8');
assert.match(page,/ce-express-logo-main\.png/,'details use the existing CE QC app logo');
assert.match(page,/\.qcd-top\{background:#104779/,'details use the same blue-white identity');
assert.match(page,/d\.source\.classificationConflict\?'跨业务分类冲突':d\.evidence\.source\?'日报成员已核实':'仅保存处理记录'/,'source/conflict label reflects actual evidence');
const db=new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE unified_import_batches(snapshotId TEXT,batchId TEXT,reportDate TEXT,status TEXT,createdAt TEXT);
CREATE TABLE unified_import_rows(batchId TEXT,shipmentCode TEXT,businessType TEXT,reportDate TEXT,snapshotId TEXT,regionCode TEXT,recipientNormalized TEXT,sheetName TEXT,rowNumber INTEGER,classificationReason TEXT,rowJson TEXT);
CREATE TABLE business_states(businessType TEXT PRIMARY KEY,valueJson TEXT,updatedAt TEXT);
CREATE TABLE business_export_snapshots(id INTEGER PRIMARY KEY,snapshotId TEXT,businessType TEXT,reportDate TEXT,payloadJson TEXT);
CREATE TABLE business_daily_parse_rows(id INTEGER PRIMARY KEY,businessType TEXT,reportDate TEXT,shipmentCode TEXT,sheetName TEXT,rowNumber INTEGER,source_row_number INTEGER,recipient_normalized TEXT,createdAt TEXT);
CREATE TABLE business_scan_results(businessType TEXT,reportDate TEXT,shipmentCode TEXT,isPod INTEGER,orderStatus TEXT,updatedAt TEXT,rawJson TEXT);
CREATE TABLE business_final_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT,isPod INTEGER,primaryCategory TEXT,apiStatus TEXT,carryStatus TEXT,latestEventTime TEXT,latestEventDesc TEXT,latestNode TEXT,updatedAt TEXT,rawJson TEXT);
CREATE TABLE business_shipment_tracks(businessType TEXT,reportDate TEXT,shipmentCode TEXT,shipmentStatus TEXT,statusText TEXT,apiStatus TEXT,updatedAt TEXT,rawJson TEXT);
CREATE TABLE business_track_events(id INTEGER PRIMARY KEY,businessType TEXT,reportDate TEXT,shipmentCode TEXT,eventTime TEXT,eventCode TEXT,rawJson TEXT);
CREATE TABLE shipment_current_state(shipmentCode TEXT,businessType TEXT,reportDate TEXT,snapshotId TEXT,state TEXT,apiStatus TEXT,lastEventTime TEXT,updatedAt TEXT);
`);
const date='2026-07-04',snap='SNAP-cbfa4938-3fc1-4',a='CE04072600013',b='CE04072600014',archived='CE04072600015';
db.prepare("INSERT INTO unified_import_batches VALUES(?,?,?,?,?)").run(snap,'B-WHPP-770',date,'VALID',date);
db.prepare("INSERT INTO unified_import_rows VALUES(?,?,?,?,?,?,?,?,?,?,?)").run('B-WHPP-770',a,'CE',date,snap,'PP','','sheet1',13,'CE classification','{}');
db.prepare("INSERT INTO business_daily_parse_rows VALUES(?,?,?,?,?,?,?,?,?)").run(1,'WHPP',date,a,'WHPP source',13,13,'',date);
const storedState={businessType:'WHPP',reportDate:date,sourceSnapshotId:'WHPP-INDEPENDENT-4',finalRows:[
 {shipmentCode:a,businessType:'WHPP',primaryCategory:'其他待核验',latestEventDesc:'仓库待核验',latestEventTime:'2026-07-04T09:00:00'},
 {shipmentCode:b,businessType:'WHPP',primaryCategory:'其他待核验',latestEventDesc:'需要核实扫描节点'}
],scanResults:[{shipmentCode:a,orderStatus:'70'}],
trackEvents:[{shipmentCode:a,eventTime:'2026-07-04T09:00:00',eventCode:'70',description:'派送分配'}]};
db.prepare('INSERT INTO business_states VALUES(?,?,?)').run('WHPP',JSON.stringify(storedState),date);
const run=(code,type='WHPP',day=date,snapshot=snap)=>qcDetailRead(db,{reportDate:day,shipmentCode:code,businessType:type,snapshotId:snapshot});
const resolved=run(a);
assert.equal(resolved.ok,true,'WHPP daily proof must win when unified row is labeled CE');
assert.equal(resolved.detail.source.sourceKind,'WHPP_DAILY_PARSE');
assert.equal(resolved.detail.source.classificationConflict,true,'same waybill has CE versus WHPP classification conflict');
assert.equal(resolved.detail.source.otherUnifiedBusiness,'CE');
assert.match(resolved.detail.notice,/跨业务分类冲突/);
assert.equal(resolved.detail.evidence.source,true);
assert.equal(resolved.detail.source.businessType,'WHPP');
assert.equal(resolved.detail.finalRow.latestEventDesc,'仓库待核验','read the WHPP saved final, not CE');
assert.equal(resolved.detail.scan.orderStatus,'70');
assert.equal(resolved.detail.events[0].description,'派送分配');
const unverified=run(b);
assert.equal(unverified.ok,true,'saved WHPP exact-day final must be inspectable');
assert.equal(unverified.detail.evidence.source,false,'saved final cannot pretend WHPP is in daily ledger');
assert.equal(unverified.detail.source.sourceKind,'WHPP_FINAL_ONLY');
assert.match(unverified.detail.notice,/日报来源成员/);
assert.equal(unverified.detail.finalRow.latestEventDesc,'需要核实扫描节点');
assert.equal(run('UNKNOWN').code,'QC_DETAIL_MEMBER_MISSING','unknown member stays blocked');
assert.equal(run(b,'WHPP','2026-07-05').code,'QC_DETAIL_SNAPSHOT_MISSING','cannot borrow another date');
assert.equal(run(b,'SHOPEECN').code,'QC_DETAIL_MEMBER_MISSING','cannot borrow another business');
assert.equal(run(a,'WHPP',date,'WRONG').code,'QC_DETAIL_SNAPSHOT_MISSING','wrong unified snapshot denied');
const legacy={businessType:'WHPP',reportDate:date,finalRows:[{shipmentCode:archived,primaryCategory:'需联系客户',reportDate:date}]};
db.prepare("UPDATE business_states SET valueJson=? WHERE businessType='WHPP'").run(JSON.stringify({businessType:'WHPP',reportDate:'2026-10-08',finalRows:[{shipmentCode:archived}]}));
db.prepare("INSERT INTO business_export_snapshots VALUES(?,?,?,?,?)").run(2,'WHPP-SAVED-4','WHPP',date,JSON.stringify({state:legacy}));
const old=run(archived);
assert.equal(old.ok,true,'old same-date saved WHPP snapshot is legitimate evidence to inspect');
assert.equal(old.detail.source.sourceKind,'WHPP_FINAL_ONLY');
assert.equal(old.detail.evidence.source,false);
assert.equal(old.detail.source.snapshotId,'WHPP-SAVED-4');
assert.equal(old.detail.finalRow.primaryCategory,'需联系客户');
assert.equal(run(archived,'WHPP','2026-07-05').code,'QC_DETAIL_SNAPSHOT_MISSING');
db.close();
console.log('[V770] WHPP independent daily source vs unified CE, true source/unverified saved final, exact date/snapshot, archived member, original CE QC logo PASS');
