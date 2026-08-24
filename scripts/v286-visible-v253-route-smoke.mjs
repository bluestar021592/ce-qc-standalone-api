import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime=fs.readFileSync('src/v206InteractiveFirstRuntimePatch.js','utf8');
const retired=fs.readFileSync('src/v286V253TrendTruthBridge.js','utf8');
const owner=fs.readFileSync('public/v253-dashboard-fast-owner.js','utf8');
const generic=fs.readFileSync('public/v263-generic-trend-hydrator.js','utf8');
const backend=fs.readFileSync('src/v273DashboardTruthReadPatch.js','utf8');

assert.doesNotMatch(retired,/express\.application\.get\s*=/,'V287 must not globally mutate express.application.get');
assert.match(retired,/global Express route hook retired/,'retired V286 module must be explicit about the safe handoff');
assert.match(runtime,/import '\.\/v286V253TrendTruthBridge\.js';[\s\S]*import '\.\/v253DashboardFastPath\.js';/,'retired compatibility marker may stay before V253 without mutating Express');
assert.match(owner,/u\.pathname==='\/api\/v234\/trends'\)\{u\.pathname='\/api\/v273\/trends'/,'visible legacy trend fetch must be redirected to V273');
assert.match(generic,/fetch\(`\/api\/v273\/trends\?businessType=/,'generic CE\/CEAF\/ALI1688 trends must read V273 directly');
assert.match(backend,/readV284ProvenDashboardTrends/,'V273 backend route must delegate to V284 proven seven-business truth');

// Execute the browser fetch bridge with a minimal fake DOM and verify the actual
// outgoing URL. This guards against a source-only assertion that can pass while
// runtime rewriting is broken.
const calls=[];
const fakeWindow={
  fetch:async input=>{calls.push(String(input));return{ok:true,json:async()=>({ok:true})};},
  location:{origin:'http://127.0.0.1:5177',pathname:'/'},
  sessionStorage:{getItem:()=>null,setItem:()=>{}},
  addEventListener:()=>{}
};
const fakeDocument={readyState:'loading',addEventListener:()=>{},getElementById:()=>null,querySelectorAll:()=>[]};
const fakeLocation=fakeWindow.location;
const fakeSessionStorage=fakeWindow.sessionStorage;
const FakeRequest=class{constructor(url){this.url=String(url);}};
new Function('window','document','location','sessionStorage','Request',owner)(fakeWindow,fakeDocument,fakeLocation,fakeSessionStorage,FakeRequest);
await fakeWindow.fetch('/api/v234/trends?businessType=CE&from=2026-08-17&to=2026-08-21');
assert.equal(calls[0],'/api/v273/trends?businessType=CE&from=2026-08-17&to=2026-08-21','visible trend fetch must physically leave the browser bridge on V273');

console.log('[V287] safe visible trend bridge smoke passed · no global Express hook · browser V234 -> V273 -> V284/V286 proven truth');
