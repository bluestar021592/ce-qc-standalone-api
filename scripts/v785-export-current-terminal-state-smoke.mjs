import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const src=fs.readFileSync(new URL('../src/lightweightDashboardStore.js',import.meta.url),'utf8').replace(/\r\n?/g,'\n');
const start=src.indexOf('function overlaySavedTerminalExportTruth(');
const end=src.indexOf('function listLatestValidRangeBatches(',start);
assert.ok(start>=0&&end>start,'actual exported terminal projection must remain accessible');
const db=new DatabaseSync(':memory:');
db.exec(`
 CREATE TABLE qc_tracking_ledger(shipmentCode TEXT,businessType TEXT,trackingStatus TEXT,terminalReason TEXT,podDate TEXT,lastEventTime TEXT);
 CREATE TABLE shipment_current_state(shipmentCode TEXT,businessType TEXT,state TEXT,stateJson TEXT,lastEventTime TEXT);
`);
const overlay=new Function('getDb','billOf',src.slice(start,end)+'\nreturn overlaySavedTerminalExportTruth;')(
 ()=>db,row=>String(row.shipmentCode||'').toUpperCase());
const put=db.prepare('INSERT INTO shipment_current_state VALUES(?,?,?,?,?)');
put.run('CE26070200001','WHPP','POD',JSON.stringify({shipmentStatus:'60',podTime:'2026-07-03 09:00:00'}),'2026-07-03 09:00:00');
put.run('CE26070200002','WHPP','RETURNING',JSON.stringify({shipmentStatus:'80'}),'2026-07-03 10:00:00');
put.run('CE26070200003','WHPP','RETURNED',JSON.stringify({shipmentStatus:'81'}),'2026-07-03 11:00:00');
put.run('CE26070200004','SHOPEEVN','POD',JSON.stringify({shipmentStatus:'60',podTime:'2026-07-04 09:00:00'}),'2026-07-04 09:00:00');
const original=[
 {shipmentCode:'CE26070200001',businessType:'WHPP',reportDate:'2026-07-02',是否POD:'否',primaryCategory:'Pending'},
 {shipmentCode:'CE26070200002',businessType:'WHPP',reportDate:'2026-07-02',是否退回:'是',退回状态:'已退回',primaryCategory:'退回'},
 {shipmentCode:'CE26070200003',businessType:'WHPP',reportDate:'2026-07-02',是否退回:'否',primaryCategory:'Pending'},
 {shipmentCode:'CE26070200004',businessType:'SHOPEEVN',reportDate:'2026-07-02',是否POD:'否',primaryCategory:'Pending'}
];
const rows=overlay(original,db);
assert.equal(rows[0].currentState,'POD');
assert.equal(rows[0].是否POD,'是');
assert.equal(rows[0].podDate,'2026-07-03 09:00:00');
assert.equal(rows[1].currentState,'RETURNING');
assert.equal(rows[1].是否退回,'否');
assert.equal(rows[1].退回状态,'退回中');
assert.equal(rows[2].currentState,'RETURNED');
assert.equal(rows[2].是否退回,'是');
assert.equal(rows[3].currentState,'POD');
assert.equal(rows[3].是否POD,'是');
assert.ok(rows.every(r=>r.reportDate==='2026-07-02'),'historical source membership must remain unchanged');
assert.ok(original[0].是否POD==='否'&&original[1].退回状态==='已退回','read-only export overlay must not change saved source rows');
console.log('[V785 EXPORT] saved TMS status 60(POD)/80(return-in-progress)/81(return-completed), WHPP and Shopee, historical-date preservation and read-only overlay PASS');
db.close();
