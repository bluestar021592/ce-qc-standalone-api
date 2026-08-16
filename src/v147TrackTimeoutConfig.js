export const V147_TRACK_TIMEOUT_CONFIG_ID = '2026-08-16-v147-track-time-budget-v1';

// A remote CE query must never hold the entire daily pipeline for 45s per
// attempt and then recursively repeat that wait at 50 -> 25 -> 10 -> 5 -> 1.
// The retry policy still performs at least three transient retries, while the
// shared request timeout bounds each individual network wait. Operators can
// override these values explicitly through the environment when necessary.
if (!process.env.REQUEST_TIMEOUT_MS) process.env.REQUEST_TIMEOUT_MS = '20000';
if (!process.env.CE_TRACK_BATCH_BUDGET_MS) process.env.CE_TRACK_BATCH_BUDGET_MS = '90000';
if (!process.env.CE_TRANSIENT_RETRIES) process.env.CE_TRANSIENT_RETRIES = '3';
