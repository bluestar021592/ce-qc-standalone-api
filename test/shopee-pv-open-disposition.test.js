import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShopeeDashboard } from '../src/shopeeReporting.js';

test('Shopee PV unresolved shipments split into four mutually exclusive auditable groups', () => {
  const finalRows = [
    { shipmentCode: 'PV-D', recipient_group: 'VN', regionCode: 'PV', currentState: 'OPEN', shopState: 'SHOP_TRANSFER_IN_PROGRESS' },
    { shipmentCode: 'PV-R', recipient_group: 'VN', regionCode: 'PV', currentState: 'OPEN', shopState: 'SHOP_ARRIVED_CURRENT', shopRetentionNaturalDays: 3 },
    { shipmentCode: 'PV-I', recipient_group: 'VN', regionCode: 'PV', currentState: 'OPEN', shopState: 'SHOP_ARRIVED_CURRENT', shopRetentionNaturalDays: 1 },
    { shipmentCode: 'PV-O', recipient_group: 'VN', regionCode: 'PV', currentState: 'OPEN' },
    { shipmentCode: 'PV-POD', recipient_group: 'VN', regionCode: 'PV', currentState: 'POD' },
    { shipmentCode: 'PV-RETURN', recipient_group: 'VN', regionCode: 'PV', currentState: 'RETURN_COMPLETED' },
    { shipmentCode: 'PP-O', recipient_group: 'VN', regionCode: 'PP', currentState: 'OPEN' }
  ];
  const dailyParseRows = finalRows.map(row => ({ shipmentCode: row.shipmentCode, recipient_group: 'VN', importStatus: 'ACCEPTED' }));
  const dashboard = buildShopeeDashboard({
    reportDate: '2026-08-06',
    pnhBills: finalRows.map(row => row.shipmentCode),
    dailyParseRows,
    finalRows
  });
  const metrics = dashboard.recipientGroups.VN.metrics;
  assert.equal(metrics.pvDelivery, 1);
  assert.equal(metrics.pvStoreRetention, 1);
  assert.equal(metrics.pvStoreInboundNoScan, 1);
  assert.equal(metrics.pvOtherUnresolved, 1);
  assert.equal(metrics.pvDelivery + metrics.pvStoreRetention + metrics.pvStoreInboundNoScan + metrics.pvOtherUnresolved, 4);
  assert.equal(dashboard.detailTabs.VN_pvDelivery.total, 1);
  assert.equal(dashboard.detailTabs.VN_pvStoreRetention.total, 1);
  assert.equal(dashboard.detailTabs.VN_pvStoreInboundNoScan.total, 1);
  assert.equal(dashboard.detailTabs.VN_pvOtherUnresolved.total, 1);
  assert.equal(dashboard.recipientReconciliation.status, 'PASSED');
});
