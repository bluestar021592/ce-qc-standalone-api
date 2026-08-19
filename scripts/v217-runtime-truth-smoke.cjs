const fs=require('fs');
const must=(condition,message)=>{if(!condition)throw new Error(`V220 runtime stability smoke failed: ${message}`);};
const truth=fs.readFileSync('public/v217-runtime-truth.js','utf8');
const v160=fs.readFileSync('public/v160-current-home-truth.js','utf8');
const guard=fs.readFileSync('public/v214-home-whpp-identity-guard.js','utf8');
const shell=fs.readFileSync('src/v44WhppUiPatch.js','utf8');
const bootstrap=fs.readFileSync('src/v43BootstrapPerfPatch.js','utf8');
const authPreload=fs.readFileSync('src/v147TrackTimeoutConfig.js','utf8');
const bootSource=fs.readFileSync('bootstrap.js','utf8');
must(truth.includes('V219_RUNTIME_STABILITY'),'missing V219 passive runtime stability marker');
must(truth.includes('core bootstrap owns data; no startup database fan-out'),'V219 passive-runtime ownership marker missing');
must(!truth.includes('recoverRuntimeTruth'),'retired heavy runtime recovery function must not return');
must(!truth.includes("jsonFetch('/api/unified-history"),'startup must not hydrate historical imports from the presentation guard');
must(!truth.includes('/api/business-state/'),'startup presentation guard must not fan out six business-state requests');
must(!truth.includes("jsonFetch('/api/state?compact=1"),'startup presentation guard must not duplicate CCSL bootstrap');
must(!truth.includes("jsonFetch('/api/shopee/state?compact=1"),'startup presentation guard must not duplicate SHOPEE bootstrap');
must(!truth.includes('renderAll('),'presentation guard must not trigger a second full dashboard render');
must(!truth.includes('new MutationObserver'),'runtime stability guard must not install a DOM MutationObserver');
must(truth.includes("localStorage.removeItem(WHPP_CACHE_KEY)"),'stale WHPP cache purge missing');
must(v160.includes('V160 provisional zero mutation disabled'),'V160 zero-overwrite retirement missing');
must(!v160.includes('ccslPlaceholder'),'legacy CCSL zero placeholder still active');
must(!v160.includes('shopeePlaceholder'),'legacy SHOPEE zero placeholder still active');
must(guard.includes('V219_UI_NAV_GUARD'),'passive navigation guard missing');
must(!guard.includes('loadV217'),'navigation guard must not dynamically inject duplicate runtime recovery');
must(shell.includes('/v217-runtime-truth.js?v=20260819-v219-passive-1'),'V219 passive runtime asset is not directly injected');
must(bootstrap.includes("pathValue === '/api/bootstrap'"),'V43 fast bootstrap route ownership missing');
must(bootstrap.includes('CACHE_SUMMARY_ONLY'),'V43 cache-summary bootstrap mode missing');
must(bootstrap.includes('session: { ok: true, user: publicUser(req.user), unreadNotifications: 0 }'),'bootstrap must carry authenticated request identity');
must(bootstrap.includes('simpleHistory(60)'),'bootstrap must use bounded lightweight history instead of hydrated 120-day history');
// V220 critical ordering gate: the 5179 sidecar session bridge must be loaded
// before server.js registers accessIdentity. Otherwise login succeeds on 5179
// but every 5177 API call is treated as unauthenticated and the UI collapses to
// zero/local-viewer fallback state.
must(authPreload.includes("import './v209LoginReliabilityPatch.js';"),'V213/5179 identity bridge is not preloaded before server registration');
const preloadPos=bootSource.indexOf("importPhase('v147TrackTimeoutConfig'");
const serverPos=bootSource.indexOf("importServerInteractiveFirst()");
must(preloadPos>=0&&serverPos>preloadPos,'auth preload module must execute before server.js import');
console.log('[V220] runtime stability smoke passed: V43 is sole startup data owner and V213/5179 identity bridge is installed before server registration.');