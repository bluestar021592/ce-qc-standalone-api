import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildWhppDashboard } from '../src/whppReporting.js';

function stateFixture() {
  const reportDate = '2026-08-12';
  const dailyParseRows = [
    ['WHPP-PP-SHOP','PP'],
    ['WHPP-PV-SHOP','PV'],
    ['WHPP-PENDING','PP'],
    ['WHPP-POD','PV'],
    ['WHPP-580','PV']
  ].map(([shipmentCode, regionCode]) => ({ shipmentCode, regionCode, reportDate, businessType:'WHPP' }));

  const finalRows = [
    {
      shipmentCode:'WHPP-PP-SHOP', reportDate, regionCode:'PP', businessType:'WHPP',
      currentState:'PICKUP_SUCCESS', primaryCategory:'正常流转',
      shopState:'SHOP_ARRIVED_CURRENT', Pending次数:3, Pending当前次数:3, OC天数:0
    },
    {
      shipmentCode:'WHPP-PV-SHOP', reportDate, regionCode:'PV', businessType:'WHPP',
      currentState:'PICKUP_SUCCESS', primaryCategory:'正常流转',
      shopState:'SHOP_TRANSFER_IN_PROGRESS', Pending次数:0, OC天数:3
    },
    {
      shipmentCode:'WHPP-PENDING', reportDate, regionCode:'PP', businessType:'WHPP',
      currentState:'PENDING', primaryCategory:'Pending3次以上', Pending次数:3, Pending当前次数:3
    },
    {
      shipmentCode:'WHPP-POD', reportDate, regionCode:'PV', businessType:'WHPP',
      currentState:'POD', primaryCategory:'POD', 是否POD:'是', POD状态:'POD'
    },
    {
      shipmentCode:'WHPP-580', reportDate, regionCode:'PV', businessType:'WHPP',
      currentState:'CCSL580_RETENTION', primaryCategory:'CCSL580_RETENTION', specialState:'CCSL580_RETENTION'
    }
  ];

  return {
    businessType:'WHPP', reportDate,
    pnhBills: dailyParseRows.map(row => row.shipmentCode),
    dailyParseRows,
    finalRows
  };
}

test('WHPP shop cards split by recipient region and share the same detail rows', () => {
  const dashboard = buildWhppDashboard(stateFixture());
  const m = dashboard.metrics;

  assert.equal(m.total, 5);
  assert.equal(m.shopTotal, 2);
  assert.equal(m.phnomPenhShop, 1);
  assert.equal(m.provinceShop, 1);
  assert.equal(dashboard.detailTabs.phnomPenhShop.total, m.phnomPenhShop);
  assert.equal(dashboard.detailTabs.provinceShop.total, m.provinceShop);
  assert.equal(dashboard.detailTabs.phnomPenhShop.rows[0].shipmentCode, 'WHPP-PP-SHOP');
  assert.equal(dashboard.detailTabs.provinceShop.rows[0].shipmentCode, 'WHPP-PV-SHOP');

  // Shop rows remain normal location buckets even when historical/current fields
  // still carry Pending/OC/PICKUP_SUCCESS evidence.
  assert.equal(m.pending1, 1);
  assert.equal(m.pending2, 1);
  assert.equal(m.pending3, 1);
  assert.equal(m.oc1, 0);
  assert.equal(m.unresolved, 1);

  assert.equal(dashboard.regions.PP.phnomPenhShop, 1);
  assert.equal(dashboard.regions.PV.provinceShop, 1);
  assert.equal(dashboard.accounting.accounted, dashboard.accounting.total);
  assert.equal(dashboard.accounting.difference, 0);
});

test('WHPP UI exposes both shop cards and uses matching detail tabs', () => {
  const ui = fs.readFileSync(new URL('../public/whpp-v44.js', import.meta.url), 'utf8');
  const injector = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');

  assert.match(ui, /\['金边门店',m\.phnomPenhShop,'件','phnomPenhShop'\]/);
  assert.match(ui, /\['外省门店',m\.provinceShop,'件','provinceShop'\]/);
  assert.match(ui, /key==='phnomPenhShop'[^\n]+region==='PP'/);
  assert.match(ui, /key==='provinceShop'[^\n]+region==='PV'/);
  assert.match(injector, /whpp-v44\.js\?v=20260812-1/);
});
