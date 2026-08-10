import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-qc-direct-store-'));
process.env.DATA_DIR = tempRoot;
process.env.DB_FILE = path.join(tempRoot, 'direct-store.db');

const { analyzeStoreFlow } = await import('../src/storeFlow.js');
const { analyzeShipment } = await import('../src/analyzer.js');
const { closeDb } = await import('../src/db.js');

const inbound = {
  eventCode: '',
  eventTime: '2026-08-10 09:00:00',
  trackingEventDesc: '货物到达网点【CP000548】',
  trackingEventDescZh: '货物到达网点【CP000548】',
  locationCode: 'CP000548'
};

test('explicit whitelisted store inbound is enough to prove actual arrival when prior transfer node is absent', () => {
  const store = analyzeStoreFlow({ shipmentCode: 'DIRECT-STORE', events: [inbound], reportDate: '2026-08-10' });
  assert.equal(store.shopState, 'SHOP_ARRIVED_CURRENT');
  assert.equal(store.currentShopCode, 'CP000548');
  assert.equal(store.shopRetentionNaturalDays, 1);

  const result = analyzeShipment({ waybill: 'DIRECT-STORE', scanRow: { orderStatus: '70' }, events: [inbound], reportDate: '2026-08-10' });
  assert.equal(result.currentState, 'SHOP_ARRIVED_CURRENT');
  assert.equal(result.primaryCategory, '门店入库');
});

test.after(() => {
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
