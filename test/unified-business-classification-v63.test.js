import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { classifyUnifiedBusiness, classifyUnifiedMatches } from '../src/unifiedExcelParser.js';

const typeOf = (shipmentCode, recipient = '', customerName = '') => classifyUnifiedBusiness(shipmentCode, recipient, customerName)?.businessType || '';

test('recipient rules identify Shopee and ALI before ordinary CC/CE fallback ownership', () => {
  assert.equal(typeOf('CC100001', 'SHOPEEVN'), 'SHOPEEVN');
  assert.equal(typeOf('CC100002', 'SHOPEECN'), 'SHOPEECN');
  assert.equal(typeOf('CC100003', 'ALI1688'), 'ALI1688');
  assert.equal(typeOf('CE100004', 'SHOPEEVN'), 'SHOPEEVN');
  assert.equal(typeOf('CE100005', 'ALI1688'), 'ALI1688');
});

test('ordinary non-Latin or blank recipients never prevent prefix ownership classification', () => {
  assert.equal(typeOf('CC200001', ''), 'CE');
  assert.equal(typeOf('CC200002', '\u1780\u1781'), 'CE');
  assert.equal(typeOf('CE200003', ''), 'WHPP');
  assert.equal(typeOf('CE200004', '\u1782\u1783'), 'WHPP');
  assert.equal(typeOf('TBKH200005', ''), 'TBKH');
  assert.equal(typeOf('TBKH200006', '\u1784\u1785'), 'TBKH');
});

test('TBKH is recognized by shipment prefix only, not recipient text', () => {
  assert.equal(typeOf('CC300001', 'TBKH'), 'CE');
  assert.equal(typeOf('TBKH300002', 'ordinary recipient'), 'TBKH');
});

test('fallback CC/CE ownership does not create false classification conflicts', () => {
  assert.deepEqual(classifyUnifiedMatches('CC400001', 'SHOPEEVN'), ['SHOPEEVN']);
  assert.deepEqual(classifyUnifiedMatches('CC400002', 'ALI1688'), ['ALI1688']);
  assert.deepEqual(classifyUnifiedMatches('CE400003', 'SHOPEECN'), ['SHOPEECN']);
  assert.deepEqual(classifyUnifiedMatches('CE400004', ''), ['WHPP']);
  assert.deepEqual(classifyUnifiedMatches('CC400005', ''), ['CE']);
});

test('only genuinely competing strong signals remain a classification conflict', () => {
  assert.deepEqual(classifyUnifiedMatches('TBKH500001', 'SHOPEEVN'), ['SHOPEEVN', 'TBKH']);
  assert.deepEqual(classifyUnifiedMatches('CC500002', 'SHOPEEVN ALI1688'), ['SHOPEEVN', 'ALI1688']);
});

test('unified import UI reconciles core snapshot totals with separately persisted WHPP rows', () => {
  const ui = fs.readFileSync(new URL('../public/v54-whpp-unified-integration.js', import.meta.url), 'utf8');
  const injector = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');
  assert.match(ui, /combinedImportTruth/);
  assert.match(ui, /coreUnique \+ separateWhpp/);
  assert.match(ui, /classificationCounts\?\.WHPP/);
  assert.match(ui, /当前处理队列/);
  assert.match(ui, /收件人为空（仍已按规则分类）/);
  assert.match(ui, /真正分类冲突/);
  assert.match(injector, /v54-whpp-unified-integration\.js\?v=20260812-6/);
});
