# CE QC interactive stability core

This change is a structural read-path correction, not a rollback to an older application version.

## Confirmed degradation pattern

The current production database is multi-GB. The intended single-day path in `rangeDashboardStoreV320.js` is cache-only, but the public final wrapper immediately followed that result with row-level normalization queries over `unified_import_rows` plus `final_rows` / `business_final_rows`. That defeated the cache and made normal page reads compete with the full database.

Separately, `getDashboardCacheStatus()` was mutating derived cache state: `/api/health` could invalidate/delete dirty dashboard cache rows while merely answering a health probe. The browser calls health probing when another request is already failing, so the failure path could remove the fast-path cache and amplify the slowdown.

## Structural correction

- Current/single-day dashboard reads are routed through the existing V320 cache-only owner and never enter row-level final-normalization SQL during the interactive request.
- Explicit multi-day history/report ranges retain the existing final normalization path.
- Health/cache status is read-only. Cache invalidation remains on explicit write/maintenance paths.
- No business facts, snapshots, ledgers, schema, or imported daily reports are rewritten.
- No CE API scan or trajectory rerun is required.

## Follow-up architecture

The longer-term target is to precompute every final-normalization counter into `dashboard_daily_cache` during the existing derived-cache refresh, so current and historical summary reads stay bounded while exact business rules remain available without request-time shipment scans.
