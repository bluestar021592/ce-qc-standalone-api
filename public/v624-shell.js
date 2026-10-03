(()=>{
'use strict';
const body=document.body;
const page=String(body.dataset.page||'home');
const business=String(body.dataset.business||'');
document.querySelectorAll('.v624-nav a[data-key]').forEach(a=>a.classList.toggle('active',a.dataset.key===page));
const home=document.getElementById('v624Home');
const biz=document.getElementById('v624Business');
if(page==='home'){home.hidden=false;biz.hidden=true;}else{home.hidden=true;biz.hidden=false;}

const num=v=>Number.isFinite(Number(v))?Number(v):null;
const fmt=v=>v===null||v===undefined?'—':Number(v).toLocaleString('zh-CN');
const pct=v=>v===null||v===undefined?'—':Number(v).toFixed(2).replace(/\.00$/,'')+'%';
const first=(obj,paths)=>{
  for(const p of paths){
    let cur=obj;
    for(const part of p.split('.'))cur=cur?.[part];
    if(cur!==undefined&&cur!==null&&cur!=='')return cur;
  }
  return null;
};
async function json(url,timeout=7000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const res=await fetch(url,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
    if(!res.ok)throw new Error('HTTP '+res.status);
    return await res.json();
  }finally{clearTimeout(timer);}
}
function metrics(state){
  const m=state?.dashboard?.metrics||state?.metrics||state?.dashboard||{};
  const total=num(first(state,['total','today','dashboard.metrics.total','dashboard.total','dailySummary.total']));
  const pod=num(first(state,['pod','podCount','dashboard.metrics.pod','dashboard.metrics.todayPod','dashboard.pod']));
  const podRate=num(first(state,['podRate','dashboard.metrics.podRate','dashboard.podRate']));
  const pending=num(first(state,['pending','pendingCount','dashboard.metrics.pending','dashboard.metrics.pending1','dashboard.pending']));
  const oc=num(first(state,['oc','ocCount','dashboard.metrics.oc','dashboard.metrics.oc1','dashboard.oc']));
  const open=num(first(state,['unresolved','open','dashboard.metrics.unresolved','dashboard.metrics.currentOpen','dashboard.open']));
  return{total,pod,podRate:podRate??(total&&pod!==null?pod/total*100:null),pending,oc,open};
}
async function loadBusiness(type){
  const status=document.getElementById('v624BusinessStatus');
  try{
    const payload=await json('/api/business-state/'+encodeURIComponent(type)+'?compact=1');
    const state=payload.state||payload;
    const m=metrics(state);
    document.getElementById('kpiTotal').textContent=fmt(m.total);
    document.getElementById('kpiPod').textContent=fmt(m.pod);
    document.getElementById('kpiPodRate').textContent=pct(m.podRate);
    document.getElementById('kpiPending').textContent=fmt(m.pending);
    document.getElementById('kpiOc').textContent=fmt(m.oc);
    document.getElementById('kpiOpen').textContent=fmt(m.open);
    document.getElementById('v624SnapshotMeta').textContent=[payload.reportDate||state.reportDate||'—',payload.snapshotStatus||state.snapshotStatus||''].filter(Boolean).join(' · ');
    status.textContent='业务快照读取完成。导航与数据读取相互独立，数据接口异常不会影响页面跳转。';
  }catch(err){
    status.textContent='数据暂时未读取成功：'+(err?.name==='AbortError'?'请求超时':String(err?.message||err))+'。页面导航仍可正常使用。';
    document.getElementById('v624SnapshotMeta').textContent='数据未就绪';
  }
}
async function loadHome(){
  const status=document.getElementById('v624HomeStatus');
  const types=['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'];
  let ok=0;
  await Promise.all(types.map(async type=>{
    try{
      const payload=await json('/api/business-state/'+encodeURIComponent(type)+'?compact=1',5000);
      const state=payload.state||payload;
      const card=document.querySelector('[data-card="'+type+'"] b');
      if(card)card.textContent=fmt(metrics(state).total);
      ok++;
    }catch{}
  }));
  status.textContent='已读取 '+ok+' / '+types.length+' 个业务看板。未返回的数据不会阻塞其他页面。';
}
function reload(){if(page==='home')void loadHome();else if(business)void loadBusiness(business);}
document.getElementById('v624Reload')?.addEventListener('click',reload);
reload();
})();