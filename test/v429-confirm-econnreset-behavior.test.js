import test from 'node:test';
import assert from 'node:assert/strict';
import { CEClient } from '../src/ceClient.js';
import '../src/v70ConfirmQueryResiliencePatch.js';

function makeClient(postHandler) {
  const client = new CEClient();
  client.refreshTokenIfNeeded = async () => false;
  client.http.post = postHandler;
  return client;
}

function rawResetError(message = 'read ECONNRESET') {
  const error = new Error(message);
  error.code = 'ECONNRESET';
  return error;
}

function okConfirm(body) {
  return {
    status: 200,
    data: {
      success: true,
      data: body.shipmentCodes.map(shipmentCode => ({ shipmentCode, orderStatus: 10 }))
    }
  };
}

test('V429: five-waybill preflight survives two raw ECONNRESETs normalized by CEClient then succeeds', async () => {
  let calls = 0;
  const client = makeClient(async (_path, body) => {
    calls += 1;
    if (calls <= 2) throw rawResetError();
    return okConfirm(body);
  });

  const codes = ['A1', 'A2', 'A3', 'A4', 'A5'];
  const rows = await client.confirmQuery(codes);
  assert.equal(calls, 3);
  assert.deepEqual(rows.map(row => row.shipmentCode), codes);
});

test('V429: persistent raw ECONNRESET is normalized and stops after bounded transient retries', async () => {
  let calls = 0;
  const client = makeClient(async () => {
    calls += 1;
    throw rawResetError('Client network socket disconnected before secure TLS connection was established');
  });

  await assert.rejects(() => client.confirmQuery(['B1', 'B2', 'B3', 'B4', 'B5']), error => {
    assert.equal(error.causeCode, 'ECONNRESET');
    assert.match(error.message, /confirm-query失败/);
    return true;
  });
  assert.equal(calls, 4, 'one initial request plus three bounded transient retries');
});

test('V429: normalized 401 auth failure remains fail-closed without transport retry', async () => {
  let calls = 0;
  const client = makeClient(async () => {
    calls += 1;
    const error = new Error('Unauthorized');
    error.response = { status: 401, data: { code: 401, msg: 'token expired' } };
    throw error;
  });

  await assert.rejects(() => client.confirmQuery(['C1', 'C2', 'C3']), /token expired/);
  assert.equal(calls, 1);
});

test('V429: normalized permanent 400 request failure remains fail-closed without retry', async () => {
  let calls = 0;
  const client = makeClient(async () => {
    calls += 1;
    const error = new Error('Bad request');
    error.response = { status: 400, data: { code: 'REQUEST_SCHEMA_INVALID', msg: 'bad request' } };
    throw error;
  });

  await assert.rejects(() => client.confirmQuery(['D1', 'D2']), /bad request/);
  assert.equal(calls, 1);
});
