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
const date='2026-07-04',snap='SNAP-cbfa4938-3fc1-4',a='CE04072600013',b='CE04072600014',archived='CE04072600015',scanOnly='CE04072600016',eventsOnly='CE04072600017';
db.prepare("INSERT INTO unified_import_batches VALUES(?,?,?,?,?)").run(snap,'B-WHPP-770',date,'VALID',date);
db.prepare("INSERT INTO unified_import_rows VALUES(?,?,?,?,?,?,?,?,?,?,?)").run('B-WHPP-770',a,'CE',date,snap,'PP','','sheet1',13,'CE classification','{}');
db.prepare("INSERT INTO business_daily_parse_rows VALUES(?,?,?,?,?,?,?,?,?)").run(1,'WHPP',date,a,'WHPP source',13,13,'',date);
const storedState={businessType:'WHPP',reportDate:date,sourceSnapshotId:'WHPP-INDEPENDENT-4',finalRows:[
 {shipmentCode:a,businessType:'WHPP',primaryCategory:'其他待核验',latestEventDesc:'仓库待核验',latestEventTime:'2026-07-04T09:00:00'},
 {shipmentCode:b,businessType:'WHPP',primaryCategory:'其他待核验',latestEventDesc:'需要核实扫描节点'}
],scanResults:[{shipmentCode:a,orderStatus:'70'},{shipmentCode:scanOnly,orderStatus:'70',businessType:'WHPP'}],
trackEvents:[{shipmentCode:a,eventTime:'2026-07-04T09:00:00',eventCode:'70',description:'派送分配'},
{shipmentCode:eventsOnly,businessType:'WHPP',eventTime:'2026-07-04T10:00:00',eventCode:'70',description:'独立轨迹待跟进'}]};
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
// Regression: a unified WHPP member must not lose independent exact-day
// saved scan/final evidence merely because its import membership is verified.
db.prepare("INSERT INTO unified_import_rows VALUES(?,?,?,?,?,?,?,?,?,?,?)").run('B-WHPP-770',b,'WHPP',date,snap,'PP','','sheet1',14,'WHPP verified member','{}');
const verifiedWithSaved=run(b);
assert.equal(verifiedWithSaved.ok,true);
assert.equal(verifiedWithSaved.detail.source.sourceKind,'UNIFIED_IMPORT');
assert.equal(verifiedWithSaved.detail.evidence.source,true);
assert.equal(verifiedWithSaved.detail.evidence.final,true,'read existing WHPP-only final when imported source is present');
assert.equal(verifiedWithSaved.detail.finalRow.latestEventDesc,'需要核实扫描节点');
assert.equal(verifiedWithSaved.detail.source.snapshotId,snap,'preserve unified immutable snapshot');
// Local independent WHPP evidence may contain only scan or only track events.
db.prepare("INSERT INTO unified_import_rows VALUES(?,?,?,?,?,?,?,?,?,?,?)").run('B-WHPP-770',scanOnly,'WHPP',date,snap,'PP','','sheet1',16,'WHPP scan member','{}');
const fromScanOnly=run(scanOnly);
assert.equal(fromScanOnly.ok,true);
assert.equal(fromScanOnly.detail.source.sourceKind,'UNIFIED_IMPORT');
assert.equal(fromScanOnly.detail.scan.orderStatus,'70','scan-only evidence remains visible');
assert.equal(fromScanOnly.detail.finalRow,null,'scan must not fabricate a final record');
const fromEventsOnly=run(eventsOnly);
assert.equal(fromEventsOnly.ok,true);
assert.equal(fromEventsOnly.detail.source.sourceKind,'WHPP_FINAL_ONLY','event-only saved evidence is unverified import membership');
assert.equal(fromEventsOnly.detail.evidence.source,false);
assert.equal(fromEventsOnly.detail.events.length,1);
assert.equal(fromEventsOnly.detail.events[0].description,'独立轨迹待跟进');


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
// V772: exact WHPP final CLOSED+cancellation is a terminal saved outcome,
// even when there are no timeline events; no mere scan-10 false closure.
db.prepare("INSERT INTO business_daily_parse_rows VALUES(?,?,?,?,?,?,?,?,?)").run(3,'WHPP',date,'CE04072600018','WHPP source',18,18,'',date);
db.prepare("INSERT INTO business_final_rows(businessType,reportDate,shipmentCode,isPod,primaryCategory,apiStatus,carryStatus,latestEventTime,latestEventDesc,latestNode,updatedAt,rawJson) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
  .run('WHPP',date,'CE04072600018',0,'订单取消','SUCCESS','CLOSED','','','',date,'{}');
const cancelDetail=run('CE04072600018');
assert.equal(cancelDetail.ok,true);
assert.equal(cancelDetail.detail.source.sourceVerified,true);
assert.equal(cancelDetail.detail.evidence.final,true);
assert.equal(cancelDetail.detail.terminalOutcome,'ORDER_CANCELLED','cancelled CLOSED is not an open missing-track case');
assert.match(cancelDetail.detail.notice,/订单取消及CLOSED闭环/);
assert.equal(cancelDetail.detail.events.length,0,'no trajectory event can be invented for a cancellation');
db.prepare("INSERT INTO business_daily_parse_rows VALUES(?,?,?,?,?,?,?,?,?)").run(4,'WHPP',date,'CE04072600019','WHPP source',19,19,'',date);
db.prepare("INSERT INTO business_final_rows(businessType,reportDate,shipmentCode,isPod,primaryCategory,apiStatus,carryStatus,updatedAt,rawJson) VALUES(?,?,?,?,?,?,?,?,?)")
  .run('WHPP',date,'CE04072600019',0,'订单取消','SUCCESS','OPEN',date,'{}');
assert.equal(run('CE04072600019').detail.terminalOutcome,'','unclosed cancellation label must stay unverified');
assert.match(page,/d\.terminalOutcome==='ORDER_CANCELLED'\?'订单取消（已闭环）'/,'detail header must show the saved cancelled disposition');

db.close();
console.log('[V770] WHPP independent daily source vs unified CE, true source/unverified saved final, exact date/snapshot, archived member, original CE QC logo PASS');
