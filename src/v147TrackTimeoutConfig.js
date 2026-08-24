import './v203CeafFastBusinessStatePatch.js';
import './v204CeafInstantRoutePatch.js';
import './v283LegacyDecoratedHashReplay.js';
import './v283LegacyDecoratedHashReplayRetry.js';
import './v284DailyMembershipAudit.js';
import './v284PriorityUnprovenRefresh.js';

export const V147_TRACK_TIMEOUT_CONFIG_ID = '2026-08-16-v147-track-time-budget-v2';

// Keep SHOPEE event/exception queries in fixed 50-ticket batches, but do not
// treat a merely slow CE response as a failure too early. One request may wait
// up to 30 seconds; the whole fixed batch still has a hard wall-clock budget so
// a genuinely bad batch cannot freeze thousands of later waybills. The retry
// policy still keeps at least three transient retries and never restores the
// old 50 -> 25 -> 10 -> 5 -> 1 split behavior for SHOPEE.
if (!process.env.REQUEST_TIMEOUT_MS) process.env.REQUEST_TIMEOUT_MS = '30000';
if (!process.env.CE_TRACK_BATCH_BUDGET_MS) process.env.CE_TRACK_BATCH_BUDGET_MS = '135000';
if (!process.env.CE_TRANSIENT_RETRIES) process.env.CE_TRANSIENT_RETRIES = '3';
