import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyShipmentStatus } from '../src/shipmentStatusTruth.js';
import { analyzeShipment } from '../src/analyzerFinal.js';
import { analyzeShopeeShipment } from '../src/shopeeAnalyzerV33.js';

assert.deepEqual(classifyShipmentStatus({shipmentStatus:'60'}),{
  code:'60',currentState:'POD',pod:true,returned:false,returnInProgress:false,source:'SHIPMENT_STATUS_60_POD',recognized:true
});
assert.equal(classifyShipmentStatus({shipmentStatus:'80'}).currentState,'RETURN_IN_PROGRESS');
assert.equal(classifyShipmentStatus({shipmentStatus:'80'}).pod,false);
assert.equal(classifyShipmentStatus({shipmentStatus:'80'}).returned,false);
assert.equal(classifyShipmentStatus({shipmentStatus:'81'}).currentState,'RETURN_COMPLETED');
assert.equal(classifyShipmentStatus({shipmentStatus:'81'}).returned,true);
// Field separation: tracking eventCode 80 is not a shipmentStatus 80.
assert.equal(classifyShipmentStatus({eventCode:'80'}).recognized,false);

const common={waybill:'CE21082600140',scanRow:{shipmentCode:'CE21082600140',orderStatus:'70'},events:[],reportDate:'2026-10-06'};
let row=analyzeShipment({...common,shipmentTrackRow:{shipmentCode:'CE21082600140',shipmentStatus:'60',statusTime:'2026-10-06 10:00:00'}});
assert.equal(row.currentState,'POD');assert.equal(row.是否POD,'是');assert.equal(row.shipmentStatusSource,'SHIPMENT_STATUS_60_POD');

row=analyzeShipment({...common,waybill:'SPE260730002142',shipmentTrackRow:{shipmentCode:'SPE260730002142',shipmentStatus:'80'}});
assert.equal(row.currentState,'RETURN_IN_PROGRESS');assert.equal(row.是否POD,'否');assert.equal(row.退回状态,'退回处理中');

row=analyzeShipment({...common,waybill:'SPE260818000681',shipmentTrackRow:{shipmentCode:'SPE260818000681',shipmentStatus:'81'}});
assert.equal(row.currentState,'RETURN_COMPLETED');assert.equal(row.是否POD,'否');assert.equal(row.退回状态,'已退回');

const shopeeBase={waybill:'SPE260730002142',scanRow:{shipmentCode:'SPE260730002142',orderStatus:'70'},events:[],reportDate:'2026-10-06'};
let shop=analyzeShopeeShipment({...shopeeBase,shipmentTrackRow:{shipmentCode:'SPE260730002142',shipmentStatus:'80'}});
assert.equal(shop.currentState,'RETURN_IN_PROGRESS');assert.equal(shop.退回状态,'退回处理中');assert.equal(shop.是否POD,'否');
shop=analyzeShopeeShipment({...shopeeBase,shipmentTrackRow:{shipmentCode:'SPE260730002142',shipmentStatus:'60'}});
assert.equal(shop.currentState,'POD');assert.equal(shop.是否POD,'是');
shop=analyzeShopeeShipment({...shopeeBase,shipmentTrackRow:{shipmentCode:'SPE260730002142',shipmentStatus:'81'}});
assert.equal(shop.currentState,'RETURN_COMPLETED');assert.equal(shop.退回状态,'已退回');

const truth=fs.readFileSync('src/v191ShopeeTruth.js','utf8');
assert.match(truth,/BUSINESS_SHIPMENT_TRACKS/);
assert.match(truth,/classifyShipmentStatus/);
assert.match(truth,/if\(sh\?\.returned \|\| sh\?\.returnInProgress\)return false/);
console.log('[V711] shipmentStatus field is isolated and locked: 60=POD, 80=return-in-progress, 81=returned; eventCode semantics remain separate');
