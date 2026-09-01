import './v316BatchPolicyPreload.js';
import './v314ModuleRedirectPatch.js';
import './v315OperationalDataRefreshPatch.js';
import './v338CcslBatchPolicyRestore.js';
import './v303StoragePolicy.js';
import './v303AuthorizedCleanStartPatch.js';
import './v375UnifiedImportMetadataPatch.js';
import './v311ShopeeIncompleteRecoveryPatch.js';
import './v317CcslIncompleteRecoveryPatch.js';
import './v203CeafFastBusinessStatePatch.js';
import './v204CeafInstantRoutePatch.js';
import './v294CleanReuploadIntegrity.js';
import './v294PostProcessAttemptBackfillPatch.js';
import './v294CarryoverSchedulerActivation.js';
import './v295FirstAttemptRoutePatch.js';
import './v295FirstAttemptInvalidationPatch.js';
import './v322WebAvailabilityPatch.js';
import './v308DeliveryDailyFastPath.js';
import './v308DashboardReadBridgeInjection.js';
import './v334GenericTrendRoutePatch.js';
import './v319TrendCacheFastPatch.js';
import './v295FirstAttemptUiInjectionPatch.js';

// Historical archive replay and the old V284 priority repair were useful while
// migrating legacy databases, but they must not run during ordinary startup.
// In particular V284PriorityUnprovenRefresh can call the CE APIs for old dates;
// that made a completed installation keep "reading" history after every restart.
// Maintenance remains available only through an explicit opt-in environment flag.
export const V147_LEGACY_MAINTENANCE_POLICY_ID='2026-09-01-completed-dates-no-startup-api-refresh-v1';
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

// Historical export kept for compatibility with existing activation/smoke gates.
export const V147_TRACK_TIMEOUT_CONFIG_ID = '2026-08-16-v147-track-time-budget-v2';
export const V305_SHOPEE_FAST_BATCH_POLICY_ID = '2026-08-25-v305-shopee-fast-bounded-batch-v1';

// SHOPEE event/exception endpoints remain fixed at 50 tickets so no parcel is
// silently skipped and no unsupported large request is introduced. The old
// policy allowed one bad 50-ticket batch to occupy as much as 135 seconds and
// three transport retries, which made a 4k-5k ticket day look frozen even while
// checkpoints were still advancing. V305 keeps per-waybill failure checkpoints
// but fails a genuinely slow batch forward much sooner. V338 preloads and then
// re-asserts the CCSL 350-scan/50-track policy after the legacy V315 module and
// before scheduler/server pipeline evaluation.
if (!process.env.REQUEST_TIMEOUT_MS) process.env.REQUEST_TIMEOUT_MS = '12000';
if (!process.env.CE_TRACK_BATCH_BUDGET_MS) process.env.CE_TRACK_BATCH_BUDGET_MS = '25000';
if (!process.env.CE_TRANSIENT_RETRIES) process.env.CE_TRANSIENT_RETRIES = '1';
if (!process.env.CE_TRANSIENT_RETRY_DELAY_MS) process.env.CE_TRANSIENT_RETRY_DELAY_MS = '400';

console.log('[CE-QC][V305_SHOPEE_FAST_BATCH]',JSON.stringify({
  id:V305_SHOPEE_FAST_BATCH_POLICY_ID,
  requestTimeoutMs:process.env.REQUEST_TIMEOUT_MS,
  batchBudgetMs:process.env.CE_TRACK_BATCH_BUDGET_MS,
  transientRetries:process.env.CE_TRANSIENT_RETRIES,
  retryDelayMs:process.env.CE_TRANSIENT_RETRY_DELAY_MS,
  batchSize:50,
  policy:'FAIL_FORWARD_TO_RETRY_CENTER_NO_TICKET_DROP'
}));