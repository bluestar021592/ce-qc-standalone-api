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

test('final CEL:CCSL580 belongs only to 580 registration destination', () => {
  const result = classifyFinalRoutingDestination({
    latestEffectiveTargetNodeCode: 'CEL:CCSL580',
    specialState: 'CCSLCN_DIVERSION'
  });
  assert.equal(result.destination, ROUTING_DESTINATIONS.CCSL580);
  assert.equal(result.finalNode, 'CEL:CCSL580');
  assert.equal(result.usedFallback, false);
});

test('latest event description overrides a stale historical CCSL580 category after parcel reaches CEZT', () => {
  const result = classifyFinalRoutingDestination({
    lastEventDesc: '30 TE01072026104103127357 货物到达网点【CEL:CEZT】 Parcel has arrived at 【CEL:CEZT】',
    specialState: 'CCSL580_RETENTION',
    primaryCategory: 'CCSL580_RETENTION'
  });
  assert.equal(result.destination, ROUTING_DESTINATIONS.CCSLZT);
  assert.equal(result.finalNode, 'CEL:CEZT');
  assert.equal(result.sourceField, 'lastEventDesc');
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

test('V58 registry UI exposes CEZT CCSLCN CCSL580 as normal registration cards', () => {
  const ui = fs.readFileSync(path.resolve('public/v58-drilldown-runtime.js'), 'utf8');
  for (const label of ['CCSLCN','CEZT','CCSL580']) assert.match(ui, new RegExp(label));
  assert.match(ui, /CCSLCN.*ccslCnDiversion/);
  assert.match(ui, /CEZT.*ccslZtDiversion/);
  assert.match(ui, /CCSL580.*ccsl580Retention/);
});
