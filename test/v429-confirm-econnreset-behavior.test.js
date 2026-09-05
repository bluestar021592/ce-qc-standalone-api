import test from 'node:test';
import assert from 'node:assert/strict';
import { CEClient } from '../src/ceClient.js';
import '../src/v70ConfirmQueryResiliencePatch.js';

function makeClient(handler) {
  const client = new CEClient();
  client.postJson = handler;
  return client;
}

function resetError(message = 'read ECONNRESET') {
  const error = new Error(message);
  error.causeCode = 'ECONNRESET';
  return error;
}

test('V429: five-waybill preflight survives two normalized ECONNRESETs then succeeds', async () => {
  let calls = 0;
  const client = makeClient(async (_path, body) => {
    calls += 1;
    if (calls <= 2) throw resetError();
    return { data: body.shipmentCodes.map(shipmentCode => ({ shipmentCode, orderStatus: 10 })) };
  });

  const codes = ['A1', 'A2', 'A3', 'A4', 'A5'];
  const rows = await client.confirmQuery(codes);
  assert.equal(calls, 3);
  assert.deepEqual(rows.map(row => row.shipmentCode), codes);
});

test('V429: five-waybill preflight stops after bounded transient retries', async () => {
  let calls = 0;
  const client = makeClient(async () => {
    calls += 1;
    throw resetError('Client network socket disconnected before secure TLS connection was established');
  });

  await assert.rejects(() => client.confirmQuery(['B1', 'B2', 'B3', 'B4', 'B5']), error => {
    assert.equal(error.causeCode, 'ECONNRESET');
    return true;
  });
  assert.equal(calls, 4, 'one initial request plus three bounded transient retries');
});

test('V429: auth failure remains fail-closed without retry', async () => {
  let calls = 0;
  const client = makeClient(async () => {
    calls += 1;
    const error = new Error('登录已过期，请重新登录CE系统');
    error.ceCode = 'AUTH_REQUIRED';
    error.ceStatus = 401;
    throw error;
  });

  await assert.rejects(() => client.confirmQuery(['C1', 'C2', 'C3']), /登录已过期/);
  assert.equal(calls, 1);
});

test('V429: permanent 400 request failure remains fail-closed without retry', async () => {
  let calls = 0;
  const client = makeClient(async () => {
    calls += 1;
    const error = new Error('REQUEST_SCHEMA_INVALID');
    error.ceCode = 'REQUEST_SCHEMA_INVALID';
    error.ceStatus = 400;
    throw error;
  });

  await assert.rejects(() => client.confirmQuery(['D1', 'D2']), /REQUEST_SCHEMA_INVALID/);
  assert.equal(calls, 1);
});
