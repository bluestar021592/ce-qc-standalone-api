import test from 'node:test';
import assert from 'node:assert/strict';
import { queryBatchWithFallback, queryTrackBatchWithFallback } from '../src/trackBatching.js';

const bills = count => Array.from({ length: count }, (_, index) => `CC${String(index + 1).padStart(10, '0')}`);

test('350 scan bills split after batch failure without re-querying successful children', async () => {
  const attempts = [];
  const input = bills(350);
  const result = await queryBatchWithFallback({
    batch: input,
    fallbackSizes: [100, 50, 10, 1],
    query: async batch => {
      attempts.push([...batch]);
      if (batch.length > 100) throw new Error('upstream batch rejected');
      return batch.map(shipmentCode => ({ shipmentCode, orderStatus: 85 }));
    }
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.successes.flatMap(item => item.batch).length, 350);
  assert.deepEqual(attempts.map(batch => batch.length), [350, 100, 100, 100, 50]);
});

test('only unrecoverable single bill remains in scan retry', async () => {
  const input = bills(101);
  const broken = input[73];
  const result = await queryBatchWithFallback({
    batch: input,
    fallbackSizes: [100, 50, 10, 1],
    query: async batch => {
      if (batch.length > 50 || batch.includes(broken)) throw new Error('partial upstream failure');
      return batch.map(shipmentCode => ({ shipmentCode, orderStatus: 85 }));
    }
  });

  assert.deepEqual(result.failures.flatMap(item => item.batch), [broken]);
  assert.equal(result.successes.flatMap(item => item.batch).length, 100);
});

test('authentication pause is not split into more requests', async () => {
  let calls = 0;
  const authError = Object.assign(new Error('auth expired'), { runStatus: 'PAUSED_AUTH' });
  await assert.rejects(() => queryBatchWithFallback({
    batch: bills(50),
    fallbackSizes: [10, 1],
    query: async () => { calls += 1; throw authError; }
  }), error => error === authError);
  assert.equal(calls, 1);
});

test('track socket hang up retries the same batch automatically before fallback', async () => {
  const input = bills(10);
  const attempts = [];
  const logs = [];
  let first = true;
  const result = await queryTrackBatchWithFallback({
    batch: input,
    onLog: async message => logs.push(message),
    query: async batch => {
      attempts.push(batch.length);
      if (first) {
        first = false;
        throw new Error('track query失败：socket hang up');
      }
      return batch.map(shipmentCode => ({ shipmentCode, eventCode: '150' }));
    }
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.successes.flatMap(item => item.batch).length, 10);
  assert.deepEqual(attempts, [10, 10]);
  assert.ok(logs.some(message => message.includes('网络瞬断')));
});

test('persistent track failure isolates 10-waybill batch down to one bill', async () => {
  const input = bills(10);
  const broken = input[6];
  const attempts = [];
  const result = await queryTrackBatchWithFallback({
    batch: input,
    query: async batch => {
      attempts.push([...batch]);
      if (batch.includes(broken)) throw new Error('track query失败：socket hang up');
      return batch.map(shipmentCode => ({ shipmentCode, eventCode: '150' }));
    }
  });

  assert.deepEqual(result.failures.flatMap(item => item.batch), [broken]);
  assert.equal(result.successes.flatMap(item => item.batch).length, 9);
  assert.ok(attempts.some(batch => batch.length === 5));
  assert.ok(attempts.some(batch => batch.length === 1 && batch[0] === broken));
});
