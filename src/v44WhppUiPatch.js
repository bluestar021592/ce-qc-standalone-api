import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

export const CORE_UI_LOADER_ID='system-route-aware-ui-loader-v1';
export const CORE_UI_LOADER_REVISION='system-route-aware-ui-loader-v2';
const PATCH_ID='2026-09-02-consolidated-persisted-status-loader-v1';
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
  const withStyle=source.replace('</head>',[
    '  <script src="/v65-request-coalescing.js?v=20260814-3"></script>',
    '  <script src="/v125-local-api-resilience.js?v=20260814-1"></script>',
    '  <script src="/v67-resilient-run-guard.js?v=20260904-v424-1" data-legacy-src="/v67-resilient-run-guard.js?v=20260902-v414-explicit-1"></script>',
    '  <link rel="stylesheet" href="/dashboard-title-dedup.css?v=20260810-1">',
    '</head>'
  ].join('\n'));
  // Consolidation: one browser loader owns all route-specific compatibility scripts.
  // Critical status/first-paint scripts load immediately; trend/drilldown/history helpers
  // are deferred until the browser is idle and never block the first dashboard render.
  injectedHtml=withStyle.replace('</body>','  <script src="/runtime-loader.js?v=system-runtime-loader-v2"></script>\n</body>');
  return injectedHtml;
}

function html(req,res,next){
  if(req.method!=='GET'||!APP_PATHS.has(req.path))return next();
  try{
    res.setHeader('X-CE-QC-UI-Build',PATCH_ID);
    res.setHeader('X-CE-QC-Core-UI-Loader',CORE_UI_LOADER_ID);
    res.setHeader('X-CE-QC-Core-UI-Loader-Revision',CORE_UI_LOADER_REVISION);
    res.setHeader('X-CE-QC-UI-Control',V375_CONTROL_REVISION);
    res.setHeader('X-CE-QC-UI-Compat',GOLIVE_COMPAT_PATCH_ID);
    res.setHeader('X-CE-QC-Unified-Runner',SINGLE_RUNNER_UI_BUILD);
    res.setHeader('X-CE-QC-Persisted-Status',PERSISTED_STATUS_BUILD);
    res.setHeader('X-CE-QC-WHPP-Page-Owner',WHPP_PAGE_OWNER);
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma','no-cache');
    res.setHeader('Expires','0');
    res.type('html').send(buildInjectedHtml());
  }catch(error){next(error);}
}

const previousUse=express.application.use;
let installed=false;
express.application.use=function coreInteractiveFirstOwnerUse(...args){
  const candidates=args.flat().filter(value=>typeof value==='function');
  if(!installed&&candidates.some(fn=>fn.name==='serveStatic')){installed=true;previousUse.call(this,html);}
  return previousUse.apply(this,args);
};

export function inspectV178HtmlCache(){return {built:Boolean(injectedHtml),bytes:Buffer.byteLength(injectedHtml||'','utf8'),patchId:PATCH_ID,coreUiLoader:CORE_UI_LOADER_ID,coreUiLoaderRevision:CORE_UI_LOADER_REVISION,controlRevision:V375_CONTROL_REVISION,compatPatchId:GOLIVE_COMPAT_PATCH_ID,legacyUiBuild:V226_COMPAT_UI_BUILD,singleRunner:SINGLE_RUNNER_UI_BUILD,persistedStatus:PERSISTED_STATUS_BUILD,whppPageOwner:WHPP_PAGE_OWNER,statusEntryLockCompat:V411_STATUS_ENTRY_LOCK_LOADER_COMPAT};}
export const V44_WHPP_UI_PATCH_ID=PATCH_ID;