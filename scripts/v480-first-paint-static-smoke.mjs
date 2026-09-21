import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

for(const file of ['src/v89StaticAssetCachePatch.js','src/exportJobAtomicJson.js','public/dashboard-fixture-v18.js','public/v569-final-interaction-owner.js']){
  const checked=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(checked.status,0,`${file} syntax failed: ${checked.stderr||checked.stdout}`);
}
const source=fs.readFileSync('src/v89StaticAssetCachePatch.js','utf8');
const atomic=fs.readFileSync('src/exportJobAtomicJson.js','utf8');
const startup=fs.readFileSync('public/dashboard-fixture-v18.js','utf8');
const interaction=fs.readFileSync('public/v569-final-interaction-owner.js','utf8');
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
assert.match(indexHtml,/v569-final-interaction-owner\.js\?v=20260921-v569-1/,'V569 final interaction owner must be shipped by the normal dashboard shell');
assert.match(interaction,/2026-09-21-v570-early-window-interaction-owner-v1/,'V570 early interaction owner version marker must be present');\nassert.match(interaction,/2026-09-21-v569-final-interaction-owner-v1/,'V569 compatibility marker must remain present');
assert.match(interaction,/candidateByGeometry/,'V570 must recover clicks by visible-control geometry when a stale layer receives the hit');\nassert.match(interaction,/activeSurface/,'V570 must prefer controls on the active right-side page over stale layers');
assert.match(interaction,/global\.addEventListener\('click',onCapturedClick,true\)/,'V569 must own clicks at window capture before legacy document capture handlers');
assert.match(interaction,/global\.navigatePage\(page,anchor\)/,'V569 must directly own sidebar navigation rather than redispatching into stale capture chains');
assert.match(interaction,/setInterval\(healInteractiveSurface,5000\)/,'V569 must keep long-lived pages clickable after late legacy mutations');

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

console.log('[V480/V533/V535/V564/V565/V569/V570] first-paint/lifecycle smoke passed · CSS/JS/images/fonts before auth · HTML/API stay protected · startup headers+body reads are bounded · clickability is toast-free + self-healing against stale full-screen blockers · no automatic rescue refresh/re-render · writes stay untouched · export descendants self-release when direct parent disappears');
