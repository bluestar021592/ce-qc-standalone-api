import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveV294Attempt, resolveV294SigningDays } from '../src/v294AttemptSigningTruth.js';

const event = (eventCode, eventTime, desc = '') => ({ eventCode, eventTime, rawJson: JSON.stringify({ eventCode, eventTime, trackingEventDescZh: desc }) });

const attempt2 = resolveV294Attempt({
  pod: true,
  podDate: '2026-08-05',
  events: [
    event('70', '2026-08-01 09:00:00', 'Parcel start to deliver'),
    event('70', '2026-08-01 10:00:00', 'Repeated START'),
    event('150', '2026-08-01 18:00:00', 'Pending delivery failed'),
    event('70', '2026-08-02 09:00:00', 'Parcel start to deliver'),
    event('80', '2026-08-05 12:00:00', 'Successfully delivered')
  ]
});
assert.equal(attempt2.attemptNo, 2, 'new attempt requires failure before a new START');

const repeatedStart = resolveV294Attempt({
  pod: true,
  podDate: '2026-08-05',
  events: [
    event('70', '2026-08-01 09:00:00'),
    event('70', '2026-08-02 09:00:00'),
    event('80', '2026-08-05 12:00:00')
  ]
});
assert.equal(repeatedStart.attemptNo, 1, 'repeated START without failure is one attempt');

const fallback60 = resolveV294Attempt({
  pod: true,
  podDate: '2026-08-05',
  events: [
    event('60', '2026-08-01 09:00:00'),
    event('150', '2026-08-01 18:00:00', 'Pending'),
    event('60', '2026-08-02 09:00:00'),
    event('80', '2026-08-05 12:00:00')
  ]
});
assert.equal(fallback60.attemptNo, 2, '60 is fallback only when there is no 70');

const noGuess = resolveV294Attempt({ pod: true, podDate: '2026-08-10', events: [] });
assert.equal(noGuess.attemptNo, 0, 'elapsed days must never be guessed as attempt count');
assert.equal(noGuess.proven, false);
assert.equal(resolveV294SigningDays('2026-08-01', '2026-08-05'), 5, 'signing days use inclusive natural days');

const exportSource = fs.readFileSync(new URL('../src/v225ExportReturnTruth.js', import.meta.url), 'utf8');
const runtimeSource = fs.readFileSync(new URL('../src/v294PostProcessAttemptBackfillPatch.js', import.meta.url), 'utf8');
assert.match(exportSource, /applyV294ExportAttemptSigningTruth/);
assert.match(exportSource, /\['TBKH','SHOPEECN','SHOPEEVN'\]/);
assert.match(runtimeSource, /backfillV294StrictAttemptsFromSavedEvidence/);
assert.match(runtimeSource, /\/api\/shopee\/run\/start/);
assert.match(runtimeSource, /\/api\/run\/start/);

console.log('[V294] attempt/signing parity smoke passed · TBKH + SHOPEE use strict START/failure cycles, no day-count attempt guessing, export uses global lifecycle truth');
