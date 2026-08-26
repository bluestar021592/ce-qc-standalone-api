import './v314ModuleRedirectPatch.js';
import './v315OperationalDataRefreshPatch.js';
import './v303StoragePolicy.js';
import './v303AuthorizedCleanStartPatch.js';
import './v311ShopeeIncompleteRecoveryPatch.js';
import './v203CeafFastBusinessStatePatch.js';
import './v204CeafInstantRoutePatch.js';
import './v294CleanReuploadIntegrity.js';
import './v294PostProcessAttemptBackfillPatch.js';
import './v294CarryoverSchedulerActivation.js';
import './v295FirstAttemptRoutePatch.js';
import './v295FirstAttemptInvalidationPatch.js';
import './v308DeliveryDailyFastPath.js';
import './v308DashboardReadBridgeInjection.js';
import './v295FirstAttemptUiInjectionPatch.js';

const RECOVERY_SAFE_MODE=String(process.env.CE_QC_RECOVERY_SAFE_MODE||'')==='1';
if(!RECOVERY_SAFE_MODE){
  await import('./v283LegacyDecoratedHashReplay.js');
  await import('./v283LegacyDecoratedHashReplayRetry.js');
  await import('./v284DailyMembershipAudit.js');
  await import('./v284PriorityUnprovenRefresh.js');
}else{
  console.log('[CE-QC][RECOVERY_SAFE_MODE] V283 archive replay + V284 startup audit/priority refresh skipped on automatic startup; persisted database state is unchanged.');
}

// Historical export kept for compatibility with existing activation/smoke gates.
export const V147_TRACK_TIMEOUT_CONFIG_ID = '2026-08-16-v147-track-time-budget-v2';
export const V305_SHOPEE_FAST_BATCH_POLICY_ID = '2026-08-25-v305-shopee-fast-bounded-batch-v1';

// SHOPEE event/exception endpoints remain fixed at 50 tickets so no parcel is
// silently skipped and no unsupported large request is introduced. The old
// policy allowed one bad 50-ticket batch to occupy as much as 135 seconds and
// three transport retries, which made a 4k-5k ticket day look frozen even while
// checkpoints were still advancing. V305 keeps per-waybill failure checkpoints
// but fails a genuinely slow batch forward much sooner: 15s/request, one retry,
// 45s total batch budget. Failed tickets stay in the retry center and therefore
// are not lost from the daily-report denominator or later reconciliation.
if (!process.env.REQUEST_TIMEOUT_MS) process.env.REQUEST_TIMEOUT_MS = '15000';
if (!process.env.CE_TRACK_BATCH_BUDGET_MS) process.env.CE_TRACK_BATCH_BUDGET_MS = '45000';
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