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
import './v152FactTruthPatch.js';
import './v152WhppTrendStatusPatch.js';

const PATCH_ID='2026-08-16-v136-run-start-unblock-v24+v137-whpp-unified-business-state-v1+v138-truthful-scan-progress-v1+v139-daily-carry-isolation-ui-v3+v140-current-business-truth-v1+v141-whpp-daily-retry-isolation-v1+v142-history-export-audit-v1+v145-seven-business-retry-center-v1+v146-unified-import-date-status-v1+v147-track-time-budget-v2+v148-direct-daily-runner-v1+v149-hotpath-isolation-v2+v152-multi-generation-fact-truth-v3';
const APP_PATHS=new Set(['/','/home','/ce','/ceaf','/tbkh','/ali1688','/shopeecn','/shopeevn','/whpp','/tracking','/exceptions','/reports','/import','/data-management','/settings','/logs']);
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const INDEX_FILE=path.resolve(__dirname,'..','public','index.html');
let injectedHtml='';

function buildInjectedHtml(){
  if(injectedHtml)return injectedHtml;
  const source=fs.readFileSync(INDEX_FILE,'utf8');
  const withStyle=source.replace('</head>','  <script src="/v65-request-coalescing.js?v=20260814-3"></script>\n  <script src="/v125-local-api-resilience.js?v=20260814-1"></script>\n  <script src="/v67-resilient-run-guard.js?v=20260816-8"></script>\n  <link rel="stylesheet" href="/dashboard-title-dedup.css?v=20260810-1">\n</head>');
  injectedHtml=withStyle.replace('</body>','  <script src="/whpp-v44.js?v=20260812-2"></script>\n  <script src="/whpp-v45-cleanup.js?v=20260811-2"></script>\n  <script src="/whpp-v47-auto-run.js?v=20260812-4"></script>\n  <script src="/routing-v48.js?v=20260811-2"></script>\n  <script src="/v49-dashboard-correctness.js?v=20260811-2"></script>\n  <script src="/v50-dashboard-source-truth.js?v=20260812-2"></script>\n  <script src="/v51-runtime-fix.js?v=20260812-3"></script>\n  <script src="/v52-whpp-source-truth-route.js?v=20260811-1"></script>\n  <script src="/v54-whpp-unified-integration.js?v=20260812-9"></script>\n  <script src="/v106-v55-observer-pause.js?v=20260814-1"></script>\n  <script src="/v55-dashboard-reconciliation.js?v=20260811-6"></script>\n  <script src="/v106-v55-observer-restore.js?v=20260814-1"></script>\n  <script src="/v55-home-drilldown.js?v=20260811-2"></script>\n  <script src="/v56-trend-truth.js?v=20260811-2"></script>\n  <script src="/v58-drilldown-runtime.js?v=20260811-4"></script>\n  <script src="/v61-drilldown-route-bridge.js?v=20260811-1"></script>\n  <script src="/v64-whpp-total-kpi-integration.js?v=20260812-2"></script>\n  <script src="/v68-whpp-classification-stability.js?v=20260812-4"></script>\n  <script src="/v69-whpp-card-dedup.js?v=20260812-3"></script>\n  <script src="/v72-whpp-light-state-bridge.js?v=20260812-1"></script>\n  <script src="/v81-startup-source-truth.js?v=20260813-3"></script>\n  <script src="/v85-business-rule-ui.js?v=20260813-2"></script>\n  <script src="/v89-fast-dashboard.js?v=20260813-2"></script>\n  <script src="/v94-business-source-truth-ui-v2.js?v=20260813-2"></script>\n  <script src="/v138-ccsl-scan-progress.js?v=20260816-2"></script>\n  <script src="/v139-carry-manual-window.js?v=20260816-3"></script>\n  <script src="/v142-history-integrity-audit.js?v=20260816-1"></script>\n  <script src="/v108-route-lazy-features.js?v=20260814-8"></script>\n  <script src="/v105-fast-render.js?v=20260814-2"></script>\n  <script src="/v109-instant-business-navigation.js?v=20260814-1"></script>\n  <script src="/v140-current-business-truth.js?v=20260816-4"></script>\n  <script src="/v110-drilldown-prewarm.js?v=20260814-2"></script>\n  <script src="/v103-home-whpp-card-guard.js?v=20260814-2"></script>\n  <script src="/v135-whpp-retry-aware-run.js?v=20260815-1"></script>\n  <script src="/v141-whpp-retry-isolation-ui.js?v=20260816-7"></script>\n  <script src="/v146-unified-import-date-status.js?v=20260816-1"></script>\n  <script src="/v132-whpp-seven-business-fast.js?v=20260814-2"></script>\n  <script src="/v137-whpp-unified-snapshot-view.js?v=20260815-2"></script>\n  <script src="/v133-closure-rate.js?v=20260814-1"></script>\n  <script src="/v152-history-key-bridge.js?v=20260816-1"></script>\n  <script src="/v152-whpp-trend.js?v=20260816-1"></script>\n</body>');
  return injectedHtml;
}

function html(req,res,next){
  if(req.method!=='GET'||!APP_PATHS.has(req.path))return next();
  try{
    res.setHeader('X-CE-QC-UI-Build',PATCH_ID);
    res.type('html').send(buildInjectedHtml());
  }catch(error){next(error);}
}

const previousUse=express.application.use;
let installed=false;
express.application.use=function v152FactTruthUiUse(...args){
  const candidates=args.flat().filter(value=>typeof value==='function');
  if(!installed&&candidates.some(fn=>fn.name==='serveStatic')){installed=true;previousUse.call(this,html);}
  return previousUse.apply(this,args);
};

export function inspectV135HtmlCache(){return {built:Boolean(injectedHtml),bytes:Buffer.byteLength(injectedHtml||'','utf8'),patchId:PATCH_ID};}
export const V44_WHPP_UI_PATCH_ID=PATCH_ID;