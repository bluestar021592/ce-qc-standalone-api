import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createUnifiedThroughputClient, splitFixedBatches } from '../src/v314ShopeeThroughputCore.js';
import { queryTrackBatchWithFallback } from '../src/trackBatching.js';
import { WHPP_THROUGHPUT_POLICY_ID } from '../src/whppPipeline.js';

for (const file of ['src/whppPipeline.js','src/v314ShopeeThroughputCore.js','src/trackBatching.js']) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}
assert.match(WHPP_THROUGHPUT_POLICY_ID, /whpp-independent-350-scan-50x4-evidence/);

const source = fs.readFileSync('src/whppPipeline.js', 'utf8');
assert.match(source, /const CONFIRM_BATCH_SIZE = 350/);
assert.match(source, /state\.scanPool = allBills/);
assert.match(source, /createUnifiedThroughputClient\(state, client, \{/);
assert.match(source, /businessType: 'WHPP'/);
assert.match(source, /confirmConcurrency: 1/);
assert.match(source, /trackConcurrency: 4/);
assert.match(source, /exceptionConcurrency: 4/);
assert.match(source, /query: codes => throughputClient\.confirmQuery\(codes\)/);
assert.match(source, /query: codes => throughputClient\.trackQuery\(codes\)/);
assert.match(source, /query: codes => throughputClient\.exceptionQuery\(codes\)/);
assert.match(source, /\['85','100'\]\.includes/,'POD and return must be scan-side terminal');
assert.match(source, /orderStatus \?\? ''\)\.trim\(\) === '10'/,'cancelled order must be scan-side terminal');
assert.match(source, /!scanTerminal\.has\(bill\).*scanStatuses\.get\(bill\)\?\.status === 'success'.*!podLocks\.has\(bill\)/s,'only successful nonterminal non-POD-lock bills may enter tracking');
assert.match(source, /const needException = cleanCodes\(\[\.\.\.needTrack, \.\.\.cancelledByScan\]\)/,'cancelled WHPP bills may get exception enrichment without entering tracking');

// WHPP confirm-query: exact 350-ticket planning and a single remote lane.
{
  const bills = Array.from({ length: 700 }, (_, i) => `WHPP-C-${String(i + 1).padStart(4, '0')}`);
  let active = 0, maxActive = 0;
  const calls = [];
  const raw = { async confirmQuery(codes) {
    calls.push([...codes]);
    active += 1; maxActive = Math.max(maxActive, active);
    assert.ok(codes.length <= 350);
    await new Promise(resolve => setTimeout(resolve, 12));
    active -= 1;
    return codes.map(shipmentCode => ({ shipmentCode, orderStatus: 70 }));
  }};
  const state = { businessType: 'WHPP', scanPool: bills, pnhBills: bills, scanQueryStatus: [] };
  const client = createUnifiedThroughputClient(state, raw, { businessType: 'WHPP', confirmConcurrency: 1, hardBudgetMs: 1000 });
  for (const batch of splitFixedBatches(bills, 350)) await client.confirmQuery(batch);
  assert.deepEqual(calls.map(batch => batch.length), [350, 350]);
  assert.equal(maxActive, 1, 'WHPP confirm-query must stay on one remote lane');
}

// WHPP track-query: remove already-successful waybills first, then prefetch exact
// compact-pending 50-ticket boundaries with real bounded x4 concurrency.
{
  const bills = Array.from({ length: 270 }, (_, i) => `WHPP-T-${String(i + 1).padStart(4, '0')}`);
  const done = bills.slice(0, 20);
  const pending = bills.slice(20);
  let active = 0, maxActive = 0;
  const calls = [];
  const raw = { async trackQuery(codes) {
    calls.push([...codes]);
    active += 1; maxActive = Math.max(maxActive, active);
    assert.ok(codes.length <= 50);
    await new Promise(resolve => setTimeout(resolve, 25));
    active -= 1;
    return codes.map(shipmentCode => ({ shipmentCode }));
  }};
  const state = { businessType: 'WHPP', needTrackBills: bills, eventQueryStatus: done.map(shipmentCode => ({ shipmentCode, status: 'success' })) };
  const client = createUnifiedThroughputClient(state, raw, { businessType: 'WHPP', trackConcurrency: 4 });
  const expected = splitFixedBatches(pending, 50);
  const started = performance.now();
  for (const batch of expected) await client.trackQuery(batch);
  const elapsed = performance.now() - started;
  assert.equal(maxActive, 4, 'WHPP track-query must actually reach bounded x4');
  assert.deepEqual(calls.map(batch => batch.join('|')).sort(), expected.map(batch => batch.join('|')).sort());
  assert.equal(new Set(calls.flat()).size, pending.length, 'WHPP track resume must not duplicate successful or pending waybills');
  assert.ok(done.every(code => !calls.flat().includes(code)), 'already-successful WHPP track tickets must never be queried again');
  assert.ok(elapsed < 120, `WHPP 5x25ms track batches should prefetch x4, got ${elapsed.toFixed(1)}ms`);
}

// WHPP exception evidence has a wider membership than tracking because confirmed
// cancellation (orderStatus=10) still needs reason enrichment. Its prefetch source
// must therefore be needExceptionBills, not merely needTrackBills.
{
  const track = Array.from({ length: 180 }, (_, i) => `WHPP-E-T-${String(i + 1).padStart(4, '0')}`);
  const cancelled = Array.from({ length: 80 }, (_, i) => `WHPP-E-C-${String(i + 1).padStart(4, '0')}`);
  const needException = [...track, ...cancelled];
  let active = 0, maxActive = 0;
  const calls = [];
  const raw = { async exceptionQuery(codes) {
    calls.push([...codes]);
    active += 1; maxActive = Math.max(maxActive, active);
    assert.ok(codes.length <= 50);
    await new Promise(resolve => setTimeout(resolve, 20));
    active -= 1;
    return codes.map(shipmentCode => ({ shipmentCode }));
  }};
  const state = { businessType: 'WHPP', needTrackBills: track, needExceptionBills: needException, exceptionQueryStatus: [] };
  const client = createUnifiedThroughputClient(state, raw, { businessType: 'WHPP', exceptionConcurrency: 4 });
  const expected = splitFixedBatches(needException, 50);
  for (const batch of expected) await client.exceptionQuery(batch);
  assert.equal(maxActive, 4, 'WHPP exception-item-query must actually reach bounded x4');
  assert.deepEqual(calls.map(batch => batch.join('|')).sort(), expected.map(batch => batch.join('|')).sort());
  const queried = new Set(calls.flat());
  assert.ok(cancelled.every(code => queried.has(code)), 'cancelled WHPP tickets must receive exception enrichment');
}

// A failed 50-ticket WHPP tracking batch may degrade to 25/10/5/1, but every child
// must remain inside the same x4 owner even while future 50-ticket work is prefetched.
{
  const bills = Array.from({ length: 250 }, (_, i) => `WHPP-F-${String(i + 1).padStart(4, '0')}`);
  let active = 0, maxActive = 0, failedParent = false;
  const sizes = [];
  const raw = { async trackQuery(codes) {
    sizes.push(codes.length);
    active += 1; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 8));
    active -= 1;
    if (!failedParent && codes.length === 50 && codes[0] === bills[0]) {
      failedParent = true;
      throw new Error('synthetic WHPP parent failure');
    }
    return codes.map(shipmentCode => ({ shipmentCode }));
  }};
  const state = { businessType: 'WHPP', needTrackBills: bills, eventQueryStatus: [] };
  const client = createUnifiedThroughputClient(state, raw, { businessType: 'WHPP', trackConcurrency: 4 });
  const outcome = await queryTrackBatchWithFallback({
    batch: bills.slice(0, 50),
    query: codes => client.trackQuery(codes),
    transientRetries: 0,
    batchTimeBudgetMs: 1500,
    apiName: 'whpp-track-query'
  });
  assert.equal(outcome.failures.length, 0);
  assert.equal(outcome.successes.flatMap(item => item.batch).length, 50);
  assert.ok(sizes.includes(25), 'failed WHPP 50-ticket track batch must exercise fallback');
  assert.ok(maxActive <= 4, `WHPP fallback must never exceed x4, observed ${maxActive}`);
}

console.log('[V346] WHPP throughput smoke passed · independent third stage · scan=350x1 · track=50x4 · exception=50x4 · terminals excluded · resume exact · fallback bounded');
