import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('same Excel is reclassified after ownership ruleset changes', () => {
  const patch = read('src/v42WhppPatch.js');
  assert.match(patch, /IMPORT_RULESET_VERSION/);
  assert.match(patch, /parsed\.fileHash = `\$\{parsed\.fileHash\}:\$\{IMPORT_RULESET_VERSION\}`/);
});

test('V64 restores seven-business import total including separately persisted WHPP', () => {
  const ui = read('public/v64-whpp-total-kpi-integration.js');
  assert.match(ui, /summary\.rawRows/);
  assert.match(ui, /summary\.duplicateRows/);
  assert.match(ui, /summary\.missingWaybillRows/);
  assert.match(ui, /counts\.WHPP = whppTotal/);
  assert.match(ui, /classification-valid-unique/);
  assert.match(ui, /WHPP本土/);
});

test('V64 merges WHPP operational metrics into homepage core KPI denominator', () => {
  const ui = read('public/v64-whpp-total-kpi-integration.js');
  assert.match(ui, /CE \+ CEAF空运 \+ TBKH \+ ALI1688 \+ WHPP本土/);
  assert.match(ui, /m\.pendingNonContinuous/);
  assert.match(ui, /m\.pending3/);
  assert.match(ui, /m\.oc1/);
  assert.match(ui, /m\.workOrder/);
  assert.match(ui, /m\.inboundNoScan/);
  assert.match(ui, /m\.cycle2/);
  assert.match(ui, /m\.pod/);
  assert.match(ui, /regions\?\.PV\?\.unresolved/);
  assert.match(ui, /ccsl580Retention/);
  assert.match(ui, /占CCSL\+WHPP/);
});

test('V64 runtime is injected after legacy dashboard compatibility layers', () => {
  const injector = read('src/v44WhppUiPatch.js');
  assert.match(injector, /v64-whpp-total-kpi-integration\.js\?v=20260812-1/);
  assert.ok(injector.indexOf('v64-whpp-total-kpi-integration.js') > injector.indexOf('v62-network-settings-runtime.js'));
});
