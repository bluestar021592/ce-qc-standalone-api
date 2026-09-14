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
assert.match(startup,/const STARTUP_TIMEOUT_MS = 3000;/,'V533 startup reads must have a short finite budget');
assert.match(startup,/pathname === '\/api\/bootstrap'/,'V533 must bound the primary bootstrap read');
assert.match(startup,/pathname\.startsWith\('\/api\/business-state\/'\)/,'V533 must bound exact-business startup reads');
assert.match(startup,/method !== 'GET'/,'V533 must never intercept writes');
assert.match(startup,/init\?\.signal/,'V533 must preserve explicitly-owned request cancellation');
assert.match(startup,/controller\.abort\(\)/,'V533 must actively release a timed-out browser request');
assert.match(startup,/V533_STARTUP_READ_TIMEOUT/,'V533 timeout must fail one read without hanging the page');
assert.match(startup,/forceFirstPaint\(\)/,'V533 must make the static shell visible before app bootstrap completes');
assert.match(startup,/typeof global\.refresh === 'function'/,'V533 may attempt only one bounded status reread after first paint');
assert.doesNotMatch(startup,/\/api\/admin\/data-purge|\/api\/import\/unified-daily-report/i,'V533 first-paint guard must not own destructive or import endpoints');
assert.doesNotMatch(startup,/method\s*:\s*['"`](?:POST|PUT|PATCH|DELETE)['"`]/i,'V533 first-paint guard must not create write requests');

assert.match(purgeConsole,/CE QC 安全清空业务数据/,'V533 must provide a lightweight authenticated recovery page when the dashboard shell is unavailable');
assert.match(purgeConsole,/onclick="window\.openDataPurge\?\.\(\)"/,'recovery page must delegate the action to the canonical V505 UI owner');
assert.match(purgeConsole,/\/v505-data-purge-recovery\.js\?v=20260914-v533-1/,'recovery page must load the same V505 recovery owner');
assert.match(purgeConsole,/id="purgePreview"/,'V505 status must remain visible on the lightweight recovery page');
assert.doesNotMatch(purgeConsole,/fetch\(['"`]\/api\/admin\/data-purge|XMLHttpRequest/i,'recovery page must not implement a second purge transport');
assert.doesNotMatch(purgeConsole,/\/api\/admin\/data-purge\/(?:prepare|execute)/i,'recovery HTML must never bypass the canonical V505 transport owner');

// Execute the browser guard with a deliberately never-resolving startup GET. The
// fake clock fires its 3-second budget immediately, proving first paint can
// continue while non-GET traffic still goes directly to the native fetch owner.
const timers=[];
const nativeCalls=[];
const stage={style:{}};
const shell={style:{}};
const body={style:{},appendChild(){}};
const document={
  documentElement:{style:{}},body,
  querySelector(selector){return selector==='.app-stage'?stage:selector==='.app-shell'?shell:null;},
  getElementById(){return null;},
  createElement(){return {style:{},setAttribute(){},textContent:''};}
};
class FakeMutationObserver{constructor(fn){this.fn=fn;}observe(){}disconnect(){}}
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
    if(method==='GET')return new Promise(()=>{});
    return Promise.resolve({native:true,method});
  }
};
context.window=context;
vm.runInNewContext(startup,context,{filename:'public/dashboard-fixture-v18.js'});
assert.equal(stage.style.visibility,'visible','V533 must reveal the stage synchronously');
assert.equal(shell.style.visibility,'visible','V533 must reveal the shell synchronously');
const pending=context.fetch('/api/bootstrap');
const timeout=timers.find(item=>item.ms===3000);
assert.ok(timeout,'V533 bootstrap fetch must arm the 3-second budget');
timeout.fn();
const timed=await pending;
assert.equal(timed.status,504,'timed-out startup GET must resolve as a bounded compatibility failure');
const timedPayload=await timed.json();
assert.equal(timedPayload.code,'V533_STARTUP_READ_TIMEOUT');
const nativePost=await context.fetch('/api/admin/data-purge/prepare',{method:'POST'});
assert.equal(nativePost.native,true,'write requests must bypass V533 unchanged');
assert.equal(nativeCalls.at(-1)?.init?.method,'POST');

console.log('[V480/V533] first-paint/lifecycle smoke passed · CSS/JS/images/fonts before auth · HTML/API stay protected · startup GET reads are bounded · first paint is synchronous · lightweight recovery delegates only to V505 · writes stay untouched · export descendants self-release when direct parent disappears');
