import assert from 'node:assert/strict';
import fs from 'node:fs';
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const shell=fs.readFileSync(new URL('../public/v625-shell.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/v625-shell.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/v625-shell.css',import.meta.url),'utf8');

assert.match(html,/>质控行动中心<\/span>/,'must be inside CE QC navigation, not a separate preview app');
for(const id of ['v625Exceptions','v625ExceptionDate','v625ExceptionBusiness','v625ExceptionType',
  'v768ExceptionKeyword','v768CopySelected','v768CopyCurrent','v768CheckAll',
  'v768PreviousPage','v768NextPage','v625ExceptionRows','v768ExceptionEvidence']){
  assert.ok(html.includes('id="'+id+'"'),'QC action control missing: '+id);
}
assert.match(css,/\.v768-queue-table/,'native QC action table must have readable responsive styles');
assert.match(shell,/new URLSearchParams\(\{scope:'actionable',qcAction:'1'\}\)/,'QC evidence must use strictly pinned read-only mode');
assert.match(shell,/r\.qcCoverage&&!r\.qcCoverage\.hasFinalEvidence/,'no-final-ledger must never be represented as zero exceptions');
assert.match(shell,/return '\/qc-action-detail\?'\+p\.toString\(\)/,'QC waybill opens the real source-scoped detail route');
assert.match(shell,/qcActionCase\(item\)/,'action classification must come from returned waybills');
assert.match(shell,/row\.isActionable===true&&row\.isClosed!==true/,'terminal shipments cannot be sent to actions');
assert.match(shell,/latestNode:String\(row\.latestNode\|\|''\)/,'cannot invent a latest event from category');
assert.match(shell,/new Set\(\)/,'duplicate/checked cases must use stable sets');
assert.match(shell,/check\.dataset\.qcCase=row\.businessType\+'\\|'\+row\.shipmentCode/,'checkboxes must distinguish repeated shipment codes across businesses');
assert.match(shell,/checked\.has\(row\.businessType\+'\\|'\+row\.shipmentCode\)/,'copy must not pull a sibling business with the same waybill');
assert.match(server,/const qcActionMode=String\(req\.query\.qcAction\|\|''\)==='1'/,'QC mode must be explicit');
assert.match(server,/QC_SOURCE_DATE_MISMATCH/,'historical dates must fail closed');
assert.match(server,/if \(!qcActionMode&&!states\.some\(/,'QC must not fallback to latest batch');
assert.match(server,/qcCoverage=\{sourceMembers:/,'finalized evidence coverage must be explicit');
assert.match(server,/terminalCode==='60'/,'POD status 60 must not become a new exception');
assert.match(server,/terminalCode==='81'/,'returned status 81 must not become a new exception');
assert.match(server,/whppCancelled/,'saved WHPP cancellation closure must be checked by the QC workspace');

const classifierSection=shell.slice(shell.indexOf('function qcActionClassify('),shell.indexOf('function qcActionFilter('));
assert.ok(classifierSection.length>200);
const classification=new Function(classifierSection+';return {qcActionClassify,qcActionCase};')();
assert.equal(classification.qcActionClassify({pendingNonContinuous:true}).key,'PENDING_GAP');
assert.equal(classification.qcActionClassify({oc2Plus:true,ocDays:3}).key,'OC_2_PLUS');
assert.equal(classification.qcActionClassify({shopArrivedCurrent:true,shopRetentionDays:4}).team,'门店客服 / BD督导');
assert.equal(classification.qcActionClassify({queryStatus:'待重试'}).key,'RETRY');
assert.equal(classification.qcActionClassify({category:'退回中'}).key,'RETURNING');
assert.equal(classification.qcActionClassify({shipmentStatus:'80'}).key,'RETURNING','TMS 80 is open return in progress');
assert.equal(classification.qcActionClassify({category:'无明确原因'}).key,'OTHER');
const caseRow=classification.qcActionCase({shipmentCode:'abc0001',businessType:'CE',latestTime:'2026-10-08T12:00:00'});
assert.equal(caseRow.shipmentCode,'ABC0001');
assert.equal(caseRow.latestNode,'','unknown track description must stay unknown');

const serverFn=server.slice(server.indexOf('function workspaceRows('),server.indexOf('function persistReconciliationDiagnostics('));
const getRows=new Function('workspacePendingNonContinuous','workspaceStoreArrived','workspaceOcDays','billOfWorkspace',
  serverFn+';return workspaceRows;')(
    row=>Boolean(row.pendingNonContinuous),
    row=>Boolean(row.shopArrivedCurrent),
    row=>Number(row.ocDays||0),
    row=>String(row.shipmentCode||'').toUpperCase()
  );
const examples=[
 {shipmentCode:'POD60',shipmentStatus:'60',ocDays:7,pendingNonContinuous:true},
 {shipmentCode:'RETURN81',shipmentStatus:'81',ocDays:3},
 {shipmentCode:'RETURN80',shipmentStatus:'80',primaryCategory:'退回中'},
 {shipmentCode:'WHPP_CANCEL_CLOSED',businessType:'WHPP',primaryCategory:'订单取消',currentState:'ORDER_CANCELLED',carry状态:'closed_cancelled',orderStatus:'10',是否POD:'否'},
 {shipmentCode:'WHPP_CANCEL_SAVED',businessType:'WHPP',primaryCategory:'订单取消',carryStatus:'CLOSED',orderStatus:'10',是否POD:'否'},
 {shipmentCode:'WHPP_CANCEL_UNVERIFIED',businessType:'WHPP',primaryCategory:'订单取消',carryStatus:'OPEN',orderStatus:'10'},
 {shipmentCode:'WHPP_STATUS10_ONLY',businessType:'WHPP',primaryCategory:'其他待核验',orderStatus:'10'},
 {shipmentCode:'CE_CANCEL_OTHER',businessType:'CE',primaryCategory:'订单取消',carry状态:'closed_cancelled'},
 {shipmentCode:'WHPP_CLOSED_NO_REASON',businessType:'WHPP',primaryCategory:'其他待核验',carryStatus:'CLOSED'},
 {shipmentCode:'SELFPICK',specialState:'SELF_PICKUP',ocDays:9},
 {shipmentCode:'CCSL580',specialState:'CEL:CCSL580',ocDays:9},
 {shipmentCode:'CEZT',specialState:'CE:CEZT',ocDays:9},
 {shipmentCode:'CECN',specialState:'CECN',ocDays:9},
 {shipmentCode:'OC2',shipmentStatus:'',ocDays:2},
 {shipmentCode:'SHOP',shopArrivedCurrent:true,shopRetentionNaturalDays:3},
];
const rows=getRows({reportDate:'2026-10-08',finalRows:examples},'CE');
const find=code=>rows.find(x=>x.shipmentCode===code);
for(const bill of ['POD60','RETURN81','SELFPICK','CCSL580','CEZT','CECN']){
  assert.equal(find(bill).isClosed,true,bill+' must not be reopened as QC anomaly');
  assert.equal(find(bill).isActionable,false,bill+' closed evidence must remain excluded');
}
for (const bill of ['WHPP_CANCEL_CLOSED','WHPP_CANCEL_SAVED']) {
  const row=find(bill);
  assert.equal(row.isClosed,true,bill+' verified cancellation should not be a QC open case');
  assert.equal(row.isActionable,false);
  assert.equal(row.whppCancelled,true);
  assert.equal(row.scanStatus,'CANCELLED','cancellation is not POD and not return');
  assert.equal(row.queryStatus,'订单取消跳过');
}
for (const bill of ['WHPP_CANCEL_UNVERIFIED','WHPP_STATUS10_ONLY','CE_CANCEL_OTHER','WHPP_CLOSED_NO_REASON']) {
  assert.equal(find(bill).isActionable,true,bill+' lacks WHPP terminal cancellation proof');
}
assert.equal(find('RETURN80').isActionable,true,'return in progress must continue being tracked');
assert.equal(find('RETURN80').shipmentStatus,'80','tracked TMS 80 should be available to QC classification');
assert.equal(find('OC2').oc2Plus,true,'OC 2 days uses saved current-state evidence');
assert.equal(find('SHOP').shopArrivedCurrent,true,'store arrival must use existing CP validation');

console.log('[V772/QC ACTION CENTER] Seven-business read-only QC, WHPP closed cancellation exclusion, unverified status-10 guard, POD/return/special terminal protections PASS');
