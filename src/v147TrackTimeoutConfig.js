import './v209LoginReliabilityPatch.js';

export const V147_TRACK_TIMEOUT_CONFIG_ID = '2026-08-19-v220-auth-before-server-v1';

// IMPORTANT: this module is imported by bootstrap before server.js.
// Loading v209LoginReliabilityPatch here guarantees the V213/5179 fast-session
// identity bridge is installed before server.js registers accessIdentity.
// Without this ordering, the browser can successfully authenticate on 5179 but
// every 5177 API request still looks unauthenticated, leaving the dashboard at
// zero, the user label as a local VIEWER fallback, and CE login/settings writes
// unusable.

// Keep SHOPEE event/exception queries in fixed 50-ticket batches, but do not
// treat a merely slow CE response as a failure too early. One request may wait
// up to 30 seconds; the whole fixed batch still has a hard wall-clock budget so
// a genuinely bad batch cannot freeze thousands of later waybills. The retry
// policy still keeps at least three transient retries and never restores the
// old 50 -> 25 -> 10 -> 5 -> 1 split behavior for SHOPEE.
if (!process.env.REQUEST_TIMEOUT_MS) process.env.REQUEST_TIMEOUT_MS = '30000';
if (!process.env.CE_TRACK_BATCH_BUDGET_MS) process.env.CE_TRACK_BATCH_BUDGET_MS = '135000';
if (!process.env.CE_TRANSIENT_RETRIES) process.env.CE_TRANSIENT_RETRIES = '3';