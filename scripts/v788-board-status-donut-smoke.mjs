import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/v625-shell.js',import.meta.url),'utf8');
assert.ok(source.includes('returned:m.returned||0'),'business view must pass return members to chart');
assert.ok(source.includes('otherNormal:exactCounts.otherNormal+exactCounts.unprocessed'),'disjoint accounting must preserve other states and unprocessed members');
assert.ok(source.includes('exactSum===Number(m.total||0)'),'only complete disjoint accounting can drive risk category slices');
assert.ok(source.includes('pending:0,abnormal:0,otherNormal:0'),'incomplete accounting must not invent overlapping Pending or abnormal status');
const start=source.indexOf('function renderDonut(m){');
const end=source.indexOf('\nasync function loadSession()',start);
assert.ok(start>=0&&end>start,'business donut source must exist');
function run(business,m){
  const elements={v625BusinessDonut:{style:{}},v625BusinessLegend:{innerHTML:'',textContent:''}};
  const script=source.slice(start,end)+'\nrenderDonut(input);';
  vm.runInNewContext(script,{business,input:m,byId:id=>elements[id],fmt:n=>String(n),pct:n=>n.toFixed(2)+'%',esc:s=>s},{timeout:1000});
  return elements;
}
const whpp=run('WHPP',{total:156,pod:124,returned:32,delivery:0,pending:0,abnormal:0,otherNormal:0});
assert.match(whpp.v625BusinessLegend.innerHTML,/已退回 32（20.51%）/);
assert.match(whpp.v625BusinessLegend.innerHTML,/已签收 124（79.49%）/);
assert.doesNotMatch(whpp.v625BusinessLegend.innerHTML,/待核验/);
const missing=run('WHPP',{total:156,pod:100,returned:32,delivery:0,pending:0,abnormal:0,otherNormal:0});
assert.match(missing.v625BusinessLegend.innerHTML,/待核验 24/);
const overlap=run('WHPP',{total:156,pod:124,returned:32,delivery:20,pending:0,abnormal:0,otherNormal:0});
assert.match(overlap.v625BusinessLegend.textContent,/分类存在重叠/);
const ce=run('CE',{total:10,pod:8,returned:0,delivery:2,pending:0,abnormal:0,otherNormal:0});
assert.doesNotMatch(ce.v625BusinessLegend.innerHTML,/已退回/);
console.log('[V788 BOARD DONUT] WHPP POD124 return32, missing category guard, overlap guard, CE category scope PASS');
