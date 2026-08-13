import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isStrictShopeeWhppRetention } from '../src/shopeeWhppRetentionTruth.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const runtimeFiles = [
  'src/shopeeWhppRetentionTruth.js',
  'src/v94ShopeeWhppSourceTruthPatch.js',
  'src/shopeeAnalyzerV32.js',
  'public/v94-business-source-truth-ui-v2.js'
];

function syntax(path) {
  const url = new URL(`../${path}`, import.meta.url);
  return spawnSync(process.execPath, ['--check', fileURLToPath(url)], { encoding: 'utf8' });
}

test('V94 runtime is syntax-valid and loaded after V90 before the main server', () => {
  for (const path of runtimeFiles) {
    const result = syntax(path);
    assert.equal(result.status, 0, `${path}\n${result.stderr || result.stdout}`);
  }
  const bootstrap = read('bootstrap.js');
  assert.match(bootstrap, /v94ShopeeWhppSourceTruthPatch/);
  assert.ok(bootstrap.indexOf('v94ShopeeWhppSourceTruthPatch') > bootstrap.indexOf('v90FastDashboardReadPatch'));
  assert.ok(bootstrap.indexOf('v94ShopeeWhppSourceTruthPatch') < bootstrap.indexOf("importPhase('server'"));
  assert.match(read('src/shopeeAnalyzer.js'), /shopeeAnalyzerV32\.js/);
});

test('WHPP retention accepts only a latest event that still locates the parcel at WHPP', () => {
  assert.equal(isStrictShopeeWhppRetention({
    event: { eventCode: '50', eventTime: '2026-08-01 10:00:00', trackingEventDescZh: '货物到达网点【CE:WHPP】' },
    scanOrderStatus: '50'
  }), true);

  assert.equal(isStrictShopeeWhppRetention({
    event: { eventCode: '26', eventTime: '2026-08-01 10:00:00', locationCode: 'CE:WHPP' },
    scanOrderStatus: '60'
  }), true);
});

test('POD, completed return and return-in-progress can never enter WHPP retention', () => {
  for (const eventCode of ['80', '84', '86']) {
    assert.equal(isStrictShopeeWhppRetention({
      event: { eventCode, locationCode: 'CE:WHPP', trackingEventDescZh: 'CE:WHPP' },
      scanOrderStatus: '50'
    }), false, `eventCode=${eventCode}`);
  }
  for (const orderStatus of ['85', '100']) {
    assert.equal(isStrictShopeeWhppRetention({
      event: { eventCode: '26', locationCode: 'CE:WHPP' },
      scanOrderStatus: orderStatus
    }), false, `orderStatus=${orderStatus}`);
  }
  assert.equal(isStrictShopeeWhppRetention({
    event: { eventCode: '26', locationCode: 'CE:WHPP' },
    scanOrderStatus: '50',
    finalRow: { currentState: 'RETURN_COMPLETED', primaryCategory: '退回', 退回状态: '已退回' }
  }), false);
});

test('an outbound or return sentence that merely mentions WHPP is not WHPP retention', () => {
  assert.equal(isStrictShopeeWhppRetention({
    event: {
      eventCode: '26',
      eventTime: '2026-08-01 10:00:00',
      trackingEventDescZh: '货物离开网点【CE:WHPP】，下一个网点【CE:CP123456】'
    },
    scanOrderStatus: '60'
  }), false);

  assert.equal(isStrictShopeeWhppRetention({
    event: {
      eventCode: '26',
      eventTime: '2026-08-01 10:00:00',
      trackingEventDescZh: '包裹从 CE:WHPP 退回处理中'
    },
    scanOrderStatus: '60'
  }), false);

  assert.equal(isStrictShopeeWhppRetention({
    event: {
      eventCode: '26',
      eventTime: '2026-08-01 10:00:00',
      trackingEventDescZh: '操作备注提到 CE:WHPP，但当前未提供WHPP到达/当前位置证据'
    },
    scanOrderStatus: '60'
  }), false);
});

test('V94 card count and drilldown are forced through one strict normalized source truth', () => {
  const patch = read('src/v94ShopeeWhppSourceTruthPatch.js');
  assert.match(patch, /loadStrictShopeeWhppRetentionRows/);
  assert.match(patch, /SUMMARY_ROUTE = '\/api\/v89\/instant-dashboard'/);
  assert.match(patch, /DETAIL_ROUTE = '\/api\/v89\/shopee-whpp-detail'/);
  assert.doesNotMatch(patch, /LIKE '%CE:WHPP%'/);
  assert.doesNotMatch(patch, /LIKE '%CEL:WHPP%'/);
});

test('V94 import UI reads the app lexical unified state and is injected after V93', () => {
  const ui = read('public/v94-business-source-truth-ui-v2.js');
  const injector = read('src/v44WhppUiPatch.js');
  assert.match(ui, /typeof unifiedImportState !== 'undefined'/);
  assert.match(ui, /V94_CANONICAL_POST_CLASSIFICATION/);
  assert.match(injector, /v94-business-source-truth-ui-v2\.js\?v=20260813-2/);
  assert.ok(injector.indexOf('v94-business-source-truth-ui-v2.js') > injector.indexOf('v93-shopee-resume-ui.js'));
});
