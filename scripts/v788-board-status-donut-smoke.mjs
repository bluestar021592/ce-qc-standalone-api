import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/v625-shell.js',import.meta.url),'utf8');
assert.ok(source.includes('returned:m.returned||0'),'business view must pass return members to chart');
assert.ok(source.includes('otherNormal:exactCounts.otherNormal+exactCounts.unprocessed'),'disjoint accounting must preserve other states and unprocessed members');
assert.ok(source.includes('exactSum===Number(m.total||0)'),'only complete disjoint accounting can drive risk category slices');
assert.ok(source.includes('pending:0,abnormal:0,otherNormal:0'),'compact first paint must not invent overlapping Pending or abnormal status');
assert.ok(source.includes('if(verifiedAccounting)renderDonut('),'verified exact-member data must supersede provisional state');
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
// Cover every business board, not just WHPP, with mutually exclusive sample states.
for(const type of ['CE','CEAF','TBKH','ALI1688']){
  const board=run(type,{total:12,pod:7,delivery:3,pending:1,abnormal:1,returned:0,otherNormal:0});
  assert.doesNotMatch(board.v625BusinessLegend.innerHTML,/已退回/,`${type} must not invent return category`);
  assert.doesNotMatch(board.v625BusinessLegend.innerHTML,/待核验/,`${type} must conserve sample total`);
}
for(const type of ['SHOPEECN','SHOPEEVN']){
  const board=run(type,{total:20,pod:10,returned:5,delivery:2,pending:2,abnormal:1,otherNormal:0});
  assert.match(board.v625BusinessLegend.innerHTML,/已退回 5（25.00%）/,`${type} must include returned parcels`);
  assert.doesNotMatch(board.v625BusinessLegend.innerHTML,/待核验/,`${type} must conserve sample total`);
}
const other=run('WHPP',{total:10,pod:7,returned:1,delivery:0,pending:0,abnormal:0,otherNormal:2});
assert.match(other.v625BusinessLegend.innerHTML,/其他正常状态 2（20.00%）/);
assert.ok(source.includes("fullTimingQuery.delete('fast')"),'full date signing evidence must not remain in compact-only source');
assert.ok(source.includes('full?.timing?.[business]?.overall?.avgDays'),'signing KPI must share full timing evidence source with overview');
console.log('[V788 BOARD DONUT] WHPP POD124 return32, missing category guard, overlap guard, CE category scope PASS');
