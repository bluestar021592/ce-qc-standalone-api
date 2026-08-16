import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const patch = fs.readFileSync(new URL('../public/v164-unified-pause-router.js', import.meta.url), 'utf8');
const injector = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');

test('legacy unified pause was CCSL-only and V164 overrides it with active business routing', () => {
  assert.match(app, /async function pauseUnified\(\) \{ await pauseProcess\(\); \}/);
  assert.match(patch, /\/api\/shopee\/run\/pause/);
  assert.match(patch, /\/api\/pause/);
  assert.match(patch, /shopee\?\.running===true/);
  assert.match(patch, /ccsl\?\.running===true/);
  assert.match(patch, /global\.pauseUnified=pauseUnified/);
});

test('V164 pause router is loaded after the base application scripts', () => {
  assert.match(injector, /v164-unified-pause-router\.js/);
  assert.match(injector, /v164-unified-pause-router-v1/);
});
