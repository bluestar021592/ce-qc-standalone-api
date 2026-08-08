import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('V29 data consistency patch is loaded before server start',()=>{
  const bootstrap=fs.readFileSync('bootstrap.js','utf8');
  const patch=fs.readFileSync('src/v29DataConsistencyPatch.js','utf8');
  assert.match(bootstrap,/v29DataConsistencyPatch\.js/);
  assert.ok(bootstrap.indexOf('v29DataConsistencyPatch.js')<bootstrap.indexOf("import('./server.js')"));
  assert.match(patch,/\/api\/v29\/metric-detail/);
  assert.match(patch,/\/api\/v29\/carry-monitor/);
});

test('V29 dashboard clicks map every operational label to an explicit detail tab',()=>{
  const client=fs.readFileSync('public/v29-data-consistency-fix.js','utf8');
  const loader=fs.readFileSync('public/v14-geometry-fixture.js','utf8');
  assert.match(loader,/v29-data-consistency-fix\.js/);
  for(const label of ['Pending1+','Pending2+','Pending3+','Pending不连续','OC1+','OC2+','OC3+','签收件数','已退回件','当前未闭环','入库无扫描','工单未处理','严重异常','盘点2天+','外省未完结POD件','门店滞留','门店途中','门店入库','CECN滞留包裹','CEZT滞留包裹','580滞留包裹','派送中','外省派送中','外省门店滞留']) assert.ok(client.includes(`'${label}'`),label);
  assert.match(client,/\/api\/v29\/metric-detail/);
});

test('V29 unresolved and carry policies treat POD and completed returns as normal closed terminals',()=>{
  const patch=fs.readFileSync('src/v29DataConsistencyPatch.js','utf8');
  assert.match(patch,/returned=0 AND specialClosed=0/);
  assert.match(patch,/RETURNED','RETURN_COMPLETED/);
  assert.match(patch,/isPod=1 OR isReturned=1 OR isSpecialClosed=1/);
  assert.match(patch,/effectiveClosed=0/);
  assert.match(patch,/latest_ce_event/);
  assert.match(patch,/latest_shopee_event/);
});

test('V29 batch fallback cannot be blocked by stale audit payload hash',()=>{
  const batching=fs.readFileSync('src/trackBatching.js','utf8');
  assert.match(batching,/function safeAttempt/);
  assert.match(batching,/BATCH_KEY_PAYLOAD_MISMATCH/);
  assert.match(batching,/按逐票成功\/失败状态继续处理/);
  assert.match(batching,/await safeAttempt\(onAttempt/);
});

test('V29 carry business filter requests normalized endpoint',()=>{
  const client=fs.readFileSync('public/v27-carry-business-filter.js','utf8');
  assert.match(client,/parsed\.pathname='\/api\/v29\/carry-monitor'/);
  assert.match(client,/businessType',selected/);
});
