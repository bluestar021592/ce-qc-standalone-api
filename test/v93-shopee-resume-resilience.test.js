import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { payloadScopedBatchKey, rekeyLegacyShopeeApiBatches } from '../src/v93ShopeeResumeResiliencePatch.js';
import { isTransientTransportError, queryBatchWithFallback } from '../src/trackBatching.js';

const patchUrl = new URL('../src/v93ShopeeResumeResiliencePatch.js', import.meta.url);
const batchingUrl = new URL('../src/trackBatching.js', import.meta.url);
const bootstrap = fs.readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');

function createBatchTable(db) {
  db.exec(`CREATE TABLE business_api_batches (
    businessType TEXT,reportDate TEXT,runId TEXT,apiName TEXT,batchKey TEXT,shipmentCodesJson TEXT,
    status TEXT,attemptCount INTEGER,resultCount INTEGER,errorMessage TEXT,createdAt TEXT,updatedAt TEXT,
    payloadHash TEXT,shipmentCount INTEGER,firstShipmentCode TEXT,lastShipmentCode TEXT,heartbeatAt TEXT,startedAt TEXT,completedAt TEXT,
    PRIMARY KEY (businessType,reportDate,runId,apiName,batchKey)
  )`);
}

test('V93 files are syntax-valid and loaded after V92 before server', () => {
  for (const url of [patchUrl, batchingUrl]) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(url)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  assert.match(bootstrap, /v93ShopeeResumeResiliencePatch/);
  assert.ok(bootstrap.indexOf('v93ShopeeResumeResiliencePatch') > bootstrap.indexOf('v92WhppTerminalAuthority'));
  assert.ok(bootstrap.indexOf('v93ShopeeResumeResiliencePatch') < bootstrap.indexOf("importPhase('server'"));
});

test('legacy numeric batch audit keys are payload-scoped so a resume subset cannot collide', () => {
  const db = new DatabaseSync(':memory:');
  createBatchTable(db);
  const insert = db.prepare(`INSERT INTO business_api_batches(
    businessType,reportDate,runId,apiName,batchKey,shipmentCodesJson,status,attemptCount,resultCount,errorMessage,createdAt,updatedAt,payloadHash,shipmentCount,firstShipmentCode,lastShipmentCode,heartbeatAt,startedAt,completedAt
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const fullCodes = Array.from({ length: 50 }, (_, i) => `S${String(i + 1).padStart(3, '0')}`);
  const fullHash = 'a'.repeat(64);
  insert.run('SHOPEE','2026-08-01','RUN1','tms-shipment-event-query','track-event:000001',JSON.stringify(fullCodes),'failed',1,0,'tls reset','','',fullHash,50,fullCodes[0],fullCodes.at(-1),'','','');

  const first = rekeyLegacyShopeeApiBatches(db, '2026-08-01');
  assert.equal(first.moved, 1);
  const firstKey = db.prepare("SELECT batchKey FROM business_api_batches WHERE runId='RUN1'").get().batchKey;
  assert.equal(firstKey, payloadScopedBatchKey('track-event:000001', fullHash, JSON.stringify(fullCodes)));

  const remaining = fullCodes.slice(33);
  const subsetHash = 'b'.repeat(64);
  insert.run('SHOPEE','2026-08-01','RUN1','tms-shipment-event-query','track-event:000001',JSON.stringify(remaining),'running',2,0,'','','',subsetHash,remaining.length,remaining[0],remaining.at(-1),'','','');
  const second = rekeyLegacyShopeeApiBatches(db, '2026-08-01');
  assert.equal(second.moved, 1);
  const keys = db.prepare("SELECT batchKey FROM business_api_batches WHERE runId='RUN1' ORDER BY batchKey").all().map(row => row.batchKey);
  assert.equal(keys.length, 2);
  assert.ok(keys.some(key => key.endsWith(`p${fullHash.slice(0, 12)}`)));
  assert.ok(keys.some(key => key.endsWith(`p${subsetHash.slice(0, 12)}`)));
  db.close();
});

test('the exact secure-TLS disconnect from production is classified as transient and retried automatically', async () => {
  const error = new Error('Client network socket disconnected before secure TLS connection was established');
  assert.equal(isTransientTransportError(error), true);
  let attempts = 0;
  const logs = [];
  const result = await queryBatchWithFallback({
    batch: ['A','B'],
    apiName: 'tms-shipment-event-query',
    fallbackSizes: [],
    transientRetries: 3,
    transientDelayMs: 1,
    onLog: async message => logs.push(message),
    query: async codes => {
      attempts += 1;
      if (attempts < 3) throw error;
      return codes.map(shipmentCode => ({ shipmentCode, eventCode: '26' }));
    }
  });
  assert.equal(attempts, 3);
  assert.equal(result.failures.length, 0);
  assert.equal(result.successes.length, 1);
  assert.ok(logs.some(message => message.includes('网络/TLS瞬断')));
});

test('SHOPEE track API still adaptively splits 50-waybill failures even when the legacy caller passes fallbackSizes empty', async () => {
  const bills = Array.from({ length: 50 }, (_, i) => `T${String(i + 1).padStart(3, '0')}`);
  const calls = [];
  const result = await queryBatchWithFallback({
    batch: bills,
    apiName: 'tms-shipment-event-query',
    fallbackSizes: [],
    transientRetries: 0,
    onLog: async () => {},
    query: async codes => {
      calls.push(codes.length);
      if (codes.length > 10) throw new Error('remote batch too large');
      return codes.map(shipmentCode => ({ shipmentCode, eventCode: '26' }));
    }
  });
  assert.equal(result.failures.length, 0);
  assert.equal(result.successes.flatMap(item => item.batch).length, 50);
  assert.ok(calls.includes(50));
  assert.ok(calls.includes(25));
  assert.ok(calls.some(size => size <= 10));
});
