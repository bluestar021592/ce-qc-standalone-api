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

const PATCH_ID='2026-08-27-v334-canonical-detail-history-owner-cache-bust-v1';
// Retained as a source-compatibility token for the stable go-live gate.
const V226_COMPAT_UI_BUILD='2026-08-22-v226-shared-client-ui-cache-bust-v1';
const GOLIVE_COMPAT_PATCH_ID='2026-08-18-v195-ipc-export-owner-shell-v1';
const APP_PATHS=new Set(['/','/home','/ce','/ceaf','/tbkh','/ali1688','/shopeecn','/shopeevn','/whpp','/tracking','/exceptions','/reports','/import','/data-management','/settings','/logs']);
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const INDEX_FILE=path.resolve(__dirname,'..','public','index.html');
let injectedHtml='';

function buildInjectedHtml(){
  if(injectedHtml)return injectedHtml;
  const raw=fs.readFileSync(INDEX_FILE,'utf8');
  const source=raw.replace('/dashboard-v18.js?v=20260806-2','/dashboard-v18.js?v=20260817-v166-1');
  const withStyle=source.replace('</head>','  <script src="/v65-request-coalescing.js?v=20260814-3"></script>\n  <script src="/v125-local-api-resilience.js?v=20260814-1"></script>\n  <script src="/v67-resilient-run-guard.js?v=20260817-1"></script>\n  <link rel="stylesheet" href="/dashboard-title-dedup.css?v=20260810-1">\n</head>');
  injectedHtml=withStyle.replace('</body>','  <script src="/whpp-v44.js?v=20260812-2"></script>\n  <script src="/whpp-v45-cleanup.js?v=20260811-2"></script>\n  <script src="/whpp-v47-auto-run.js?v=20260812-4"></script>\n  <script src="/routing-v48.js?v=20260823-v239-1"></script>\n  <script src="/v49-dashboard-correctness.js?v=20260811-2"></script>\n  <script src="/v50-dashboard-source-truth.js?v=20260812-2"></script>\n  <script src="/v51-runtime-fix.js?v=20260812-3"></script>\n  <script src="/v52-whpp-source-truth-route.js?v=20260811-1"></script>\n  <script src="/v54-whpp-unified-integration.js?v=20260812-9"></script>\n  <script src="/v106-v55-observer-pause.js?v=20260814-1"></script>\n  <script src="/v55-dashboard-reconciliation.js?v=20260811-6"></script>\n  <script src="/v106-v55-observer-restore.js?v=20260814-1"></script>\n  <script src="/v55-home-drilldown.js?v=20260811-2"></script>\n  <script src="/v56-trend-truth.js?v=20260811-2"></script>\n  <script src="/v58-drilldown-runtime.js?v=20260811-4"></script>\n  <script src="/v61-drilldown-route-bridge.js?v=20260811-1"></script>\n  <script src="/v64-whpp-total-kpi-integration.js?v=20260812-2"></script>\n  <script src="/v68-whpp-classification-stability.js?v=20260822-v217-1"></script>\n  <script src="/v69-whpp-card-dedup.js?v=20260812-3"></script>\n  <script src="/v72-whpp-light-state-bridge.js?v=20260812-1"></script>\n  <script src="/v81-startup-source-truth.js?v=20260813-3"></script>\n  <script src="/v85-business-rule-ui.js?v=20260813-2"></script>\n  <script src="/v89-fast-dashboard.js?v=20260823-v239-1"></script>\n  <script src="/v94-business-source-truth-ui-v2.js?v=20260813-2"></script>\n  <script src="/v138-ccsl-scan-progress.js?v=20260827-v334-1"></script>\n  <script src="/v139-carry-manual-window.js?v=20260816-3"></script>\n  <script src="/v142-history-integrity-audit.js?v=20260816-1"></script>\n  <script src="/v105-fast-render.js?v=20260814-2"></script>\n  <script src="/v109-instant-business-navigation.js?v=20260823-v239-1"></script>\n  <script src="/v140-current-business-truth.js?v=20260817-v166-1"></script>\n  <script src="/v233-current-outcome-truth.js?v=20260822-v233-1"></script>\n  <script src="/v108-route-lazy-features.js?v=20260818-v195-1"></script>\n  <script src="/v190-export-direct-route-client.js?v=20260818-v191-1"></script>\n  <script src="/v84-async-export-ui.js?v=20260818-v193-1"></script>\n  <script src="/v194-export-token-ui.js?v=20260818-v195-1"></script>\n  <script src="/v110-drilldown-prewarm.js?v=20260814-2"></script>\n  <script src="/v103-home-whpp-card-guard.js?v=20260814-2"></script>\n  <script src="/v135-whpp-retry-aware-run.js?v=20260815-1"></script>\n  <script src="/v141-whpp-retry-isolation-ui.js?v=20260816-7"></script>\n  <script src="/v146-unified-import-date-status.js?v=20260816-1"></script>\n  <script src="/v132-whpp-seven-business-fast.js?v=20260817-v173-1"></script>\n  <script src="/v137-whpp-unified-snapshot-view.js?v=20260815-2"></script>\n  <script src="/v133-closure-rate.js?v=20260823-v239-1"></script>\n  <script src="/v152-history-key-bridge.js?v=20260816-1"></script>\n  <script src="/v152-whpp-trend.js?v=20260817-v172-3"></script>\n  <script src="/v159-current-import-stability.js?v=20260816-1"></script>\n  <script src="/v160-current-home-truth.js?v=20260816-1"></script>\n  <script src="/v164-unified-pause-router.js?v=20260816-1"></script>\n  <script src="/v168-seven-business-status.js?v=20260827-v333-1"></script>\n  <script src="/v169-seven-business-legacy-status-sync.js?v=20260827-v333-1"></script>\n  <script src="/v170-route-isolation-whpp-priority.js?v=20260817-1"></script>\n  <script src="/v174-period-export-contract.js?v=20260817-v178-1"></script>\n  <script src="/v183-history-refresh.js?v=20260822-v226-1"></script>\n  <script src="/v206-interactive-first-hotfix.js?v=20260821-v207-1"></script>\n</body>');
  return injectedHtml;
}

function html(req,res,next){
  if(req.method!=='GET'||!APP_PATHS.has(req.path))return next();
  try{
    res.setHeader('X-CE-QC-UI-Build',PATCH_ID);
    res.setHeader('X-CE-QC-UI-Compat',GOLIVE_COMPAT_PATCH_ID);
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

export function inspectV178HtmlCache(){return {built:Boolean(injectedHtml),bytes:Buffer.byteLength(injectedHtml||'','utf8'),patchId:PATCH_ID,compatPatchId:GOLIVE_COMPAT_PATCH_ID,legacyUiBuild:V226_COMPAT_UI_BUILD};}
export const V44_WHPP_UI_PATCH_ID=PATCH_ID;
