import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('public/v625-shell.js','utf8');
const extract=(from,to)=>{const i=source.indexOf(from),j=source.indexOf(to,i+from.length);assert.ok(i>=0&&j>i,from);return source.slice(i,j);};
const proofCode=extract('async function v759VerifyWhppCompletionOnce(', 'let v631TimingMissing=');
const held=new Map([['2026-07-01|SNAP-190',Date.now()+60_000]]);
const inflight=new Map();
let requests=0,repaints=0;
const proof=new Function('v626LatestImport','v759PinnedWhppProof','v759WhppProofRequests',
  'v763WhppEvidenceNextRead','json','v759RememberWhppProof','v763WhppEvidenceGaps','refreshLiveProgress',
  proofCode+';return v759VerifyWhppCompletionOnce;')(
  {reportDate:'2026-07-01',snapshotId:'SNAP-190'},()=>null,inflight,held,
  async url=>{requests++;assert.match(url,/reportDate=2026-07-01/);return {reportDate:'2026-07-01'};},
  r=>r.reportDate==='2026-07-01',new Map(),()=>{repaints++;return Promise.resolve()}
);
assert.equal(await proof('2026-07-01'),false,'ordinary poll respects previous 30s negative proof throttle');
assert.equal(requests,0);
assert.equal(await proof('2026-07-01',{force:true}),true,'completed real run forces one fresh completion check');
assert.equal(requests,1,'no rescanning, one read-only completion proof');
assert.equal(repaints,1);
assert.equal(inflight.size,0);
assert.equal(await proof('2026-07-02',{force:true}),false,'other date may not steal selected snapshot');
assert.equal(requests,1);

const waitCode=extract('async function waitWhppTerminal(', '// V787: inspect the EXACT');
async function waitFor(outcome){
 const f=new Function('json','appendLiveLog',waitCode+';return waitWhppTerminal;')(
  async()=>({runtime:{active:false,outcome}}),()=>{}
 );
 return f('2026-07-01',3000);
}
assert.equal((await waitFor('COMPLETED')).runtime.outcome,'COMPLETED');
for(const o of ['RETRY_REQUIRED','AUTH_REQUIRED','FAILED']){
 await assert.rejects(waitFor(o),new RegExp('WHPP后台未完成|WHPP处理失败'),o+' is not completed');
}
assert.match(source,/const terminal=\(r\.runtime\?\.active\|\|r\.active\)\?await waitWhppTerminal\(day\):r;/);
assert.match(source,/if\(terminal\?\.runtime\?\.outcome==='COMPLETED'\|\|terminal\?\.completed===true\)\{\s*await v759VerifyWhppCompletionOnce\(day,\{force:true\}\)/);
assert.match(source,/if\(!force&&Date\.now\(\)<Number\(v763WhppEvidenceNextRead\.get\(key\)\|\|0\)\)return false;/);
assert.match(source,/const processingComplete=truth\.locked===true&&truth\.processingEvidenceVerified===true/,'only exact durable member proof allows completion');
console.log('[V789 WHPP POSTFINISH] stale 30s negative proof bypassed exactly once on backend COMPLETED; auth/retry/failed rejected; explicit-source verification preserved PASS');
