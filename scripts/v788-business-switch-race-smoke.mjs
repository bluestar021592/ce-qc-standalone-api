// V788 regression: real async loadBusiness() source must not repaint a new
// CN/VN/date board when older business-state or signing-time HTTP resolves.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('public/v625-shell.js','utf8');
const begin=source.indexOf('async function loadBusiness(options={}){');
const end=source.indexOf('\nfunction rowTr(',begin);
assert.ok(begin>=0&&end>begin,'exercise the shipped business loader, not a recreated approximation');
const businessLoader=source.slice(begin,end);

function deferred(){
  let resolve,reject;
  const promise=new Promise((r,j)=>{resolve=r;reject=j});
  return {promise,resolve,reject};
}
async function flush(){for(let i=0;i<12;i++)await Promise.resolve()}

function harness(){
  const reads=new Map(),elements=new Map(),pendingStates=[],pendingFast=[],pendingFull=[];
  function node(id){
    if(!elements.has(id))elements.set(id,{
      id,value:'2026-07-02',hidden:false,innerHTML:'',style:{setProperty(){}}
    });
    return elements.get(id);
  }
  const c={
    page:'business',business:'SHOPEECN',
    v765BoardLoadGeneration:0,
    v626LatestImport:{reportDate:'2026-07-02',snapshotId:'snap-1'},
    v630BusinessDetailTabs:{},v631BusinessAccounting:{},
    v628BusinessMetricState:{},v628BusinessReportDate:'',
    location:{search:'?reportDate=2026-07-02&snapshotId=snap-1'},
    URLSearchParams,console,
    byId:node,
    selectedReportDate:()=>'2026-07-02',
    syncDashboardNavigationContext(){},
    metricState:x=>x,
    fmt:x=>String(x??0),
    pct:x=>Number(x).toFixed(2)+'%',
    esc:x=>String(x).replace(/[&<>"']/g,'_'),
    setText(id,value){reads.set(id,String(value))},
    renderDonut(){},applyVerifiedBusinessKpis(){return true},
    v765LoadBusinessDetailLane(){return Promise.resolve()},
    scheduleHistoricalEvidenceRefresh(){},stopHistoricalEvidenceRefresh(){},
    setTimeout:fn=>{Promise.resolve().then(fn);return 1},
    json(url){
      const task=deferred();
      if(url.startsWith('/api/business-state/')){pendingStates.push({url,task});return task.promise}
      if(url.startsWith('/api/home-quality-summary?')){
        const fast=new URL(url,'http://localhost').searchParams.has('fast');
        (fast?pendingFast:pendingFull).push({url,task});
        return task.promise;
      }
      throw Error('Unexpected HTTP '+url);
    }
  };
  vm.createContext(c);
  vm.runInContext(businessLoader,c,{filename:'v625-shell.js',timeout:2000});
  const state=(kind,total)=>({
    reportDate:'2026-07-02',snapshotId:'snap-1',state:{
      total,pod:Math.floor(total/2),returned:total/10,returning:0,
      pending:0,oc:0,unresolved:0,delivery:Math.ceil(total*0.4),
      otherNormal:0,avgDays:null,snapshotStatus:'COMPLETED',detailTabs:{}
    }
  });
  return {c,reads,pendingStates,pendingFast,pendingFull,state};
}
{
  const h=harness();
  const a=h.c.loadBusiness();
  h.c.business='SHOPEEVN';
  const b=h.c.loadBusiness();
  await flush();
  assert.equal(h.pendingStates.length,2);
  assert.match(h.pendingStates[0].url,/SHOPEECN/);
  assert.match(h.pendingStates[1].url,/SHOPEEVN/);
  h.pendingStates[1].task.resolve(h.state('SHOPEEVN',200));
  await b;
  assert.equal(h.reads.get('kpiTotal'),'200');
  h.pendingStates[0].task.resolve(h.state('SHOPEECN',100));
  await a;
  assert.equal(h.reads.get('kpiTotal'),'200',
    'stale business-state response must never repaint newer VN view');
  assert.equal(h.c.v628BusinessMetricState.total,200);
}
{
  const h=harness();
  const a=h.c.loadBusiness();
  await flush();
  h.pendingStates[0].task.resolve(h.state('SHOPEECN',100));
  await a;
  await flush();
  assert.equal(h.pendingFast.length,1);
  // CN quick response lacks time; this starts a slower full timing request.
  h.pendingFast[0].task.resolve({reportDate:'2026-07-02',timing:{}});
  await flush();
  assert.equal(h.pendingFull.length,1);
  h.c.business='SHOPEEVN';
  const b=h.c.loadBusiness();
  await flush();
  h.pendingStates[1].task.resolve(h.state('SHOPEEVN',200));
  await b;
  await flush();
  h.pendingFast[1].task.resolve({
    reportDate:'2026-07-02',timing:{SHOPEEVN:{overall:{avgDays:4.5}}}
  });
  await flush();
  assert.equal(h.reads.get('kpiAvgDays'),'4.50');
  h.pendingFull[0].task.resolve({
    reportDate:'2026-07-02',timing:{SHOPEECN:{overall:{avgDays:9.99}}}
  });
  await flush();
  assert.equal(h.reads.get('kpiAvgDays'),'4.50',
    'slow CN signing time must not overwrite VN for the same report date');
  assert.equal(h.c.v628BusinessReportDate,'2026-07-02');
}
{
  const h=harness();
  const a=h.c.loadBusiness();
  await flush();
  h.pendingStates[0].task.resolve({
    ...h.state('SHOPEECN',100),reportDate:'2026-07-01'
  });
  await a;
  assert.notEqual(h.reads.get('kpiTotal'),'100',
    'a source response for another day must not show 100 parcels');
}
console.log('[V788 BUSINESS SWITCH] PASS stale source, old CN full timing vs VN, wrong source date blocked');
