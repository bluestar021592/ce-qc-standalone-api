import assert from 'node:assert/strict';
import fs from 'node:fs';
import {deliveryFollowupDisposition} from '../src/openPodDeliveryScope.js';
import {matchedTmsTerminalEvidence,carryBusinessMatches} from '../src/unifiedImportStore.js';
for(const v of ['CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION','CCSL580_DIVERSION','CECN_RETENTION','CEZT_RETENTION']){
  assert.deepEqual(deliveryFollowupDisposition({specialState:v}).include,false,v);
  assert.equal(deliveryFollowupDisposition({currentState:v}).reason,'DELIVERY_HANDOFF');
}
assert.equal(deliveryFollowupDisposition({currentState:'PENDING_SCAN'}).reason,'SCAN_EVIDENCE_MISSING');
assert.equal(deliveryFollowupDisposition({currentState:'PENDING_SCAN'}).include,true,
  'missing scan must not be silently marked POD or returned');
assert.equal(deliveryFollowupDisposition({currentState:'OC'}).include,true);
const proof={terminalEvidenceVerified:true,terminalEvidenceBusinessMatched:true,terminalEvidenceWaybillMatched:true};
assert.equal(deliveryFollowupDisposition({...proof,shipmentStatus:'60',currentState:'PENDING_SCAN'}).reason,'VERIFIED_POD');
assert.equal(deliveryFollowupDisposition({...proof,shipmentStatus:'81'}).reason,'VERIFIED_RETURNED');
assert.equal(deliveryFollowupDisposition({...proof,shipmentStatus:'80'}).reason,'RETURN_WORKFLOW');
assert.equal(deliveryFollowupDisposition({shipmentStatus:'60',currentState:'PENDING_SCAN'}).include,true,
  'unverified status never closes a shipment');
assert.equal(deliveryFollowupDisposition({...proof,shipmentStatus:'',eventCode:'60'}).include,true,
  'eventCode 60 must not masquerade as shipmentStatus 60');
assert.equal(deliveryFollowupDisposition({...proof,orderStatus:'60'}).include,true,
  'orderStatus must not masquerade as shipmentStatus');
assert.equal(carryBusinessMatches('CCSL','CEAF'),true);
assert.equal(carryBusinessMatches('SHOPEE','SHOPEEVN'),true);
assert.equal(carryBusinessMatches('CE','CEAF'),false);
const tms60={shipmentCode:'CC06072602913',shipmentStatus:'60',
  shipmentStatusSource:'SHIPMENT_STATUS_60_POD',API状态:'成功'};
const tms80={...tms60,shipmentStatus:'80',
  shipmentStatusSource:'SHIPMENT_STATUS_80_RETURN_IN_PROGRESS'};
const tms81={...tms60,shipmentStatus:'81',
  shipmentStatusSource:'SHIPMENT_STATUS_81_RETURN_COMPLETED'};
assert.equal(matchedTmsTerminalEvidence(tms60,'CC06072602913','CEAF')?.shipmentStatus,'60');
assert.equal(matchedTmsTerminalEvidence(tms80,'CC06072602913','CEAF')?.shipmentStatus,'80');
assert.equal(matchedTmsTerminalEvidence(tms81,'CC06072602913','CEAF')?.shipmentStatus,'81');
assert.equal(matchedTmsTerminalEvidence({...tms60,shipmentStatusSource:''},'CC06072602913','CEAF'),null,
  'raw shipment status without proven TMS pipeline marker is not trusted');
assert.equal(matchedTmsTerminalEvidence({...tms60,orderStatus:'85',shipmentStatus:'85'},'CC06072602913','CEAF'),null,
  'scan orderStatus cannot be mistaken for shipmentStatus');
assert.equal(matchedTmsTerminalEvidence(tms60,'CC06072602914','CEAF'),null,
  'proof must match the exact shipment code');
assert.equal(matchedTmsTerminalEvidence({...tms60,API状态:'失败'},'CC06072602913','CEAF'),null,
  'failed API evidence must never close a shipment');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
assert.match(server,/const disposition=deliveryFollowupDisposition\(\{/,
  'historical OPEN must pass evidence-gated disposition');
assert.match(server,/if\(!disposition\.include\)continue/);
assert.match(server,/scope==='open' \? allRows\.filter\(row=>!row\.isClosed&&deliveryFollowupDisposition\(row\)\.include\)/);
assert.match(server,/const terminalCode=String\(row\.shipmentStatus \?\? scan\.shipmentStatus \?\? ''\)\.trim\(\)/,
  'workspace must never mix orderStatus into shipmentStatus');
assert.doesNotMatch(server,/terminalCode==='85'/,
  'unverified code 85 must never be accepted as a shipment terminal');
assert.match(server,/CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_DIVERSION/,
  'daily workspace must close courier diversions');
const importer=fs.readFileSync(new URL('../src/unifiedImportStore.js',import.meta.url),'utf8');
assert.match(importer,/ledgerSync = syncCarryRowsToV246Ledger\(acceptedRows, \{/,
  'ledger must only sync business-validated normalized rows');
assert.match(importer,/const returned=truth==='81'\|\|\(!truth&&row\.退回状态==='已退回'\)/,
  'return-in-progress text must never count as final return');
assert.match(server,/scanResults: result\.state\.scanResults \|\| \[\]/,
  'verified TMS scan results must reach the historical carryover writer');
assert.match(server,/SELECT o\.shipmentCode,o\.businessType,o\.sourceReportDate/);
assert.match(server,/proof\.source==='TMS_SHIPMENT_STATUS'/,'only typed shipment TMS proof is accepted');
assert.match(server,/proof\.verified===true&&proofBill===bill&&proofType===type/,
  'persisted terminal evidence must match source business and waybill');
assert.match(server,/shipmentStatus:proofMatches\?String\(proof\.shipmentStatus\|\|''\):''/,
  'stale status must not be treated as a verified TMS terminal');
assert.match(server,/UPPER\(TRIM\(q\.businessType\)\)=UPPER\(TRIM\(o\.businessType\)\)/,
  'historical ledger lookup must match business and waybill');
console.log('[V791] explicit courier handoffs excluded; missing scan remains unverified, never invented POD PASS');
