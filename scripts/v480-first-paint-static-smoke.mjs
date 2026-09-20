import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

for(const file of ['src/v89StaticAssetCachePatch.js','src/exportJobAtomicJson.js','public/dashboard-fixture-v18.js']){
  const checked=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(checked.status,0,`${file} syntax failed: ${checked.stderr||checked.stdout}`);
}
const source=fs.readFileSync('src/v89StaticAssetCachePatch.js','utf8');
const atomic=fs.readFileSync('src/exportJobAtomicJson.js','utf8');
const startup=fs.readFileSync('public/dashboard-fixture-v18.js','utf8');
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
assert.match(startup,/2026-09-14-v535-interactive-first-paint-body-bounded-v1/,'V535 interactive-first-paint guard must ship in the same earliest script');
assert.match(startup,/const STARTUP_TIMEOUT_MS = 3000;/,'startup reads must have a short finite budget');
assert.match(startup,/pathname === '\/api\/bootstrap'/,'startup guard must bound the primary bootstrap read');
assert.match(startup,/pathname\.startsWith\('\/api\/business-state\/'\)/,'startup guard must bound exact-business startup reads');
assert.match(startup,/method !== 'GET'/,'startup guard must never intercept writes');
assert.match(startup,/init\?\.signal/,'startup guard must preserve explicitly-owned request cancellation');
assert.match(startup,/controller\.abort\(\)/,'startup guard must actively release a timed-out browser request');
assert.match(startup,/V533_STARTUP_READ_TIMEOUT/,'header timeout must fail one read without hanging the page');
assert.match(startup,/forceFirstPaint\(\)/,'startup guard must make the static shell visible before app bootstrap completes');
assert.match(startup,/function forceInteractivePaint\(\)/,'V535 must make the shell interactive independently of refresh');
assert.match(startup,/typeof global\.renderAll === 'function'/,'V535 must render the safe shell once app.js is available');
assert.match(startup,/does NOT clear the startup timer here/,'V535 must keep the timeout armed after response headers arrive');
assert.match(startup,/typeof global\.refresh === 'function'/,'startup guard may attempt only one bounded status reread after first paint');
assert.doesNotMatch(startup,/\/api\/admin\/data-purge|\/api\/import\/unified-daily-report/i,'first-paint guard must not own destructive or import endpoints');
assert.doesNotMatch(startup,/method\s*:\s*['"`](?:POST|PUT|PATCH|DELETE)['"`]/i,'first-paint guard must not create write requests');

assert.match(purgeConsole,/CE QC 安全清空业务数据/,'V533 must provide a lightweight authenticated recovery page when the dashboard shell is unavailable');
assert.match(purgeConsole,/onclick="window\.openDataPurge\?\.\(\)"/,'recovery page must delegate the action to the canonical V505 UI owner');
assert.match(purgeConsole,/\/v505-data-purge-recovery\.js\?v=20260920-v555-1/,'recovery page must load the same V505 recovery owner');
assert.match(purgeConsole,/id="purgePreview"/,'V505 status must remain visible on the lightweight recovery page');
assert.doesNotMatch(purgeConsole,/fetch\(['"`]\/api\/admin\/data-purge|XMLHttpRequest/i,'recovery page must not implement a second purge transport');
assert.doesNotMatch(purgeConsole,/\/api\/admin\/data-purge\/(?:prepare|execute)/i,'recovery HTML must never bypass the canonical V505 transport owner');
assert.doesNotMatch(purgeConsole,/#purgeStepTwo\{display:none!important\}/,'recovery console must not permanently hide explicit confirmation step');
assert.match(purgeConsole,/\[hidden\]\{display:none!important\}#purgeStepTwo:not\(\[hidden\]\)\{display:block!important\}/,'recovery console must reveal the canonical second confirmation step after verified backup');
assert.match(purgeConsole,/onclick="continueDataPurge\(\)">备份并继续<\/button>/,'recovery console must expose the explicit backup-and-continue control');
assert.match(purgeConsole,/id="purgeBackupConfirmed"[^>]*onchange="updatePurgeButton\(\)"/,'recovery console must expose the backup confirmation checkbox');
assert.match(purgeConsole,/id="purgePhrase"[^>]*oninput="updatePurgeButton\(\)"/,'recovery console must expose the exact confirmation phrase field');
assert.match(purgeConsole,/id="purgeExecuteButton"[^>]*onclick="executeDataPurge\(\)"[^>]*disabled>确认清空所有数据<\/button>/,'recovery console must expose the gated final purge button');
const recoveryHtmlRoute = server.indexOf("app.get(['/purge-console.html', '/purge-console']");
const recoveryJsRoute = server.indexOf("app.get('/v505-data-purge-recovery.js'");
const authMiddleware = server.indexOf('app.use(accessIdentity);');
assert.ok(recoveryHtmlRoute >= 0 && recoveryHtmlRoute < authMiddleware,'loopback purge HTML must be served before accessIdentity');
assert.ok(recoveryJsRoute >= 0 && recoveryJsRoute < authMiddleware,'loopback purge JS must be served before accessIdentity');
assert.match(server,/function isLoopbackRecoveryRequest\(req\)/,'recovery pre-auth route must have an explicit loopback guard');
assert.match(server,/\['127\.0\.0\.1', 'localhost', '::1'\]\.includes\(host\)/,'recovery pre-auth route must require loopback host');
assert.match(server,/\['127\.0\.0\.1', '::1'\]\.includes\(remote\)/,'recovery pre-auth route must require loopback remote');
assert.doesNotMatch(server.slice(recoveryHtmlRoute,authMiddleware),/\/api\/admin\/data-purge\/(?:prepare|execute)/,'pre-auth recovery shell must never expose purge APIs');


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

let renderCount=0;
context.renderAll=()=>{renderCount+=1;};
const interactiveTimer=timers.find(item=>item.ms===0);
assert.ok(interactiveTimer,'V535 must schedule an immediate post-script interactive render');
interactiveTimer.fn();
assert.equal(renderCount,1,'V535 must call renderAll after app.js becomes available');

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

console.log('[V480/V533/V535] first-paint/lifecycle smoke passed · CSS/JS/images/fonts before auth · HTML/API stay protected · startup headers+body reads are bounded · shell becomes interactive before hydration · lightweight recovery delegates only to V505 · writes stay untouched · export descendants self-release when direct parent disappears');
