import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

for(const file of ['src/v89StaticAssetCachePatch.js','src/exportJobAtomicJson.js','public/dashboard-fixture-v18.js','public/v14-geometry-fixture.js','public/v304-unified-upload-owner.js','public/v592-early-sidebar-capture.js','public/v581-stable-shell-owner.js','src/v581StableShellResponsePatch.js']){
  const checked=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(checked.status,0,`${file} syntax failed: ${checked.stderr||checked.stdout}`);
}
const source=fs.readFileSync('src/v89StaticAssetCachePatch.js','utf8');
const atomic=fs.readFileSync('src/exportJobAtomicJson.js','utf8');
const startup=fs.readFileSync('public/dashboard-fixture-v18.js','utf8');
const v14=fs.readFileSync('public/v14-geometry-fixture.js','utf8');
const v304=fs.readFileSync('public/v304-unified-upload-owner.js','utf8');
const earlySidebar=fs.readFileSync('public/v592-early-sidebar-capture.js','utf8');
const stableShell=fs.readFileSync('public/v581-stable-shell-owner.js','utf8');
const stableResponse=fs.readFileSync('src/v581StableShellResponsePatch.js','utf8');
const indexHtml=fs.readFileSync('public/index.html','utf8');
const purgeConsole=fs.readFileSync('public/purge-console.html','utf8');
const server=fs.readFileSync('server.js','utf8');
assert.match(source,/2026-09-08-v480-preauth-static-first-paint-v1/);
assert.match(source,/const V480_PUBLIC_ASSET_RE=\/\\\.\(\?:css\|js\|svg\|png\|jpe\?g\|webp\|gif\|ico\|woff2\?\)\$\/i/,'V480 whitelist must be explicit non-HTML browser assets only');
assert.match(source,/express\.static\('public',\{index:false,fallthrough:true,redirect:false,maxAge:0\}\)/,'V480 must never expose index.html through the pre-auth static server');
assert.match(source,/candidates\.some\(fn => fn\.name === 'accessIdentity'\)/,'V480 must install immediately before accessIdentity registration');
assert.match(source,/originalUse\.call\(this, v480FirstPaintAsset\)/,'V480 pre-auth asset middleware must be registered before the auth middleware itself');
assert.match(source,/X-CE-QC-V480-First-Paint/);
assert.doesNotMatch(source,/V480_PUBLIC_ASSET_RE[^\n]*(?:html|json)/i,'V480 pre-auth whitelist must not include HTML or JSON');
assert.match(source,/return originalUse\.apply\(this, args\)/,'existing Express middleware ownership must remain intact');
assert.match(atomic,/2026-09-08-v480-export-parent-liveness-v1/);
assert.match(atomic,/CE_QC_EXPORT_SIDECAR_CHILD/);
assert.match(atomic,/CE_QC_EXPORT_WORKER_MODE/);
assert.match(atomic,/process\.kill\(pid,0\)/,'export children must probe direct-parent liveness without touching unrelated Node processes');
assert.match(atomic,/process\.exit\(86\)/,'orphan export child must release itself when its parent disappears');
assert.match(atomic,/timer\.unref\?\.\(\)/,'parent watchdog must not keep a completed export process alive');
assert.doesNotMatch(atomic,/taskkill|Stop-Process/i,'V480 parent watch must never kill unrelated processes by name or broad process scan');

assert.match(startup,/2026-09-14-v533-first-paint-bounded-startup-read-v1/,'V533 startup guard must be shipped by the earliest dashboard script');
assert.match(startup,/2026-09-14-v535-interactive-first-paint-body-bounded-v1/,'V535 compatibility marker must remain shipped');
assert.match(startup,/2026-09-21-v564-startup-interaction-no-toast-v1/,'V564 compatibility clickability marker must remain shipped');
assert.match(startup,/2026-09-21-v565-interaction-surface-self-heal-v1/,'V565 self-healing interaction owner must ship in the earliest dashboard script');
assert.match(startup,/const STARTUP_TIMEOUT_MS = 3000;/,'startup reads must have a short finite budget');
assert.match(startup,/pathname === '\/api\/bootstrap'/,'startup guard must bound the primary bootstrap read');
assert.match(startup,/pathname\.startsWith\('\/api\/business-state\/'\)/,'startup guard must bound exact-business startup reads');
assert.match(startup,/method !== 'GET'/,'startup guard must never intercept writes');
assert.match(startup,/init\?\.signal/,'startup guard must preserve explicitly-owned request cancellation');
assert.match(startup,/controller\.abort\(\)/,'startup guard must actively release a timed-out browser request');
assert.match(startup,/V533_STARTUP_READ_TIMEOUT/,'header timeout must fail one read without hanging the page');
assert.match(startup,/forceFirstPaint\(\)/,'startup guard must make the static shell visible before app bootstrap completes');
assert.match(startup,/function forceInteractivePaint\(\)/,'V564 must make the shell interactive independently of refresh');
assert.match(startup,/function repairInteractionSurface\(\)/,'V565 must continuously reassert the real clickable shell during bounded startup');
assert.match(startup,/document\.elementsFromPoint/,'V565 must inspect actual hit-testing rather than guessing from visual state');
assert.match(startup,/ceQcRetiredClickBlocker/,'V565 must retire only detected large stale click blockers');
assert.match(startup,/global\.addEventListener\('pointerdown', repairBlockedPointer, true\)/,'V565 must capture pointerdown before later legacy document handlers');
assert.match(startup,/global\.addEventListener\('click', repairBlockedPointer, true\)/,'V565 must capture click before later legacy document handlers');
assert.doesNotMatch(startup,/系统界面已可操作，本地数据继续后台读取/,'V564 must not display the misleading startup toast');
assert.doesNotMatch(startup,/typeof global\.renderAll === 'function'/,'startup click guard must never trigger a second renderAll pass');
assert.doesNotMatch(startup,/typeof global\.refresh === 'function'/,'startup click guard must never launch an automatic rescue refresh');
assert.match(startup,/does NOT clear the startup timer here/,'V535 must keep the timeout armed after response headers arrive');
assert.doesNotMatch(startup,/\/api\/admin\/data-purge|\/api\/import\/unified-daily-report/i,'first-paint guard must not own destructive or import endpoints');
assert.doesNotMatch(startup,/method\s*:\s*['"`](?:POST|PUT|PATCH|DELETE)['"`]/i,'first-paint guard must not create write requests');
assert.doesNotMatch(startup,/observe\(document\.body,\s*\{\s*childList:\s*true,\s*subtree:\s*true\s*\}\)/,'first-paint guard must not observe the whole dashboard subtree');
assert.doesNotMatch(v14,/observe\(document\.body,\s*\{\s*childList:\s*true,\s*subtree:\s*true\s*\}\)/,'V14 must not install a body-wide dashboard MutationObserver');
assert.doesNotMatch(v304,/observe\(document\.body,\s*\{\s*childList:\s*true,\s*subtree:\s*true\s*\}\)/,'V304 upload owner must not observe unrelated dashboard mutations');
assert.match(indexHtml,/dashboard-fixture-v18\.js\?v=20260925-v582-1/,'V582 first-paint observer fix must be cache-busted');
assert.match(indexHtml,/v14-geometry-fixture\.js\?v=20260925-v582-1/,'V582 V14 observer fix must be cache-busted');
assert.match(v14,/v304-unified-upload-owner\.js\?v=20260925-v582-1/,'V582 V304 upload owner must be cache-busted by the runtime loader');
assert.doesNotMatch(indexHtml,/installV575CoordinateOwner/,'V581 static shell must retire the V575 capture owner');
assert.doesNotMatch(indexHtml,/v580-visible-shell-recovery\.js/,'V581 static shell must retire layered V580 recovery');
assert.match(indexHtml,/v581-stable-shell-owner\.js\?v=20260926-v593-1/,'V581 stable shell must ship in the normal dashboard HTML');
assert.match(indexHtml,/<a class="side-link active" data-page="home"[^>]*href="\/?\?auth=v581"/,'HOME must be a native anchor');
assert.match(indexHtml,/<a class="side-link" data-page="ce"[^>]*href="\/ce\?auth=v581"/,'CE must be a native hard-navigation anchor');
assert.match(indexHtml,/<a class="side-link" data-page="whpp"[^>]*href="\/whpp\?auth=v581"/,'WHPP must remain a native first-class route');
assert.match(indexHtml,/<a class="side-link" data-page="import"[^>]*href="\/import\?auth=v581"/,'data import must remain reachable without SPA click ownership');
assert.match(stableShell,/2026-09-26-v593-unconditional-sidebar-v1/);
assert.match(stableShell,/data-v581-active/,'V581 must own route visibility deterministically');
assert.match(stableShell,/renderFallbackHomeIfStillEmpty/,'V581 must recover a blank HOME container');
assert.match(earlySidebar,/2026-09-26-v593-unconditional-sidebar-coordinate-route-v1/,'V593 unconditional sidebar owner must ship');
assert.match(earlySidebar,/global\.addEventListener\('pointerdown',pointerOwner,true\)/,'V593 must own pointerdown at window capture');
assert.match(earlySidebar,/global\.addEventListener\('click',pointerOwner,true\)/,'V593 must keep click fallback at window capture');
assert.match(earlySidebar,/sidebarLinkAt\(Number\(event\.clientX\),Number\(event\.clientY\)\)/,'V593 must resolve route by coordinates, not event target');
assert.match(earlySidebar,/global\.location\.href=href/,'V593 must hard-navigate through the browser');
assert.match(earlySidebar,/ce-qc-v591-sidebar-frame/,'V593 must remove the broken V591 iframe');
assert.match(stableShell,/original visible sidebar \+ unconditional early coordinate navigation/i,'V593 stable owner must keep the original menu visible');
assert.doesNotMatch(stableShell,/subtree:true/,'stable-shell observer must not watch business-card/table/chart subtree mutations');
assert.match(stableShell,/shell-structure-mutation/,'stable shell must keep bounded structural repair');
assert.match(stableShell,/retireIsolatedSidebar/,'V593 stable owner must retire V590/V591 iframe remnants');
assert.doesNotMatch(stableShell,/frame\.srcdoc|isolatedSidebarMarkup|mountIsolatedSidebar/,'V593 primary sidebar must not create another iframe');
assert.match(server,/X-Frame-Options', 'DENY'/,'normal authenticated HTML keeps frame denial');
assert.match(stableResponse,/2026-09-26-v593-unconditional-sidebar-response-v1/);
assert.match(stableResponse,/stripInlineV575/,'final delivered HTML must remove V575 even if an older response wrapper re-injects it');
assert.match(stableResponse,/v580-visible-shell-recovery\.js/,'final delivered HTML must remove V580 layered recovery');
assert.match(stableResponse,/V581_TAG/,'final response pass must preserve exactly one V581 owner');
assert.match(stableResponse,/appTag/,'final response pass must locate app.js as the bootstrap boundary');
assert.match(stableResponse,/V581_TAG\+'\\n'\+match/,'stable shell must be injected immediately before app.js');
const earlyAt=indexHtml.indexOf('/v592-early-sidebar-capture.js?v=20260926-v593-1');
const stableAt=indexHtml.indexOf('/v581-stable-shell-owner.js?v=20260926-v593-1');
const appAt=indexHtml.indexOf('/app.js?v=20260921-v564-1');
assert.ok(earlyAt>0&&stableAt>earlyAt&&appAt>stableAt,'V593 window capture must load in head before the stable owner and app.js');

assert.match(purgeConsole,/CE QC 直接清空业务数据/,'recovery page must expose the direct no-backup purge mode');
assert.match(purgeConsole,/onclick="window\.openDirectDataPurge\?\.\(\)"/,'recovery page must delegate direct purge to the V560 owner');
assert.match(purgeConsole,/\/v560-direct-data-purge\.js\?v=20260921-v568-1/,'recovery page must load the direct purge owner');
assert.match(purgeConsole,/id="directPurgePreview"/,'direct purge progress must remain visible on the lightweight recovery page');
assert.match(purgeConsole,/不创建新备份、不启用安全封锁/,'recovery page must state the requested no-backup/no-seal behavior');
assert.match(purgeConsole,/id="directPurgePhrase"[^>]*oninput="updateDirectPurgeButton\(\)"/,'recovery console must expose the exact confirmation phrase field');
assert.match(purgeConsole,/id="directPurgeExecuteButton"[^>]*onclick="executeDirectDataPurge\(\)"[^>]*disabled>确认直接清空所有数据<\/button>/,'recovery console must expose the gated direct purge button');
assert.doesNotMatch(purgeConsole,/备份并继续|purgeBackupConfirmed|v505-data-purge-recovery\.js/,'direct recovery page must not start the legacy backup workflow');
const recoveryHtmlRoute = server.indexOf("app.get(['/purge-console.html', '/purge-console']");
const recoveryJsRoute = server.indexOf("app.get('/v560-direct-data-purge.js'");
const authMiddleware = server.indexOf('app.use(accessIdentity);');
assert.ok(recoveryHtmlRoute >= 0 && recoveryHtmlRoute < authMiddleware,'loopback purge HTML must be served before accessIdentity');
assert.ok(recoveryJsRoute >= 0 && recoveryJsRoute < authMiddleware,'loopback direct purge JS must be served before accessIdentity');
assert.match(server,/function isLoopbackRecoveryRequest\(req\)/,'recovery pre-auth route must have an explicit loopback guard');
assert.match(server,/\['127\.0\.0\.1', 'localhost', '::1'\]\.includes\(host\)/,'recovery pre-auth route must require loopback host');
assert.match(server,/\['127\.0\.0\.1', '::1'\]\.includes\(remote\)/,'recovery pre-auth route must require loopback remote');
assert.doesNotMatch(server.slice(recoveryHtmlRoute,authMiddleware),/app\.post\(['"]\/api\/admin\/data-purge\/direct/,'pre-auth recovery shell must never expose direct purge API before auth');
assert.match(server,/app\.post\('\/api\/admin\/data-purge\/direct', requireRole\('ADMIN'\)/,'direct purge API must remain ADMIN-only after auth');


// Execute the browser guard with two startup failure shapes:
// 1) headers never arrive; V533 must synthesize a finite 504;
// 2) headers arrive but the body never completes; V535 must keep the AbortController
//    armed so response.text()/json() cannot hang the interactive page forever.
const timers=[];
const nativeCalls=[];
const stage={style:{}};
const shell={style:{}};
const body={style:{},appendChild(){}};
const notices=new Map();
const document={
  documentElement:{style:{}},body,
  querySelector(selector){return selector==='.app-stage'?stage:selector==='.app-shell'?shell:null;},
  getElementById(id){return notices.get(id)||null;},
  createElement(){
    const node={style:{},setAttribute(){},textContent:'',remove(){if(node.id)notices.delete(node.id);}};
    Object.defineProperty(node,'id',{get(){return node._id||'';},set(value){node._id=value;if(value)notices.set(value,node);}});
    return node;
  }
};
body.appendChild=node=>{if(node?.id)notices.set(node.id,node);};
class FakeMutationObserver{constructor(fn){this.fn=fn;}observe(){}disconnect(){}}
function abortError(){const error=new Error('aborted');error.name='AbortError';return error;}
const context={
  document,
  location:{href:'http://127.0.0.1:5177/'},
  URL,Response,AbortController,Promise,JSON,Buffer,
  MutationObserver:FakeMutationObserver,
  setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},
  clearTimeout(){},
  fetch(input,init={}){
    nativeCalls.push({input,init});
    const method=String(init?.method||'GET').toUpperCase();
    if(method!=='GET')return Promise.resolve({native:true,method});
    const raw=String(input||'');
    if(raw.includes('/api/bootstrap')){
      return Promise.resolve({
        ok:true,status:200,
        text(){
          return new Promise((resolve,reject)=>{
            if(init.signal?.aborted)return reject(abortError());
            init.signal?.addEventListener('abort',()=>reject(abortError()),{once:true});
          });
        }
      });
    }
    return new Promise(()=>{});
  }
};
context.window=context;
vm.runInNewContext(startup,context,{filename:'public/dashboard-fixture-v18.js'});
assert.equal(stage.style.visibility,'visible','startup guard must reveal the stage synchronously');
assert.equal(shell.style.visibility,'visible','startup guard must reveal the shell synchronously');
assert.equal(stage.style.pointerEvents,'auto','V535 must keep the stage interactive');
assert.equal(shell.style.pointerEvents,'auto','V535 must keep the shell interactive');

const interactiveTimer=timers.find(item=>item.ms===0);
assert.ok(interactiveTimer,'V565 must schedule an immediate post-script interaction repair pass');
interactiveTimer.fn();
assert.equal(document.documentElement.style.pointerEvents,'auto','V565 must keep the root interactive');
assert.equal(notices.size,0,'V564 must not leave a startup notice overlay');

const headerTimerStart=timers.length;
const headerResponse=await context.fetch('/api/bootstrap');
const headerTimer=timers.slice(headerTimerStart).find(item=>item.ms===3000);
assert.ok(headerTimer,'V535 body-bounded bootstrap must arm the 3-second wall-clock budget');
const hangingBody=headerResponse.text();
headerTimer.fn();
await assert.rejects(hangingBody,error=>error?.name==='AbortError','V535 must abort a body that stalls after headers arrive');

const noHeaderTimerStart=timers.length;
const pending=context.fetch('/api/state');
const timeout=timers.slice(noHeaderTimerStart).find(item=>item.ms===3000);
assert.ok(timeout,'V533 no-header startup fetch must arm the 3-second budget');
timeout.fn();
const timed=await pending;
assert.equal(timed.status,504,'timed-out startup GET must resolve as a bounded compatibility failure');
const timedPayload=await timed.json();
assert.equal(timedPayload.code,'V533_STARTUP_READ_TIMEOUT');

const nativePost=await context.fetch('/api/admin/data-purge/prepare',{method:'POST'});
assert.equal(nativePost.native,true,'write requests must bypass startup guard unchanged');
assert.equal(nativeCalls.at(-1)?.init?.method,'POST');

console.log('[V480/V533/V535/V564/V565/V581] first-paint/lifecycle smoke passed · CSS/JS/images/fonts before auth · HTML/API stay protected · startup reads bounded · V581 single stable shell/native navigation shipped · writes stay untouched · export descendants self-release when direct parent disappears');
