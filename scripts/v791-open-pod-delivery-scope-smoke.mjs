import assert from 'node:assert/strict';
import fs from 'node:fs';
import {deliveryFollowupDisposition,savedTerminalProof} from '../src/openPodDeliveryScope.js';
import {matchedTmsTerminalEvidence,carryBusinessMatches} from '../src/unifiedImportStore.js';
import {classifyV246Terminal} from '../src/v246TrackingLedgerCore.js';
for(const v of ['CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION','CCSL580_DIVERSION','CECN_RETENTION','CEZT_RETENTION']){
  assert.deepEqual(deliveryFollowupDisposition({specialState:v}).include,false,v);
  assert.equal(deliveryFollowupDisposition({currentState:v}).reason,'DELIVERY_HANDOFF');
}
// A stale historical diversion label cannot silently hide a newer active
// Pending/OC/scan-review state. Contradictions stay visible, not auto-closed.
for(const handoff of ['CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION']){
  for(const active of ['PENDING','OC','PENDING_SCAN','CYCLE_COUNT']){
    const row=deliveryFollowupDisposition({currentState:active,specialState:handoff});
    assert.equal(row.include,true,'active '+active+' versus stale '+handoff+' must remain visible');
    assert.equal(row.reason,'STATE_EVIDENCE_CONFLICT');
  }
  assert.equal(deliveryFollowupDisposition({currentState:'OPEN',specialState:handoff}).include,false,
    'generic OPEN must not override an otherwise uncontradicted handoff');
  assert.equal(deliveryFollowupDisposition({currentState:handoff,primaryCategory:'PENDING'}).include,false,
    'active explicit handoff is sufficient for courier follow-up exclusion');
}
assert.equal(deliveryFollowupDisposition({currentState:'PENDING',specialState:'CCSL580_RETENTION',
  terminalEvidenceVerified:true,terminalEvidenceBusinessMatched:true,
  terminalEvidenceWaybillMatched:true,shipmentStatus:'60'}).reason,'VERIFIED_POD',
  'same-waybill verified terminal proof outranks contradictory categories');
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
const tms60={shipmentCode:'CC06072602913',businessType:'CCSL',shipmentStatus:'60',
  shipmentStatusSource:'SHIPMENT_STATUS_60_POD',API状态:'成功'};
const tms80={...tms60,shipmentStatus:'80',
  shipmentStatusSource:'SHIPMENT_STATUS_80_RETURN_IN_PROGRESS'};
const tms81={...tms60,shipmentStatus:'81',
  shipmentStatusSource:'SHIPMENT_STATUS_81_RETURN_COMPLETED'};
assert.equal(matchedTmsTerminalEvidence(tms60,'CC06072602913','CEAF')?.shipmentStatus,'60');
assert.equal(matchedTmsTerminalEvidence({...tms60,businessType:'SHOPEE'},'CC06072602913','CEAF'),null,
  'foreign family TMS evidence cannot close a CEAF bill');
assert.equal(matchedTmsTerminalEvidence(tms80,'CC06072602913','CEAF')?.shipmentStatus,'80');
assert.equal(matchedTmsTerminalEvidence(tms81,'CC06072602913','CEAF')?.shipmentStatus,'81');
assert.equal(matchedTmsTerminalEvidence({...tms60,shipmentStatusSource:''},'CC06072602913','CEAF'),null,
  'raw shipment status without proven TMS pipeline marker is not trusted');
assert.equal(matchedTmsTerminalEvidence({...tms60,orderStatus:'85',shipmentStatus:'85'},'CC06072602913','CEAF'),null,
  'scan orderStatus cannot be mistaken for shipmentStatus');
assert.equal(matchedTmsTerminalEvidence(tms60,'CC06072602914','CEAF'),null,
  'proof must match the exact shipment code');
assert.equal(matchedTmsTerminalEvidence({...tms60,API状态:'失败'},'CC06072602913','CEAF')?.shipmentStatus,'60',
  'order scan failure must not invalidate separately verified TMS shipment status');
const legacy={shipmentCode:'CC06072602913',businessType:'CCSL',shipmentStatus:'60',
  shipmentStatusSource:'SHIPMENT_STATUS_60_POD'};
assert.equal(savedTerminalProof(legacy,'CC06072602913','CEAF')?.shipmentStatus,'60');
assert.equal(savedTerminalProof({...legacy,shipmentStatusSource:''},'CC06072602913','CEAF'),null);
assert.equal(savedTerminalProof(legacy,'CC06072602914','CEAF'),null);
assert.equal(savedTerminalProof({...legacy,businessType:'SHOPEE'},'CC06072602913','CEAF'),null);
assert.equal(savedTerminalProof({...legacy,shipmentStatus:'80',shipmentStatusSource:'SHIPMENT_STATUS_80_RETURN_IN_PROGRESS'},
  'CC06072602913','CEAF')?.shipmentStatus,'80');
const signed={shipmentCode:'CC06072602913',businessType:'CEAF',orderStatus:'85',
  是否POD:'是',terminalEvidence:{source:'TMS_SHIPMENT_STATUS',verified:true,
    shipmentCode:'CC06072602913',businessType:'CEAF',shipmentStatus:'80'}};
const activeReturn=classifyV246Terminal({state:'RETURN_IN_PROGRESS',stateJson:signed});
assert.equal(activeReturn.terminal,false,'verified TMS 80 overrides stale legacy POD/85');
assert.equal(activeReturn.pod,false);
assert.equal(classifyV246Terminal({state:'PENDING_SCAN',stateJson:{
  ...signed,terminalEvidence:{...signed.terminalEvidence,shipmentStatus:'60'}}}).reason,'POD');
assert.equal(classifyV246Terminal({state:'PENDING_SCAN',stateJson:{
  ...signed,terminalEvidence:{...signed.terminalEvidence,shipmentStatus:'81'}}}).reason,'RETURNED');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
assert.match(server,/const disposition=deliveryFollowupDisposition\(\{/,
  'historical OPEN must pass evidence-gated disposition');
assert.match(server,/if\(!disposition\.include\)continue/);
assert.match(server,/const effectiveOpenRows=allRows\.filter\(row=>!row\.isClosed&&deliveryFollowupDisposition\(row\)\.include\)/);
assert.match(server,/openRowCount:effectiveOpenRows\.length/,
  'open delivery count must equal filtered open members');
assert.match(server,/const isPod = terminalCode==='60' \|\| \(terminalCode!=='80'&&terminalCode!=='81'/,
  'workspace must never call a verified returning/returned shipment POD using legacy 85/isPod flag');
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
assert.match(server,/const proof=savedTerminalProof\(state,bill,type\)\|\|\{\}/,
  'historical OPEN must read guarded, typed saved TMS facts');
assert.match(server,/proof\.verified===true&&proofBill===bill&&proofType===type/,
  'persisted terminal evidence must match source business and waybill');
assert.match(server,/shipmentStatus:proofMatches\?String\(proof\.shipmentStatus\|\|''\):''/,
  'stale status must not be treated as a verified TMS terminal');
assert.match(server,/UPPER\(TRIM\(q\.businessType\)\)=UPPER\(TRIM\(o\.businessType\)\)/,
  'historical ledger lookup must match business and waybill');
console.log('[V791] explicit courier handoffs excluded; missing scan remains unverified, never invented POD PASS');
