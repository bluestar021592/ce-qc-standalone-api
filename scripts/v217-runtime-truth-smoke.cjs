const fs=require('fs');
const {spawnSync}=require('child_process');
const must=(condition,message)=>{if(!condition)throw new Error(`V221 runtime stability smoke failed: ${message}`);};
const truth=fs.readFileSync('public/v217-runtime-truth.js','utf8');
const v160=fs.readFileSync('public/v160-current-home-truth.js','utf8');
const guard=fs.readFileSync('public/v214-home-whpp-identity-guard.js','utf8');
const v203=fs.readFileSync('public/v203-dashboard-integrity.js','utf8');
const v208=fs.readFileSync('public/v208-dashboard-final-guard.js','utf8');
const shell=fs.readFileSync('src/v44WhppUiPatch.js','utf8');
const bootstrap=fs.readFileSync('src/v43BootstrapPerfPatch.js','utf8');
const recovery=fs.readFileSync('src/v221BootstrapRecoveryPatch.js','utf8');
const v46=fs.readFileSync('src/v46ColdStartIndexPatch.js','utf8');
const staticCache=fs.readFileSync('src/v89StaticAssetCachePatch.js','utf8');
const authPreload=fs.readFileSync('src/v147TrackTimeoutConfig.js','utf8');
const authRuntimeRoot=fs.readFileSync('src/authStore.js','utf8');
const ownerPatch=fs.readFileSync('src/v220LocalOwnerAccessPatch.js','utf8');
const bootSource=fs.readFileSync('bootstrap.js','utf8');

must(truth.includes('V219_RUNTIME_STABILITY'),'missing passive runtime stability marker');
must(truth.includes('core bootstrap owns data; no startup database fan-out'),'passive-runtime ownership marker missing');
must(!truth.includes('recoverRuntimeTruth'),'retired heavy runtime recovery function must not return');
must(!truth.includes("jsonFetch('/api/unified-history"),'startup must not hydrate historical imports from the presentation guard');
must(!truth.includes('/api/business-state/'),'startup presentation guard must not fan out six business-state requests');
must(!truth.includes("jsonFetch('/api/state?compact=1"),'startup presentation guard must not duplicate CCSL bootstrap');
must(!truth.includes("jsonFetch('/api/shopee/state?compact=1"),'startup presentation guard must not duplicate SHOPEE bootstrap');
must(!truth.includes('renderAll('),'presentation guard must not trigger a second full dashboard render');
must(!truth.includes('new MutationObserver'),'runtime stability guard must not install a DOM MutationObserver');
must(truth.includes("localStorage.removeItem(WHPP_CACHE_KEY)"),'stale WHPP cache purge missing');
must(truth.includes('.home-admin-actions,.dashboard-range-toolbar{display:none!important}'),'duplicate home purge/range controls are not retired');
must(v160.includes('V160 provisional zero mutation disabled'),'V160 zero-overwrite retirement missing');
must(!v160.includes('ccslPlaceholder'),'legacy CCSL zero placeholder still active');
must(!v160.includes('shopeePlaceholder'),'legacy SHOPEE zero placeholder still active');
must(guard.includes('V219_UI_NAV_GUARD'),'passive navigation guard compatibility marker missing');
must(guard.includes('ensureWhppHomeCard'),'WHPP home-card restoration missing');
must(!guard.includes('new MutationObserver'),'WHPP/navigation guard must remain polling-free');
must(!guard.includes('loadV217'),'navigation guard must not dynamically inject duplicate runtime recovery');
must(shell.includes('/v217-runtime-truth.js?v=20260819-v219-passive-1'),'passive runtime asset is not directly injected');

// V221: V43 remains the compact bootstrap base, while V221 owns final recovery
// registration so old persisted QC facts can repopulate the UI without a reupload.
must(bootstrap.includes("pathValue === '/api/bootstrap'"),'V43 fast bootstrap base missing');
must(bootstrap.includes('CACHE_SUMMARY_ONLY'),'V43 cache-summary bootstrap mode missing');
must(recovery.includes("pathValue === '/api/bootstrap'"),'V221 recovery-aware bootstrap registration missing');
must(recovery.includes('PERSISTED_RECOVERY_SUMMARY'),'V221 persisted recovery response marker missing');
must(recovery.includes('canonicalStatus()'),'V221 canonical-first gate missing');
must(recovery.includes("tableExists('dashboard_daily_cache')"),'V221 durable dashboard-cache fallback missing');
must(recovery.includes("tableExists('v209_import_source_archive')"),'V221 raw source archive availability summary missing');
must(recovery.includes('session: { ok: true, user: publicUser(req.user), unreadNotifications: 0 }'),'V221 session must remain request-scoped');
must(!recovery.includes('v209/source-archive/status'),'bootstrap must not invoke archive hash verification on first paint');
must(v46.includes("import './v221BootstrapRecoveryPatch.js';"),'V221 must load immediately after V43 through V46');
const v43Pos=bootSource.indexOf("await importPhase('v43BootstrapPerfPatch'");
const v46Pos=bootSource.indexOf("await importPhase('v46ColdStartIndexPatch'");
must(v43Pos>=0&&v46Pos>v43Pos,'V46/V221 recovery bootstrap must load after V43 base');

// Managed Desktop can reach server.js through more than one startup path. The
// server's own authStore dependency must therefore install the identity/access
// bridge and both bootstrap registrations before server.js constructs the app.
const rawV209=authRuntimeRoot.indexOf("import './v209LoginReliabilityPatch.js';");
const rawV220=authRuntimeRoot.indexOf("import './v220LocalOwnerAccessPatch.js';");
const rawV43=authRuntimeRoot.indexOf("import './v43BootstrapPerfPatch.js';");
const rawV221=authRuntimeRoot.indexOf("import './v221BootstrapRecoveryPatch.js';");
must(rawV209>=0&&rawV220>rawV209&&rawV43>rawV220&&rawV221>rawV43,'raw server runtime root must preload identity/access, V43 bootstrap, then V221 recovery');

// V221 UI cleanup: old overlay loops remain retired.
must(v203.includes('V221_PASSIVE_UTILITIES'),'V203 duplicate home overlay was not retired');
must(!v203.includes('new MutationObserver'),'V203 must not install a document-wide observer');
must(!v203.includes('setInterval('),'V203 must not install permanent polling');
must(!v203.includes('v203AttemptPanel'),'V203 duplicate attempt panel must not return');
must(v208.includes('v221-retired-passive'),'V208 polling overlay was not retired');
must(!v208.includes('new MutationObserver'),'V208 must not install a document-wide observer');
must(!v208.includes('setInterval('),'V208 must not install permanent polling');
must(staticCache.includes('v203-dashboard-integrity|v208-dashboard-final-guard|v217-runtime-truth'),'volatile V221 runtime assets are not cache-bypassed');
must(staticCache.includes("'no-store, no-cache, must-revalidate'"),'volatile runtime assets must be no-store so repaired code is actually loaded');

// V213/5179 identity and localhost CE credential access boundaries.
must(authPreload.includes("import './v209LoginReliabilityPatch.js';"),'V213/5179 identity bridge is not preloaded before server registration');
must(authPreload.includes("import './v220LocalOwnerAccessPatch.js';"),'localhost CE credential access bridge is not preloaded before server registration');
must(ownerPatch.includes("pathValue === '/api/ce-login'"),'local owner patch does not cover CE login route middleware');
must(ownerPatch.includes("args[0] === '/api'"),'local owner patch does not cover global API write-role middleware');
must(ownerPatch.includes("req?.accessMode || '').toUpperCase() === 'LOCAL'"),'local owner bypass is not restricted to localhost access mode');
must(ownerPatch.includes('const authenticated = Boolean(req?.user'),'local CE credential access must require an authenticated user');
must(!ownerPatch.includes("=== 'LAN'"),'local owner bypass must not weaken LAN permissions');

for(const file of ['src/authStore.js','src/v220LocalOwnerAccessPatch.js','src/v221BootstrapRecoveryPatch.js','src/v89StaticAssetCachePatch.js','public/v203-dashboard-integrity.js','public/v208-dashboard-final-guard.js','public/v217-runtime-truth.js']){
  const syntax=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  must(syntax.status===0,`${file} syntax failed: ${syntax.stderr||syntax.stdout}`);
}
const rawRootImport=spawnSync(process.execPath,['--input-type=module','-e',"process.env.CE_QC_AUTH_SIDECAR_CHILD='1'; await import('./src/authStore.js'); console.log('V221_RAW_RUNTIME_ROOT_OK');"],{encoding:'utf8',env:{...process.env,CE_QC_AUTH_SIDECAR_CHILD:'1'}});
must(rawRootImport.status===0&&rawRootImport.stdout.includes('V221_RAW_RUNTIME_ROOT_OK'),`raw server runtime preload import failed: ${rawRootImport.stderr||rawRootImport.stdout}`);
const preloadPos=bootSource.indexOf("await importPhase('v147TrackTimeoutConfig'");
const serverImportPos=bootSource.indexOf('await importServerInteractiveFirst();');
must(preloadPos>=0&&serverImportPos>preloadPos,'auth/access preload module must execute before server.js import');
console.log('[V221] runtime stability smoke passed: raw server and bootstrap paths both preload identity, CE reconnect, compact bootstrap and persisted recovery without reupload.');