import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/v625-shell.js',import.meta.url),'utf8');
assert.ok(source.includes('returned:m.returned||0'),'business view must pass return members to chart');
assert.ok(source.includes('otherNormal:exactCounts.otherNormal+exactCounts.unprocessed'),'disjoint accounting must preserve other states and unprocessed members');
assert.ok(source.includes('exactSum===Number(m.total||0)'),'only complete disjoint accounting can drive risk category slices');
assert.ok(source.includes('pending:0,abnormal:0,otherNormal:0'),'compact first paint must not invent overlapping Pending or abnormal status');
assert.ok(source.includes('if(verifiedAccounting)renderDonut('),'verified exact-member data must supersede provisional state');
assert.ok(source.includes("const disjointKinds=['delivery','pod','returned','returning'"),'exact-member state accounting must isolate status 80');
assert.ok(source.includes('returning:exactCounts.returning'),'status 80 must reach the verified chart');
assert.ok(source.includes("setText('kpiPodRate',Number(m.total)>0?"),'zero denominator must not show fabricated POD 0%');
assert.ok(source.includes("setText('kpiReturnRate',Number(m.total)>0?"),'zero denominator must not show fabricated return 0%');
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
const return80=run('WHPP',{total:20,pod:10,returned:5,returning:2,delivery:1,pending:2,abnormal:0,otherNormal:0});
assert.match(return80.v625BusinessLegend.innerHTML,/已退回 5（25.00%）/);
assert.match(return80.v625BusinessLegend.innerHTML,/退回中 2（10.00%）/);
assert.match(return80.v625BusinessLegend.innerHTML,/已签收 10（50.00%）/);
assert.doesNotMatch(return80.v625BusinessLegend.innerHTML,/待核验/);
// shipmentStatus80 is not tracking eventCode80: only the former signals returning.
const classifierStart=source.indexOf('function rowText(');
const classifierEnd=source.indexOf('\nfunction rowIsPending(',classifierStart);
assert.ok(classifierStart>=0&&classifierEnd>classifierStart);
const classify=(input)=>vm.runInNewContext(source.slice(classifierStart,classifierEnd)+'\nrowIsReturning(input);',{input},{timeout:1000});
assert.equal(classify({shipmentStatus:'80',currentState:'POD'}),true,'TMS 80 outranks legacy POD');
assert.equal(classify({shipmentStatus:'81',currentState:'RETURN_IN_PROGRESS'}),false,'TMS 81 is completed returned');
assert.equal(classify({shipmentStatus:'60',退回状态:'退回中'}),false,'TMS 60 is POD');
assert.equal(classify({eventCode:'80'}),false,'tracking eventCode80 must not mean return in progress');
assert.equal(classify({currentState:'RETURN_IN_PROGRESS'}),true);
// Verify the actual two business-accounting paths, including stale POD and
// returned tabs containing a newer TMS 80: each waybill must be counted once.
const accountingEnd=source.indexOf('\nfunction v628MetricRows(',classifierStart);
assert.ok(accountingEnd>classifierEnd);
const t80={shipmentCode:'TEST80',shipmentStatus:'80',currentState:'RETURN_IN_PROGRESS'};
const t60={shipmentCode:'TEST60',shipmentStatus:'60',currentState:'POD',是否POD:'是'};
const t81={shipmentCode:'TEST81',shipmentStatus:'81',currentState:'RETURNED',退回状态:'已退回'};
const detailed=vm.runInNewContext(source.slice(classifierStart,accountingEnd)+`\n({
  whpp:buildWhppCanonicalAccounting(whppState,{total:3}),
  shopee:buildBusinessAccounting({finalRows:[t80,t60,t81]},{total:3})
});`,{
  business:'SHOPEECN',
  whppState:{dashboard:{metrics:{total:3}},detailTabs:{
    all:{rows:[t80,t60,t81]},pod:{rows:[t80,t60]},returned:{rows:[t80,t81]},
    unresolved:{rows:[t80]}
  }},t80,t60,t81
},{timeout:1000});
for(const kind of ['whpp','shopee']){
  const state=detailed[kind];
  assert.equal(state.rowsByKind.returning.length,1,kind+' must isolate the TMS 80 parcel');
  assert.equal(state.rowsByKind.pod.length,1,kind+' must not count old POD for TMS 80');
  assert.equal(state.rowsByKind.returned.length,1,kind+' must not count old 81 for TMS 80');
  assert.equal(state.accounted,3,kind+' status categories must conserve 3 waybills');
  assert.equal(state.difference,0);
}
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
const zero=run('SHOPEECN',{total:0,pod:0,returned:0,delivery:0,pending:0,abnormal:0,otherNormal:0});
assert.match(zero.v625BusinessLegend.textContent,/暂无数据/,'empty business/date must say no data');
assert.equal(zero.v625BusinessDonut.style.background,'var(--v625-border,#dce5ef)','empty business/date must not show a red donut');
assert.doesNotMatch(zero.v625BusinessLegend.innerHTML,/0[（(]0[.%]/,'empty business/date must not invent percentages');
const zeroButCounted=run('SHOPEECN',{total:0,pod:1,returned:0,delivery:0,pending:0,abnormal:0,otherNormal:0});
assert.match(zeroButCounted.v625BusinessLegend.textContent,/分类存在重叠/,'bad zero-member accounting must remain visibly blocked');
console.log('[V788 BOARD DONUT] WHPP POD124 return32, missing category guard, overlap guard, CE category scope PASS');
