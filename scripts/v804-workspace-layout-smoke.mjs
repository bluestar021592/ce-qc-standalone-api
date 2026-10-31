import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync('public/v625-shell.html','utf8');
const js=fs.readFileSync('public/v625-shell.js','utf8');
const css=fs.readFileSync('public/v804-home-workspace.css','utf8');
const original=fs.readFileSync('public/v801-home-layout.css','utf8');
const home=html.slice(html.indexOf('id="v625Home"'),html.indexOf('<!-- BUSINESS -->'));
assert.ok(home.length>10000);
assert.match(html,/v804-home-workspace\.css\?v=20261031-v804-1/);
assert.match(html,/v625-shell\.js\?v=20261031-v804-1&patch=804/);
assert.match(js,/function v804SelectHomeWorkspace\(/);
assert.match(js,/function v804ComposeHomeWorkspace\(/);
assert.match(js,/v800ApplyReferenceLayout\(\);\s*v804ComposeHomeWorkspace\(\);\s*bind\(\);/);
assert.match(js,/v804SelectHomeWorkspace\('signing',\{writeUrl:false\}\)/);
for(const [key,marker] of [
  ['overview',"panes.get('overview').append(operations,validation)"],
  ['signing',"panes.get('signing').append(signing)"],
  ['open-pod',"panes.get('open-pod').append(unfinished)"],
  ['management',"panes.get('management').append(management)"]])
  assert.ok(js.includes(marker),key+' requires the actual previous source-backed DOM panels');
for(const key of ['overview','signing','open-pod','management']){
  assert.ok(js.includes("{id:'"+key+"'"),key+' must be a real clickable tab');
}
assert.match(js,/button\.addEventListener\('click',\(\)=>v804SelectHomeWorkspace\(item\.id\)\)/);
assert.match(js,/pane\.hidden=pane\.dataset\.v804Pane!==chosen/);
assert.match(js,/button\.setAttribute\('aria-selected',selected\?'true':'false'\)/);
assert.doesNotMatch(js,/preventDefault\(/,'native navigation must remain enabled');
assert.match(js,/history\.replaceState\(history\.state,'',url\.pathname\+url\.search\+url\.hash\)/);
assert.match(js,/jump\.addEventListener\('click',\(\)=>\{\s*v804SelectHomeWorkspace\('signing',\{writeUrl:false\}\)/);
assert.match(css,/\.v804-workspace-pane\[hidden\]\{display:none!important\}/);
assert.match(css,/\.v804-workspace-tab-buttons\{[\s\S]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
assert.match(css,/@media\(max-width:1100px\)/);
assert.match(original,/grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
for(const id of ['v625ClassTotal','v625ClassAuto','v625ClassUnknown',
 'v625ClassConflict','v625ClassAccuracy','v625TimingTBKHOverall',
 'v625TimingWHPPOverall','v625TimingSHOPEECNOverall','v625TimingSHOPEEVNOverall',
 'v803RetryOpenSource','v626RefreshOpenPod','v626OpenPodRows','v625HomeStatus']){
  assert.equal(home.split('id="'+id+'"').length-1,1,'real source-backed unique ID '+id);
}
assert.match(js,/const timing=v803MergeFullWithExactTiming/);
assert.match(js,/v803SelectedTimingProof=/);
assert.match(js,/new URLSearchParams\(\{scope:'open',reportDate,snapshotId\}\)/);
assert.doesNotMatch(js.slice(js.indexOf('function v804ComposeHomeWorkspace'),js.indexOf('function v800SetWhppMetrics')),
 /fetch\(|post\(|\/api\/|deleteBusiness|clearDatabase|purge/,'workspace UI may never execute API or mutation');
console.log('[V804 HOMEPAGE] PASS 4 real accessible tabs, preserved source ownership, real signing/OPEN components and no data actions');
