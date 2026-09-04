import { registerHooks } from 'node:module';

// Temporary compatibility redirect. Runtime implementations now live in the
// unversioned runtimePipeline/runtimeBusinessStore/runtimeStorage modules. This file
// exists only until server.js imports those owners directly; no business logic may be
// added here.
export const V314_MODULE_REDIRECT_ID='2026-08-27-v314-v340-server-throughput-storage-redirect-v3';
export const MODULE_REDIRECT_COMPAT_ID='system-module-redirect-compat-v1';
const INSTALL_KEY=Symbol.for('ce-qc.v314.module-redirect-installed');
const PIPELINE_URL=new URL('./runtimePipeline.js',import.meta.url).href;
const STORE_URL=new URL('./runtimeBusinessStore.js',import.meta.url).href;
const STORAGE_URL=new URL('./runtimeStorage.js',import.meta.url).href;

export function resolveV314Target(specifier='',parentURL=''){
  const parent=String(parentURL||'').replace(/\\/g,'/');
  if(parent.endsWith('/server.js')){
    if(specifier==='./src/pipeline.js')return PIPELINE_URL;
    if(specifier==='./src/businessStore.js')return STORE_URL;
    if(specifier==='./src/storage.js')return STORAGE_URL;
  }
  if(parent.endsWith('/src/carryoverRefreshScheduler.js')&&specifier==='./pipeline.js')return PIPELINE_URL;
  return'';
}

if(!globalThis[INSTALL_KEY]){
  if(typeof registerHooks!=='function')throw new Error('temporary module redirect requires node:module registerHooks support');
  registerHooks({
    resolve(specifier,context,nextResolve){
      const redirected=resolveV314Target(specifier,context?.parentURL||'');
      if(redirected)return{url:redirected,shortCircuit:true};
      return nextResolve(specifier,context);
    }
  });
  globalThis[INSTALL_KEY]=true;
  console.info('[CE-QC][MODULE_REDIRECT_COMPAT]',JSON.stringify({
    id:MODULE_REDIRECT_COMPAT_ID,legacyId:V314_MODULE_REDIRECT_ID,
    pipeline:'runtimePipeline.js',businessStore:'runtimeBusinessStore.js',storage:'runtimeStorage.js',
    policy:'COMPATIBILITY_ONLY_REMOVE_AFTER_DIRECT_SERVER_IMPORT'
  }));
}
