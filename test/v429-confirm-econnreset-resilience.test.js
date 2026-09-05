import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const transport = fs.readFileSync('src/v70ConfirmQueryResiliencePatch.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');

test('V429 recognizes normalized ECONNRESET transport metadata', () => {
  assert.match(transport, /V429_CONFIRM_PREFLIGHT_RESILIENCE_ID/);
  assert.match(transport, /error\?\.causeCode/);
  assert.match(transport, /error\?\.transportCode/);
  assert.match(transport, /ECONNRESET/);
  assert.match(transport, /socket disconnected before secure TLS connection/);
});

test('V429 gives tiny confirm preflight batches bounded transient retries', () => {
  assert.match(transport, /CONFIRM_QUERY_MIN_BATCH_TRANSIENT_RETRIES \|\| 3/);
  assert.match(transport, /async function retrySmallTransientConfirm/);
  assert.match(transport, /attempt <= MIN_BATCH_TRANSIENT_RETRIES/);
  assert.match(transport, /if \(codes\.length <= MIN_SPLIT\) \{\s*return retrySmallTransientConfirm/);
  assert.match(transport, /isAuthError\(retryError\) \|\| !isTransient\(retryError\)/);
});

test('V429 does not alter 350 logical batching or SHOPEE five-waybill preflight contract', () => {
  assert.match(transport, /CONFIRM_QUERY_BATCH_SIZE \|\| 100/);
  assert.match(transport, /ORDER_BATCH_SIZE \|\| 350/);
  assert.match(server, /const probeBills = state\.pnhBills\.slice\(0, Math\.min\(5, state\.pnhBills\.length\)\);/);
  assert.match(server, /await client\.confirmQuery\(probeBills\);/);
});

test('V429 keeps permanent request/auth failures fail-closed', () => {
  assert.match(transport, /\[400, 401, 403, 404, 422\]\.includes\(status\)/);
  assert.match(transport, /isAuthError\(error\) \|\| !isTransient\(error\)/);
  assert.match(transport, /isAuthError\(error\) \|\| isPermanentRequestError\(error\) \|\| !isTransient\(error\)/);
});
