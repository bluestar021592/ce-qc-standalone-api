import assert from 'node:assert/strict';
import fs from 'node:fs';
import {deliveryFollowupDisposition} from '../src/openPodDeliveryScope.js';
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
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
assert.match(server,/deliveryFollowupDisposition\(\{\.\.\.state,currentState:savedState\}\)/);
assert.match(server,/if\(!disposition\.include\)continue/);
assert.match(server,/scope==='open' \? allRows\.filter\(row=>!row\.isClosed&&deliveryFollowupDisposition\(row\)\.include\)/);
assert.match(server,/SELECT o\.shipmentCode,o\.businessType,o\.sourceReportDate/);
console.log('[V791] explicit courier handoffs excluded; missing scan remains unverified, never invented POD PASS');
