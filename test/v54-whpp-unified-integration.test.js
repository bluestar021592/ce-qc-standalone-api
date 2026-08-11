import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const integration = fs.readFileSync(new URL('../public/v54-whpp-unified-integration.js', import.meta.url), 'utf8');
const injector = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');
const baseApp = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('V54 makes WHPP part of the same unified start resume and pause workflow', () => {
  assert.match(integration, /global\.runUnified\s*=/);
  assert.match(integration, /global\.resumeUnified\s*=/);
  assert.match(integration, /global\.pauseUnified\s*=/);
  assert.match(integration, /\/api\/whpp\/run\/start/);
  assert.match(integration, /\/api\/whpp\/run\/resume/);
  assert.match(integration, /\/api\/whpp\/run\/pause/);
  assert.match(integration, /WHPP本土/);
});

test('V54 exposes WHPP in unified classification and reconciles seven-business total', () => {
  assert.match(integration, /classification-whpp/);
  assert.match(integration, /classification-valid-unique/);
  assert.match(integration, /\['ce','ceaf','tbkh','ali1688','shopeecn','shopeevn','whpp'\]/);
});

test('V54 skips an already-completed earlier stage instead of blocking WHPP', () => {
  assert.match(integration, /function alreadyComplete/);
  assert.match(integration, /当前任务已经完成/);
  assert.match(integration, /if \(alreadyComplete\(error\)\)/);
  assert.match(integration, /continue;/);
  assert.match(integration, /已完成，自动跳过/);
});

test('V54 is injected after the earlier WHPP auto-run and source-truth scripts with a fresh cache key', () => {
  const oldAuto = injector.indexOf('/whpp-v47-auto-run.js');
  const sourceTruth = injector.indexOf('/v52-whpp-source-truth-route.js');
  const v54 = injector.indexOf('/v54-whpp-unified-integration.js?v=20260811-4');
  assert.ok(oldAuto >= 0 && sourceTruth >= 0 && v54 >= 0, 'all WHPP runtime layers must be present');
  assert.ok(v54 > oldAuto, 'V54 must load after the old V47 wrapper');
  assert.ok(v54 > sourceTruth, 'V54 must load after V52 source-truth routing');
});

test('regression documents why V54 is required: base unified flow still only dispatches CCSL and SHOPEE', () => {
  assert.match(baseApp, /\[\['CCSL', '\/api\/run'\], \['SHOPEE', '\/api\/shopee\/run\/start'\]\]/);
});
