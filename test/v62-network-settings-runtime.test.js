import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('V62 network settings refreshes missing LAN address from live compact state', () => {
  const runtime = fs.readFileSync(new URL('../public/v62-network-settings-runtime.js', import.meta.url), 'utf8');
  const injector = fs.readFileSync(new URL('../src/v44WhppUiPatch.js', import.meta.url), 'utf8');
  assert.match(runtime, /\/api\/state\?compact=1/);
  assert.match(runtime, /network\.lanUrl/);
  assert.match(runtime, /未检测到有效局域网IPv4/);
  assert.match(injector, /v62-network-settings-runtime\.js\?v=20260812-1/);
});
