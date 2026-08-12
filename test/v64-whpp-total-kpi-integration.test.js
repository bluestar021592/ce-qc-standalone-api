import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('same Excel is reclassified after ownership ruleset changes', () => {
  const patch = read('src/v42WhppPatch.js');
  assert.match(patch, /IMPORT_RULESET_VERSION/);
  assert.match(patch, /parsed\.fileHash = `\$\{parsed\.fileHash\}:\$\{IMPORT_RULESET_VERSION\}`/);
});

test('V64 restores seven-business import total synchronously from source counts', () => {
  const ui = read('public/v64-whpp-total-kpi-integration.js');
  assert.match(ui, /rawRows\s*-\s*duplicateRows\s*-\s*missingWaybillRows/);
  assert.match(ui, /rawUnique\s*-\s*coreCount/);
  assert.match(ui, /classification-valid-unique/);
  assert.match(ui, /WHPP本土/);
  assert.doesNotMatch(ui, /\/api\/import\/unified-latest/);
});

test('V64 homepage uses lightweight WHPP summary instead of multi-megabyte state routes', () => {
  const ui = read('public/v64-whpp-total-kpi-integration.js');
  assert.match(ui, /\/api\/v71\/whpp-summary\?reportDate=/);
  assert.doesNotMatch(ui, /\/api\/v51\/whpp-state/);
  assert.doesNotMatch(ui, /\/api\/whpp\/state/);
  assert.match(ui, /m\.pendingNonContinuous/);
  assert.match(ui, /m\.pending3/);
  assert.match(ui, /m\.oc1/);
  assert.match(ui, /m\.workOrder/);
  assert.match(ui, /m\.inboundNoScan/);
  assert.match(ui, /m\.cycle2/);
  assert.match(ui, /m\.pod/);
  assert.match(ui, /data\.regionPvUnresolved/);
  assert.match(ui, /m\.ccsl580Retention/);
  assert.match(ui, /占CCSL\+WHPP/);
});

test('V64 is event-driven and never observes the whole application DOM', () => {
  const ui = read('public/v64-whpp-total-kpi-integration.js');
  assert.match(ui, /global\.renderAll/);
  assert.match(ui, /originalRenderAll/);
  assert.doesNotMatch(ui, /new MutationObserver/);
  assert.match(ui, /summaryCache/);
});

test('V64 runtime is injected after legacy dashboard compatibility layers with fresh cache key', () => {
  const injector = read('src/v44WhppUiPatch.js');
  assert.match(injector, /v64-whpp-total-kpi-integration\.js\?v=20260812-2/);
  assert.ok(injector.indexOf('v64-whpp-total-kpi-integration.js') > injector.indexOf('v62-network-settings-runtime.js'));
});

test('V64 runtime is syntax-valid', () => {
  const file = new URL('../public/v64-whpp-total-kpi-integration.js', import.meta.url);
  const check = spawnSync(process.execPath, ['--check', fileURLToPath(file)], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
});
