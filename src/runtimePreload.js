import { applyStoragePolicy, STORAGE_POLICY_ID } from './storagePolicy.js';

export const RUNTIME_PRELOAD_ID='system-runtime-preload-v1';
export const V147_LEGACY_MAINTENANCE_POLICY_ID='2026-09-01-completed-dates-no-startup-api-refresh-v1';
export const V147_TRACK_TIMEOUT_CONFIG_ID='2026-08-16-v147-track-time-budget-v2';
export const V305_SHOPEE_FAST_BATCH_POLICY_ID='2026-08-25-v305-shopee-fast-bounded-batch-v1';

// Core storage ownership must be established before any legacy runtime module is
// evaluated. This replaces V303 as a path owner; V303 may remain only as a temporary
// compatibility shim until the repository-wide audit proves no external test/import
// still references it.
const storageLayout=applyStoragePolicy();
console.log('[CE-QC][CORE_STORAGE_POLICY_READY]',JSON.stringify({
  runtimePreload:RUNTIME_PRELOAD_ID,
  storagePolicy:STORAGE_POLICY_ID,
  dataRoot:storageLayout.dataRoot,
  runtimeRoot:storageLayout.runtimeRoot,
  database:storageLayout.dbFile
}));

// Keep evaluation order explicit. The previous v147 file used a long static import
// stack, which made ownership hard to audit and allowed path/runtime side effects to
// be hidden inside dependency evaluation. The compatibility modules are still loaded
// for now, but this unversioned coordinator is the single startup owner while they are
// being folded into core modules one by one.
await import('./v316BatchPolicyPreload.js');
await import('./v314ModuleRedirectPatch.js');
await import('./v315OperationalDataRefreshPatch.js');
await import('./v338CcslBatchPolicyRestore.js');
await import('./v303AuthorizedCleanStartPatch.js');
await import('./v375UnifiedImportMetadataPatch.js');
await import('./v311ShopeeIncompleteRecoveryPatch.js');
await import('./v317CcslIncompleteRecoveryPatch.js');
await import('./v203CeafFastBusinessStatePatch.js');
await import('./v204CeafInstantRoutePatch.js');
await import('./v294CleanReuploadIntegrity.js');
await import('./v294PostProcessAttemptBackfillPatch.js');
await import('./v294CarryoverSchedulerActivation.js');
await import('./v295FirstAttemptRoutePatch.js');
await import('./v295FirstAttemptInvalidationPatch.js');
await import('./v322WebAvailabilityPatch.js');
await import('./v308DeliveryDailyFastPath.js');
await import('./v308DashboardReadBridgeInjection.js');
await import('./v334GenericTrendRoutePatch.js');
await import('./v319TrendCacheFastPatch.js');
await import('./v295FirstAttemptUiInjectionPatch.js');

const RECOVERY_SAFE_MODE=String(process.env.CE_QC_RECOVERY_SAFE_MODE||'')==='1';
const LEGACY_HISTORY_MAINTENANCE=String(process.env.CE_QC_LEGACY_HISTORY_MAINTENANCE||'')==='1';
if(!RECOVERY_SAFE_MODE&&LEGACY_HISTORY_MAINTENANCE){
  await import('./v283LegacyDecoratedHashReplay.js');
  await import('./v283LegacyDecoratedHashReplayRetry.js');
  await import('./v284DailyMembershipAudit.js');
  await import('./v284PriorityUnprovenRefresh.js');
  console.log('[CE-QC][LEGACY_HISTORY_MAINTENANCE] explicit maintenance enabled; legacy replay/audit/priority repair may access saved historical evidence and CE APIs.');
}else{
  console.log('[CE-QC][COMPLETED_HISTORY_READ_ONLY_STARTUP]',V147_LEGACY_MAINTENANCE_POLICY_ID,'legacy V283 replay + V284 audit/API priority refresh disabled on normal startup; completed dates stay SQLite/cache read-only.');
}

// Canonical read-only CE pipeline budgets. Track/exception retries now have one
// owner in trackBatching.js; these variables tune that owner rather than creating
// another nested retry loop in CEClient.
if(!process.env.REQUEST_TIMEOUT_MS)process.env.REQUEST_TIMEOUT_MS='12000';
if(!process.env.CE_TRACK_BATCH_BUDGET_MS)process.env.CE_TRACK_BATCH_BUDGET_MS='25000';
if(!process.env.CE_TRANSIENT_RETRIES)process.env.CE_TRANSIENT_RETRIES='1';
if(!process.env.CE_TRANSIENT_RETRY_DELAY_MS)process.env.CE_TRANSIENT_RETRY_DELAY_MS='400';

console.log('[CE-QC][CORE_RUNTIME_PRELOAD]',JSON.stringify({
  id:RUNTIME_PRELOAD_ID,
  legacyTrackPolicy:V147_TRACK_TIMEOUT_CONFIG_ID,
  legacyShopeePolicy:V305_SHOPEE_FAST_BATCH_POLICY_ID,
  requestTimeoutMs:Number(process.env.REQUEST_TIMEOUT_MS),
  trackBatchBudgetMs:Number(process.env.CE_TRACK_BATCH_BUDGET_MS),
  transientRetries:Number(process.env.CE_TRANSIENT_RETRIES),
  retryDelayMs:Number(process.env.CE_TRANSIENT_RETRY_DELAY_MS),
  trackBatchSize:50,
  trackConcurrency:4,
  retryOwner:'trackBatching',
  policy:'UNVERSIONED_STARTUP_COORDINATOR_SINGLE_STORAGE_OWNER_SINGLE_TRACK_RETRY_OWNER'
}));
