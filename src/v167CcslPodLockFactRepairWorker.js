import { closeDb, getDb } from './db.js';
import { repairLatestCcslPodLockFacts } from './v167CcslPodLockFactRepair.js';

try {
  const result = repairLatestCcslPodLockFacts(getDb());
  console.log('[CE-QC][V214_CCSL_POD_LOCK_REPAIR_WORKER_DONE]', JSON.stringify(result));
} catch (error) {
  console.error('[CE-QC][V214_CCSL_POD_LOCK_REPAIR_WORKER_FAILED]', error?.stack || error);
  process.exitCode = 1;
} finally {
  try { closeDb(); } catch {}
}
