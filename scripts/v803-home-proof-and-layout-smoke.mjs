import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const js=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
const css=fs.readFileSync('public/v801-home-layout.css','utf8');
assert.match(html,/v625-shell\.js\?v=20261031-v805-1&patch=805/);
assert.match(html,/id="v803RetryOpenSource"/);
assert.match(js,/v803RetryOpenSource'\)\?\.addEventListener\('click',\(\)=>void loadOpenPod\(\)\)/);
assert.match(js,/const viewSequence=options\.summaryOverride&&options\.expectedViewSequence/);
assert.match(js,/loadHome\(\{summaryOverride:full,expectedViewSequence:viewSequence,skipHistory:true,skipAux:true\}\)/);
assert.match(js,/v803SelectedTimingProof=\{reportDate:day,snapshotId:String\(payload\.snapshotId\|\|''\),timing\}/);
assert.match(js,/const timing=v803MergeFullWithExactTiming\(summary\?\.timing\|\|\{\},summary\?\.reportDate\|\|requestedDate\|\|'',summary\?\.snapshotId\|\|''\)/);
assert.match(js,/new URLSearchParams\(\{scope:'open',reportDate,snapshotId\}\)/);
assert.match(js,/json\('\/api\/tracking-workspace\?'\+params\.toString\(\),30000\)/);
assert.match(js,/if\(String\(r\.reportDate\|\|''\)\.slice\(0,10\)!==reportDate\)/);
assert.match(js,/v785OpenSourceVerified=false;[\s\S]*renderOpenPodRows\(\)/);
assert.match(css,/@media\(min-width:1480px\)/);
assert.match(css,/grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
const start=js.indexOf('let v803SelectedTimingProof=null;');
const end=js.indexOf('function v801SetTimingWaiting(',start);
assert.ok(start>0&&end>start,'production merger must exist');
const ctx={};
vm.createContext(ctx);
vm.runInContext(js.slice(start,end),ctx,{timeout:1000});
const resultId='2026-07-12',snapshot='SNAP-12';
const full={TBKH:{overall:{podCount:0,avgDays:null,totalPodCount:900}},
 WHPP:{overall:{podCount:2,avgDays:6,totalPodCount:10}},
 SHOPEECN:{overall:{podCount:7,avgDays:3,totalPodCount:8}},
 SHOPEEVN:{overall:{podCount:0,avgDays:null,totalPodCount:20}}};
const proof={TBKH:{overall:{podCount:6,avgDays:2,totalPodCount:900}},
 WHPP:{overall:{podCount:3,avgDays:4,totalPodCount:10}},
 SHOPEECN:{overall:{podCount:4,avgDays:9,totalPodCount:8}},
 SHOPEEVN:{overall:{podCount:0,avgDays:null,totalPodCount:20}}};
ctx.testProof={reportDate:resultId,snapshotId:snapshot,timing:proof};
vm.runInContext('v803SelectedTimingProof=testProof',ctx,{timeout:1000});
const combined=ctx.v803MergeFullWithExactTiming(full,resultId,snapshot);
assert.equal(combined.TBKH.overall.avgDays,2,'exact-day proof must survive slow full summary');
assert.equal(combined.WHPP.overall.avgDays,4,'more verified members win');
assert.equal(combined.SHOPEECN.overall.avgDays,3,'fewer proven members cannot override newer full evidence');
assert.equal(combined.SHOPEEVN.overall.avgDays,null,'missing remains null');
assert.equal(ctx.v803MergeFullWithExactTiming(full,'2026-07-11',snapshot),full,
  'other-day responses cannot inherit July 12 proof');
assert.equal(ctx.v803MergeFullWithExactTiming(full,resultId,'OTHER'),full,
  'same-day other snapshot cannot inherit trusted proof');
const noSample=ctx.v801TimingAggregate({TBKH:{overall:{podCount:0,avgDays:null}}},'overall');
assert.equal(noSample.count,0);
assert.equal(noSample.avgDays,null);
assert.equal(noSample.totalPod,null,'missing POD denominator cannot become a fabricated zero');
console.log('[V803 HOME] PASS full-worker race, same-snapshot evidence precedence, null coverage, source-pinned unfinished POD, compact layout');
