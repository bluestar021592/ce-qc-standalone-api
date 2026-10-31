// Historical V804 regression is still executed in CI. V805 deliberately
// supersedes its tabbed layout with the original V792 reference dashboard.
// Preserve code data actions, not the abandoned default visual structure.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync('public/v625-shell.html','utf8');
const js=fs.readFileSync('public/v625-shell.js','utf8');
const css=fs.readFileSync('public/v805-home-reference.css','utf8');
assert.match(html,/v805-home-reference\.css\?v=20261031-v805-1/);
assert.match(html,/v625-shell\.js\?v=20261031-v805-1&patch=805/);
assert.match(js,/function v805ApplyReferenceHome\(\)/);
assert.match(js,/v800ApplyReferenceLayout\(\);\s*v805ApplyReferenceHome\(\);\s*bind\(\);/);
assert.doesNotMatch(js,/v800ApplyReferenceLayout\(\);\s*v804ComposeHomeWorkspace\(\);/);
assert.match(js,/overview\.after\(top\)/);
assert.match(js,/top\.after\(validation\)/);
assert.match(js,/validation\.after\(bottom\)/);
assert.match(js,/bottom\.replaceChildren\(signing,unfinished\)/);
assert.match(js,/bottom\.after\(management\)/);
assert.match(js,/management\.after\(trend\)/);
assert.match(js,/more\.append\(label,inner\)/);
assert.match(js,/priority\.has\(card\.querySelector\('strong'\)\?\.id\)/);
assert.match(css,/grid-template-columns:minmax\(0,2\.35fr\) minmax\(0,\.88fr\) minmax\(0,1\.05fr\) minmax\(0,1\.03fr\)/);
assert.match(css,/grid-template-columns:minmax\(0,3\.05fr\) minmax\(280px,1fr\)/);
assert.match(css,/grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
for(const code of ['WHPP','SHOPEECN','SHOPEEVN'])
  assert.ok(html.includes('data-timing="'+code+'"'));
for(const id of ['v801TimingOverall','v801TimingReturnRate','v803RetryOpenSource',
  'v626RefreshOpenPod','v626OpenPodRows','v792HomeManagement','v801TimingDashboard'])
  assert.equal(html.split('id="'+id+'"').length-1,1,'unique data-bound ID '+id);
assert.match(js,/const timing=v803MergeFullWithExactTiming/);
assert.match(js,/new URLSearchParams\(\{scope:'open',reportDate,snapshotId\}\)/);
const start=js.indexOf('function v805ApplyReferenceHome()');
const end=js.indexOf('function v800SetWhppMetrics(',start);
assert.ok(start>=0&&end>start);
assert.doesNotMatch(js.slice(start,end),/fetch\(|post\(|\/api\/|deleteBusiness|clearDatabase|purge/,
  'visual composition must not mutate business data');
console.log('[V805 reference] PASS actual V792 row structure, legacy audit/data bindings, no fake tabs or mutation');
