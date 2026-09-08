import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import './v147TrackTimeoutConfig.js';
import './v51CarryDashboardPatch.js';
import './v98CarryRefreshEndpointPatch.js';
import './v105AsyncPurgePatch.js';
import './v132WhppFastIntegrationPatch.js';
import './v133ClosureRatePatch.js';
import './v134WhppRunSupervisorPatch.js';
import './v141WhppDailyRetryIsolationPatch.js';
import './v145SevenBusinessRetryCenterPatch.js';
import './v135WhppPartialSnapshotPatch.js';
import './v137WhppUnifiedBusinessStatePatch.js';
import './v153RangeZeroRecoveryPatch.js';
import './v152FactTruthPatch.js';
import './v152WhppTrendStatusPatch.js';
import './v171WhppDashboardParityPatch.js';
import './v172WhppDetailParityPatch.js';
import './v174PeriodExportContractPatch.js';
import './v183HistoricalStatusRefreshPatch.js';
import './v206InteractiveFirstRuntimePatch.js';
import './v441StatusSidecarSupervisor.js';
import './v461WhppHistoricalSurvivorDiagnosticPatch.js';
import './v462WhppSurvivorFastPatch.js';
import './v464WhppOfflineHistoryRecoveryPatch.js';

const PATCH_ID='2026-09-05-v433-unified-status-stability-loader-v1';
const V428_BASE_STATUS_LOADER_COMPAT='2026-09-05-v428-base-ccsl-status-owner-loader-v1';
const V411_STATUS_ENTRY_LOCK_LOADER_COMPAT='2026-09-01-v411-serialized-status-entry-lock-loader-v1';
const V375_CONTROL_REVISION='2026-08-30-v375-canonical-run-control-cache-bust-v1';
const V226_COMPAT_UI_BUILD='2026-08-22-v226-shared-client-ui-cache-bust-v1';
const GOLIVE_COMPAT_PATCH_ID='2026-08-18-v195-ipc-export-owner-shell-v1';
const SINGLE_RUNNER_UI_BUILD='2026-08-29-single-unified-runner-v1';
const PERSISTED_STATUS_BUILD='2026-09-02-v414-one-read-seven-business-status-v1';
const WHPP_PAGE_OWNER='V132';
const APP_PATHS=new Set(['/','/home','/ce','/ceaf','/tbkh','/ali1688','/shopeecn','/shopeevn','/whpp','/tracking','/exceptions','/reports','/import','/data-management','/settings','/logs']);
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const INDEX_FILE=path.resolve(__dirname,'..','public','index.html');
let injectedHtml='';

function buildInjectedHtml(){
  if(injectedHtml)return injectedHtml;
  const raw=fs.readFileSync(INDEX_FILE,'utf8');
  const source=raw.replace('/dashboard-v18.js?v=20260806-2','/dashboard-v18.js?v=20260817-v166-1');
  const withStyle=source.replace('</head>','  <script src="/v65-request-coalescing.js?v=20260814-3"></script>\n  <script src="/v125-local-api-resilience.js?v=20260814-1"></script>\n  <script src="/v67-resilient-run-guard.js?v=20260904-v424-1" data-legacy-src="/v67-resilient-run-guard.js?v=20260902-v414-explicit-1"></script>\n  <link rel="stylesheet" href="/dashboard-title-dedup.css?v=20260810-1">\n</head>');
  injectedHtml=withStyle.replace('</body>','  <script src="/routing-v48.js?v=20260823-v239-1"></script>\n  <script src="/v49-dashboard-correctness.js?v=20260811-2"></script>\n  <script src="/v50-dashboard-source-truth.js?v=20260812-2"></script>\n  <script>window.__CE_QC_HOME_CLASSIFICATION_OWNER__=\'V64\';</script>\n  <script src="/v51-runtime-fix.js?v=20260904-v426-2"></script>\n  <script src="/v54-whpp-unified-integration.js?v=20260812-9"></script>\n  <script src="/v106-v55-observer-pause.js?v=20260814-1"></script>\n  <script src="/v55-dashboard-reconciliation.js?v=20260811-6"></script>\n  <script src="/v106-v55-observer-restore.js?v=20260814-1"></script>\n  <script src="/v55-home-drilldown.js?v=20260811-2"></script>\n  <script src="/v56-trend-truth.js?v=20260811-2"></script>\n  <script src="/v58-drilldown-runtime.js?v=20260811-4"></script>\n  <script src="/v61-drilldown-route-bridge.js?v=20260811-1"></script>\n  <script src="/v64-whpp-total-kpi-integration.js?v=20260904-v426-3"></script>\n  <script src="/v68-whpp-classification-stability.js?v=20260904-v426-1"></script>\n  <script src="/v69-whpp-card-dedup.js?v=20260812-3"></script>\n  <script src="/v81-startup-source-truth.js?v=20260813-3"></script>\n  <script src="/v85-business-rule-ui.js?v=20260813-2"></script>\n  <script src="/v89-fast-dashboard.js?v=20260823-v239-1"></script>\n  <script src="/v94-business-source-truth-ui-v2.js?v=20260904-v426-1"></script>\n  <script src="/v138-ccsl-scan-progress.js?v=20260905-v427-1"></script>\n  <script src="/v139-carry-manual-window.js?v=20260816-3"></script>\n  <script src="/v142-history-integrity-audit.js?v=20260908-v460-1"></script>\n  <script src="/v461-whpp-survivor-diagnostic.js?v=20260908-v462-1"></script>\n  <script src="/v464-whpp-offline-history-recovery.js?v=20260908-v464-1"></script>\n  <script src="/v105-fast-render.js?v=20260814-2"></script>\n  <script src="/v109-instant-business-navigation.js?v=20260823-v239-1"></script>\n  <script src="/v140-current-business-truth.js?v=20260817-v166-1"></script>\n  <script src="/v233-current-outcome-truth.js?v=20260822-v233-1"></script>\n  <script src="/v108-route-lazy-features.js?v=20260818-v195-1"></script>\n  <script src="/v190-export-direct-route-client.js?v=20260818-v191-1"></script>\n  <script src="/v84-async-export-ui.js?v=20260818-v193-1"></script>\n  <script src="/v194-export-token-ui.js?v=20260818-v195-1"></script>\n  <script src="/v110-drilldown-prewarm.js?v=20260814-2"></script>\n  <script src="/v135-whpp-retry-aware-run.js?v=20260901-v403-1"></script>\n  <script src="/v141-whpp-retry-isolation-ui.js?v=20260816-7"></script>\n  <script src="/v146-unified-import-date-status.js?v=20260901-v410-1"></script>\n  <script src="/v132-whpp-seven-business-fast.js?v=20260902-display-only-2"></script>\n  <script src="/v137-whpp-unified-snapshot-view.js?v=20260815-2"></script>\n  <script src="/v133-closure-rate.js?v=20260823-v239-1"></script>\n  <script src="/v152-history-key-bridge.js?v=20260816-1"></script>\n  <script src="/v152-whpp-trend.js?v=20260817-v172-3"></script>\n  <script src="/v159-current-import-stability.js?v=20260902-v419-open-single-source-1"></script>\n  <script src="/v160-current-home-truth.js?v=20260904-v426-2"></script>\n  <script src="/v164-unified-pause-router.js?v=20260816-1"></script>\n  <script src="/v168-seven-business-status.js?v=20260902-v414-status-1"></script>\n  <script src="/v428-base-ccsl-status-owner.js?v=20260905-v428-1"></script>\n  <script src="/v169-seven-business-legacy-status-sync.js?v=20260907-v441-1" data-v433-src="/v169-seven-business-legacy-status-sync.js?v=20260905-v433-1" data-legacy-src="/v169-seven-business-legacy-status-sync.js?v=20260901-v411-1" data-previous-src="/v169-seven-business-legacy-status-sync.js?v=20260904-v424-1"></script>\n  <!-- compatibility-only historical loader signature: <script src="/v169-seven-business-legacy-status-sync.js?v=20260904-v424-1" -->\n  <script src="/v412-seven-business-convergence.js?v=20260904-v420-1" data-legacy-src="/v412-seven-business-convergence.js?v=20260901-v413-3"></script>\n  <script src="/v170-route-isolation-whpp-priority.js?v=20260901-v404-1"></script>\n  <script src="/v174-period-export-contract.js?v=20260817-v178-1"></script>\n  <script src="/v183-history-refresh.js?v=20260822-v226-1"></script>\n  <script src="/v206-interactive-first-hotfix.js?v=20260830-v377-1"></script>\n</body>');
  return injectedHtml;
}

function html(req,res,next){
  if(req.method!=='GET'||!APP_PATHS.has(req.path))return next();
  try{
    res.setHeader('X-CE-QC-UI-Build',PATCH_ID);
    res.setHeader('X-CE-QC-UI-Control',V375_CONTROL_REVISION);
    res.setHeader('X-CE-QC-UI-Compat',GOLIVE_COMPAT_PATCH_ID);
    res.setHeader('X-CE-QC-Unified-Runner',SINGLE_RUNNER_UI_BUILD);
    res.setHeader('X-CE-QC-Persisted-Status',PERSISTED_STATUS_BUILD);
    res.setHeader('X-CE-QC-WHPP-Page-Owner',WHPP_PAGE_OWNER);
    res.setHeader('X-CE-QC-V433-Status-Stability','2026-09-05-v433-v168-single-start-owner-v1');
    res.setHeader('X-CE-QC-V441-Status-Sidecar','2026-09-07-v441-isolated-readonly-status-sidecar-v1');
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma','no-cache');
    res.setHeader('Expires','0');
    res.type('html').send(buildInjectedHtml());
  }catch(error){next(error);}
}

const previousUse=express.application.use;
let installed=false;
express.application.use=function v206InteractiveFirstOwnerUse(...args){
  const candidates=args.flat().filter(value=>typeof value==='function');
  if(!installed&&candidates.some(fn=>fn.name==='serveStatic')){installed=true;previousUse.call(this,html);}
  return previousUse.apply(this,args);
};

export function inspectV178HtmlCache(){return {built:Boolean(injectedHtml),bytes:Buffer.byteLength(injectedHtml||'','utf8'),patchId:PATCH_ID,baseStatusLoaderCompat:V428_BASE_STATUS_LOADER_COMPAT,controlRevision:V375_CONTROL_REVISION,compatPatchId:GOLIVE_COMPAT_PATCH_ID,legacyUiBuild:V226_COMPAT_UI_BUILD,singleRunner:SINGLE_RUNNER_UI_BUILD,persistedStatus:PERSISTED_STATUS_BUILD,whppPageOwner:WHPP_PAGE_OWNER,statusEntryLockCompat:V411_STATUS_ENTRY_LOCK_LOADER_COMPAT};}
export const V44_WHPP_UI_PATCH_ID=PATCH_ID;