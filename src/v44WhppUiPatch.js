import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const PATCH_ID='2026-08-10-v44-whpp-native-ui-inject-v4';
const APP_PATHS=new Set(['/','/home','/ce','/ceaf','/tbkh','/ali1688','/shopeecn','/shopeevn','/whpp','/tracking','/exceptions','/reports','/import','/data-management','/settings','/logs']);
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const INDEX_FILE=path.resolve(__dirname,'..','public','index.html');

function html(req,res,next){
  if(req.method!=='GET'||!APP_PATHS.has(req.path))return next();
  try{
    const source=fs.readFileSync(INDEX_FILE,'utf8');
    const injected=source.replace('</body>','  <script src="/whpp-v44.js?v=20260810-4"></script>\n  <script src="/whpp-v45-cleanup.js?v=20260810-1"></script>\n</body>');
    res.type('html').send(injected);
  }catch(error){next(error);}
}

const previousUse=express.application.use;
let installed=false;
express.application.use=function v44WhppUiUse(...args){
  const candidates=args.flat().filter(value=>typeof value==='function');
  if(!installed&&candidates.some(fn=>fn.name==='serveStatic')){
    installed=true;
    // Register before express.static so /whpp is a first-class SPA entry point,
    // even though the legacy server route list does not contain /whpp.
    previousUse.call(this,html);
  }
  return previousUse.apply(this,args);
};

export const V44_WHPP_UI_PATCH_ID=PATCH_ID;
