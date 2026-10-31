import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync('public/v625-shell.html','utf8');
const js=fs.readFileSync('public/v625-shell.js','utf8');
const css=fs.readFileSync('public/v801-home-layout.css','utf8');
const home=html.slice(html.indexOf('<section id="v625Home"'),html.indexOf('<!-- BUSINESS -->'));
assert.ok(home.length>10000,'home page source must be present');
for(const name of ['Overall','PP','PV','Attempt1','Attempt2','Attempt3','Returned','ReturnRate']){
  assert.equal(home.split('id="v801Timing'+name+'"').length-1,1,'summary metric unique '+name);
}
assert.match(home,/签收时效总览/);
assert.match(home,/href="#v801TimingDashboard" class="v801-signing-jump"/);
assert.match(home,/id="v801TimingDashboard" class="v625-panel v625-signing-panel"/);
for(const type of ['TBKH','WHPP','SHOPEECN','SHOPEEVN'])
  assert.equal(home.split('data-timing="'+type+'"').length-1,1,'visible timing card '+type);
assert.match(js,/bottom\.append\(timing\);bottom\.after\(open\)/);
assert.match(js,/open\.after\(management\);management\.after\(optional\)/);
assert.match(css,/\.v625-timing-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(css,/\.v801-timing-summary\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
assert.match(css,/max-height:none!important/);
assert.match(css,/overflow:visible!important/);
assert.match(html,/v801-home-layout\.css\?v=20261031-v801-1/);
assert.match(html,/v625-shell\.js\?v=20261031-v801-1&patch=801/);
assert.match(js,/v801RenderTimingSummary\(timing,summary\?\.reportDate\|\|requestedDate\|\|''\)/);
assert.match(js,/v801RenderVerifiedReturns\(payload\)/);
const start=js.indexOf('function v801TimingAggregate(');
const end=js.indexOf('function v800SetWhppMetrics(',start);
assert.ok(start>=0&&end>start,'use actual V801 production evidence helper');
const context={page:'home',setText(){},fmt:n=>String(n),pct:n=>Number(n).toFixed(2)+'%'};
vm.createContext(context);
vm.runInContext(js.slice(start,end),context,{timeout:1000});
const aggregate=context.v801TimingAggregate;
const valid={TBKH:{overall:{podCount:10,avgDays:2,totalPodCount:15},
  pp:{podCount:7,avgDays:2},attempt1:{podCount:6,avgDays:1}},
  WHPP:{overall:{podCount:20,avgDays:4,totalPodCount:24},
  pp:{podCount:12,avgDays:4},attempt1:{podCount:9,avgDays:3}},
  SHOPEECN:{overall:{podCount:0,avgDays:null,totalPodCount:0}},
  SHOPEEVN:{overall:{podCount:0,avgDays:0,totalPodCount:0}}};
const all=aggregate(valid,'overall');
assert.equal(all.count,30);
assert.equal(all.totalPod,39);
assert.ok(Math.abs(all.avgDays-100/30)<1e-10,'sample weighted, not mean of business means');
assert.equal(aggregate(valid,'pp').count,19);
assert.equal(aggregate(valid,'attempt1').count,15);
assert.equal(aggregate(valid,'attempt2').avgDays,null,'no verified second attempt remains blank');
assert.equal(aggregate({},'overall').avgDays,null,'unknown evidence never becomes 0 days');
const painted=new Map();
context.setText=(id,text)=>painted.set(id,String(text));
vm.runInContext('v801RenderTimingSummary({TBKH:{overall:{podCount:0,avgDays:null,totalPodCount:5}}},"2026-07-12")',context);
assert.equal(painted.get('v801TimingOverall'),'—');
assert.match(painted.get('v801TimingStatus'),/不能把缺失显示为0天/);
vm.runInContext('v801RenderTimingSummary(sample,"2026-07-12")',Object.assign(context,{sample:valid}));
assert.match(painted.get('v801TimingOverall'),/3.33天/);
assert.match(painted.get('v801TimingOverallSample'),/可信 30票 \/ POD 39票/);
const unverified={ok:true,selectionMatched:true,returns:{
  WHPP:{verified:true,count:5,total:100},
  SHOPEECN:{verified:false,count:0,total:50},
  SHOPEEVN:{verified:true,count:2,total:60}}};
context.payload=unverified;
vm.runInContext('v801RenderVerifiedReturns(payload)',context);
assert.equal(painted.get('v801TimingReturnRate'),'—','partial return proof stays unknown');
context.payload.returns.SHOPEECN={verified:true,count:10,total:50};
vm.runInContext('v801RenderVerifiedReturns(payload)',context);
assert.equal(painted.get('v801TimingReturned'),'17票');
assert.equal(painted.get('v801TimingReturnRate'),(17/210*100).toFixed(2)+'%');
console.log('[V801 HOME SIGNING] PASS full-width four-business overview, sample-weighted truth, null proof, three-business return verification');
