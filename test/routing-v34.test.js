import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifyLatestSpecialNode } from '../src/specialNode.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

function event(locationCode) {
  return {
    eventTime: '2026-08-10 10:00:00',
    locationCode,
    trackingEventDescZh: `货物到达 ${locationCode}`
  };
}

test('CEL:CCSLCN and CEL:CCSLZT are normal diversion destinations', () => {
  const cn = classifyLatestSpecialNode([event('CEL:CCSLCN')]);
  const zt = classifyLatestSpecialNode([event('CEL:CCSLZT')]);
  assert.equal(cn?.specialState, 'CCSLCN_DIVERSION');
  assert.equal(cn?.label, 'CCSLCN分流');
  assert.equal(zt?.specialState, 'CCSLZT_DIVERSION');
  assert.equal(zt?.label, 'CCSLZT分流');
});

test('historical CECN and CEZT aliases normalize to current diversion meaning', () => {
  assert.equal(classifyLatestSpecialNode([event('CEL:CECN')])?.specialState, 'CCSLCN_DIVERSION');
  assert.equal(classifyLatestSpecialNode([event('CEL:CEZT')])?.specialState, 'CCSLZT_DIVERSION');
});

test('V34 dashboard routing layer treats shop flow as Phnom Penh shop, not external-province shop', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'rangeDashboardStoreV34.js'), 'utf8');
  assert.match(source, /phnomPenhShop/);
  assert.match(source, /pvStoreRetention' in metrics\) metrics\.pvStoreRetention = 0/);
  assert.match(source, /pvStoreInboundNoScan' in metrics\) metrics\.pvStoreInboundNoScan = 0/);
  assert.match(source, /CCSLCN分流/);
  assert.match(source, /CCSLZT分流/);
});

test('business dashboard adapter exposes the three routing-location counters and removes external shop labels', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'dashboard-data-adapter-v18.js'), 'utf8');
  assert.match(source, /label:'CCSLCN分流'/);
  assert.match(source, /label:'CCSLZT分流'/);
  assert.match(source, /label:'金边门店'/);
  assert.match(source, /外省门店滞留/);
  assert.match(source, /外省门店入库无节点/);
  assert.match(source, /original\.filter\(item => !remove\.has/);
});
