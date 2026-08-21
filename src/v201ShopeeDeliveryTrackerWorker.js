import { closeDb } from './db.js';
import { runShopeeDeliveryTrackerSync } from './v201ShopeeDeliveryTrackerScheduler.js';

const reason = String(process.argv[2] || 'BACKGROUND_WORKER');
try {
  const result = await runShopeeDeliveryTrackerSync({ reason });
  console.log('[CE-QC][V201_SHOPEE_TRACKER_WORKER_DONE]', JSON.stringify(result));
  if (result?.ok === false) process.exitCode = 1;
} catch (error) {
  console.error('[CE-QC][V201_SHOPEE_TRACKER_WORKER_FAILED]', error?.stack || error);
  process.exitCode = 1;
} finally {
  try { closeDb(); } catch {}
}
