# CE QC interactive stability core

This change is a structural read-path correction, not a rollback to an older application version. The Aug-22 build is used only as evidence that the same machine/database class once delivered a responsive user experience; current business rules and later correctness fixes remain in place.

## Confirmed degradation pattern

The production database is multi-GB. The intended single-day path in `rangeDashboardStoreV320.js` is already cache-only, but the public final wrapper immediately followed that cached result with row-level normalization queries over `unified_import_rows` plus `final_rows` / `business_final_rows`. That defeated the cache and made ordinary current-day page reads compete with the full shipment database.

V386 dirty-cache invalidation is a separate safety contract and is intentionally preserved. A date marked dirty must not continue serving stale derived rows after a restart, so `getDashboardCacheStatus()` may remove only the derived `dashboard_cache_dates` / `dashboard_daily_cache` rows for those dirty dates. It does not delete business facts. The structural problem was what happened after such a cache miss: the interactive request could continue into the heavyweight row-level final-normalization path, turning a safe cache invalidation into a multi-GB request-time scan.

## Structural correction

- Current/single-day dashboard reads are routed through the existing V320 cache-only owner and never enter row-level final-normalization SQL during the interactive request.
- A missing/dirty single-day derived cache remains bounded; it no longer falls through into the V402 shipment-level final-normalization scans.
- Explicit multi-day history/report ranges retain the existing final normalization path until those counters are fully precomputed.
- V386 dirty-cache safety remains intact and only touches derived cache tables.
- No business facts, snapshots, ledgers, schema, or imported daily reports are rewritten.
- No CE API scan or trajectory rerun is required.

## Follow-up architecture

The longer-term target is to precompute every final-normalization counter into `dashboard_daily_cache` during the existing derived-cache refresh, so current and historical summary reads stay bounded while exact business rules remain available without request-time shipment scans. This should replace request-time recalculation rather than add another wrapper layer.
