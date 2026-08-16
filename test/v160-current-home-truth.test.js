import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../public/v160-current-home-truth.js', import.meta.url), 'utf8');
const injector = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');

// Fresh unified-import business cards and home KPIs must share one report-day authority.
test('V160 replaces stale home aggregates with current imported-day placeholders before processing', () => {
  assert.match(ui, /CCSL_TYPES=\['CE','CEAF','TBKH','ALI1688'\]/);
  assert.match(ui, /SHOPEE_TYPES=\['SHOPEECN','SHOPEEVN'\]/);
  assert.match(ui, /stateTotal\(state,kind\)!==total/);
  assert.match(ui, /statePod\(state,kind\)>total/);
  assert.match(ui, /todayPod:0,podRate:0/);
  assert.match(ui, /snapshotStatus:'IMPORTED'/);
  assert.match(ui, /__v160Provisional:true/);
});

test('V160 is injected after V159 so current business membership is seeded first', () => {
  const v159 = injector.indexOf('/v159-current-import-stability.js');
  const v160 = injector.indexOf('/v160-current-home-truth.js');
  assert.ok(v159 >= 0, 'V159 script must be present');
  assert.ok(v160 > v159, 'V160 must load after V159');
  assert.match(injector, /v160-current-home-truth-v1/);
});
