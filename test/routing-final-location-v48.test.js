import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  classifyFinalRoutingDestination,
  ROUTING_DESTINATIONS
} from '../src/routingDestinationV48.js';

function classify(row) {
  return classifyFinalRoutingDestination(row).destination;
}

test('final CCSLZT overrides stale historical CCSLCN classification', () => {
  assert.equal(classify({
    latestEffectiveTargetNodeCode: 'CEL:CCSLZT',
    specialState: 'CCSLCN_DIVERSION',
    primaryCategory: 'CCSLCN_DIVERSION'
  }), ROUTING_DESTINATIONS.CCSLZT);
});

test('final CCSLCN overrides stale historical CCSLZT classification', () => {
  assert.equal(classify({
    latestEffectiveTargetNodeCode: 'CEL:CCSLCN',
    specialState: 'CCSLZT_DIVERSION',
    primaryCategory: 'CCSLZT_DIVERSION'
  }), ROUTING_DESTINATIONS.CCSLCN);
});

test('final CEL:CCSL580 belongs only to 580 retention destination', () => {
  const result = classifyFinalRoutingDestination({
    latestEffectiveTargetNodeCode: 'CEL:CCSL580',
    specialState: 'CCSLCN_DIVERSION'
  });
  assert.equal(result.destination, ROUTING_DESTINATIONS.CCSL580);
  assert.equal(result.finalNode, 'CEL:CCSL580');
  assert.equal(result.usedFallback, false);
});

test('a newer non-routing final node suppresses stale CN/ZT/580 state', () => {
  for (const stale of ['CCSLCN_DIVERSION','CCSLZT_DIVERSION','CCSL580_RETENTION']) {
    assert.equal(classify({
      latestEffectiveTargetNodeCode: 'CEL:CCSL',
      specialState: stale,
      primaryCategory: stale
    }), '', `stale ${stale} must not survive a newer final CEL:CCSL node`);
  }
});

test('legacy specialState is used only when no final-node field is available', () => {
  assert.equal(classify({ specialState: 'CCSLCN_DIVERSION' }), ROUTING_DESTINATIONS.CCSLCN);
  assert.equal(classify({ specialState: 'CCSLZT_DIVERSION' }), ROUTING_DESTINATIONS.CCSLZT);
  assert.equal(classify({ specialState: 'CCSL580_RETENTION' }), ROUTING_DESTINATIONS.CCSL580);
});

test('routing UI and range layer explicitly cover TBKH and all three destination cards', () => {
  const range = fs.readFileSync(path.resolve('src/rangeDashboardStoreV36.js'), 'utf8');
  const ui = fs.readFileSync(path.resolve('public/routing-v48.js'), 'utf8');
  assert.match(range, /'TBKH'/);
  assert.match(ui, /'\/tbkh':'TBKH'/);
  for (const label of ['CCSLCN分流','CCSLZT分流','580滞留包裹']) {
    assert.match(range + ui, new RegExp(label));
  }
});
