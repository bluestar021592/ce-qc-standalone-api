import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import './v51CarryDashboardPatch.js';

const PATCH_ID='2026-08-12-v72-whpp-light-runtime-inject-v46';
const APP_PATHS=new Set(['/','/home','/ce','/ceaf','/tbkh','/ali1688','/shopeecn','/shopeevn','/whpp','/tracking','/exceptions','/reports','/import','/data-management','/settings','/logs']);
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const INDEX_FILE=path.resolve(__dirname,'..','public','index.html');

function html(req,res,next){
  if(req.method!=='GET'||!APP_PATHS.has(req.path))return next();
  try{
    const source=fs.readFileSync(INDEX_FILE,'utf8');
    const withStyle=source.replace('</head>','  <script src="/v65-request-coalescing.js?v=20260812-1"></script>\n  <script src="/v67-resilient-run-guard.js?v=20260812-1"></script>\n  <link rel="stylesheet" href="/dashboard-title-dedup.css?v=20260810-1">\n</head>');
    const injected=withStyle.replace('</body>','  <script src="/whpp-v44.js?v=20260812-1"></script>\n  <script src="/whpp-v45-cleanup.js?v=20260811-2"></script>\n  <script src="/whpp-v47-auto-run.js?v=20260812-3"></script>\n  <script src="/routing-v48.js?v=20260811-2"></script>\n  <script src="/v49-dashboard-correctness.js?v=20260811-2"></script>\n  <script src="/v50-dashboard-source-truth.js?v=20260811-1"></script>\n  <script src="/v51-runtime-fix.js?v=20260812-2"></script>\n  <script src="/v52-whpp-source-truth-route.js?v=20260811-1"></script>\n  <script src="/v54-whpp-unified-integration.js?v=20260812-8"></script>\n  <script src="/v55-dashboard-reconciliation.js?v=20260811-6"></script>\n  <script src="/v55-home-drilldown.js?v=20260811-2"></script>\n  <script src="/v56-trend-truth.js?v=20260811-2"></script>\n  <script src="/v58-drilldown-runtime.js?v=20260811-4"></script>\n  <script src="/v61-drilldown-route-bridge.js?v=20260811-1"></script>\n  <script src="/v62-network-settings-runtime.js?v=20260812-1"></script>\n  <script src="/v64-whpp-total-kpi-integration.js?v=20260812-2"></script>\n  <script src="/v66-import-success-whpp.js?v=20260812-1"></script>\n  <script src="/v68-whpp-classification-stability.js?v=20260812-4"></script>\n  <script src="/v69-whpp-card-dedup.js?v=20260812-3"></script>\n  <script src="/v72-whpp-light-state-bridge.js?v=20260812-1"></script>\n</body>');
    res.type('html').send(injected);
  }catch(error){next(error);}
}

const previousUse=express.application.use;
let installed=false;
express.application.use=function v44WhppUiUse(...args){
  const candidates=args.flat().filter(value=>typeof value==='function');
  if(!installed&&candidates.some(fn=>fn.name==='serveStatic')){
    installed=true;
    previousUse.call(this,html);
  }
  return previousUse.apply(this,args);
};

export const V44_WHPP_UI_PATCH_ID=PATCH_ID;
