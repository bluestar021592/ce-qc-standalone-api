import 'dotenv/config';

import { closeDb } from './db.js';
import {
  getDashboardCacheStatus,
  markDashboardCacheDirty,
  refreshDashboardCacheDate,
  refreshDashboardCacheDirty
} from './rangeDashboardStore.js';

const args = process.argv.slice(2);
const valueAfter = flag => {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] || '').trim() : '';
};

const reportDate = valueAfter('--date');
const reason = valueAfter('--reason') || (reportDate ? 'EVENT_REFRESH' : 'SCHEDULED_REFRESH');

try {
  let result;
  if (reportDate) {
    markDashboardCacheDirty(reportDate, reason);
    result = refreshDashboardCacheDate(reportDate, { force: true });
  } else {
    result = refreshDashboardCacheDirty({ limit: 16, recentDays: 14 });
  }
  process.stdout.write(`${JSON.stringify({ ok: true, reason, result, cache: getDashboardCacheStatus() })}\n`);
  closeDb();
  process.exit(0);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, reason, error: error?.message || String(error) })}\n`);
  try { closeDb(); } catch {}
  process.exit(1);
}
