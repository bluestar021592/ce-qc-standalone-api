import { replayV283LegacyDecoratedHash, V283_PRIORITY_REPORT_DATE } from './v283LegacyDecoratedHashReplay.js';

export const V283_LEGACY_HASH_RETRY_ID = '2026-08-24-v283-post-evidence-seed-retry-v1';

if (process.env.NODE_ENV !== 'test' && !process.env.CI) {
  const timer = setTimeout(() => {
    void replayV283LegacyDecoratedHash(V283_PRIORITY_REPORT_DATE).catch(error => {
      console.error('[CE-QC][V283_LEGACY_HASH_RETRY_FATAL]', JSON.stringify({
        reportDate: V283_PRIORITY_REPORT_DATE,
        error: error?.message || String(error)
      }));
    });
  }, 45_000);
  timer.unref?.();
}

console.info('[CE-QC][V283_LEGACY_HASH_RETRY]', V283_LEGACY_HASH_RETRY_ID, `priority=${V283_PRIORITY_REPORT_DATE}`, 'bounded second replay after V266 evidence seeding; already-canonical/repaired batches are skipped safely.');
