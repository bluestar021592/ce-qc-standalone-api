(function installV307ExactDailyHomeOwner(global){
  if(global.__CE_QC_V307_EXACT_DAILY_HOME_OWNER__)return;
  const VERSION='2026-08-25-v307-exact-daily-seven-business-home-v1';
  const TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
  const LABELS={
    '总览':'ALL','CE':'CE','CEAF空运':'CEAF','TBKH':'TBKH','ALI1688':'ALI1688',
    'SHOPEE CN':'SHOPEECN','SHOPEE VN':'SHOPEEVN','WHPP本土':'WHPP'
  };
  const cache=new Map();
  let seq=0,timer=null;
  const date=v=>String(v||'').slice(0,10);
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const fmt=v=>num(v).toLocaleString('zh-CN');
  const pct=(v,t)=>t?`${(num(v)*100/num(t)).toFixed(2)}%`:'0.00%';
  function range(){
    const to=date(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'');
    const from=date(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to);
    return{from,to};
  }
  function visibleHome(){const root=document.getElementById('homePage');return root&&!root.hidden&&getComputedStyle(root).display!=='none'?root:null;}
  async function json(url){const r=await fetch(url,{cache:'no-store',credentials:'same-origin'});const raw=await r.text();let j={};try{j=raw?JSON.parse(raw):{};}catch{}if(!r.ok||j?.ok===false)throw new Error(j?.error||j?.message||`HTTP ${r.status}`);return j;}
  function exactRow(data,d){return (Array.isArray(data?.daily)?data.daily:[]).find(row=>date(row?.reportDate)===d)||null;}
  async function loadExact(d){
    const hit=cache.get(d);if(hit&&Date.now()-hit.at<30000)return hit.value;
    const rows=await Promise.all(TYPES.map(async type=>{
      const data=await json(`/api/v253/trends?businessType=${encodeURIComponent(type)}&from=${encodeURIComponent(d)}&to=${encodeURIComponent(d)}`);
      const row=exactRow(data,d);
      return[type,{total:num(row?.total),pod:num(row?.pod),oc:num(row?.ocCurrent??row?.oc),sameDayPod:num(row?.sameDayPod),ready:row?.ready!==false}];
    }));
    const states=Object.fromEntries(rows);const total=TYPES.reduce((sum,type)=>sum+num(states[type]?.total),0);
    const value={date:d,total,states};cache.set(d,{at:Date.now(),value});return value;
  }
  function patchDateCaption(root,d){
    root.querySelectorAll('h1,h2,h3,p,small,span').forEach(node=>{
      if(node.children.length)return;
      const t=String(node.textContent||'');
      if(/当前日报\s+\d{4}-\d{2}-\d{2}/.test(t))node.textContent=t.replace(/当前日报\s+\d{4}-\d{2}-\d{2}/,`当前日报 ${d}`);
    });
  }
  function patchCards(root,data){
    const grid=root.querySelector('.v18-business-grid');if(!grid)return false;
    for(const card of grid.querySelectorAll('.v18-business-card')){
      const label=String(card.querySelector('span')?.textContent||'').trim();const type=LABELS[label];if(!type)continue;
      const value=type==='ALL'?data.total:num(data.states[type]?.total);const b=card.querySelector('b'),em=card.querySelector('em'),small=card.querySelector('small');
      if(b)b.textContent=fmt(value);if(em)em.textContent=type==='ALL'?'占总票数 100.00%':`占总票数 ${pct(value,data.total)}`;if(small&&type!=='ALL')small.textContent='今日票数';
      card.dataset.v307ExactDate=data.date;
    }
    grid.dataset.v307ExactTotal=String(data.total);grid.dataset.v307ExactDate=data.date;return true;
  }
  async function apply(force=false){
    const root=visibleHome(),rg=range();if(!root||!rg.from||rg.from!==rg.to)return;
    const my=++seq;try{const data=await loadExact(rg.to);if(my!==seq||!visibleHome()||range().to!==data.date)return;patchDateCaption(root,data.date);patchCards(root,data);root.dataset.v307ExactDaily=data.date;}catch(error){console.warn('[CE-QC][V307_EXACT_DAILY_HOME]',error?.message||error);}
  }
  function schedule(ms=250){clearTimeout(timer);timer=setTimeout(()=>apply(true),ms);}
  function bind(){
    schedule(500);setInterval(()=>{const rg=range(),root=visibleHome();if(root&&rg.from&&rg.from===rg.to&&root.dataset.v307ExactDaily!==rg.to)schedule(0);else if(root&&rg.from===rg.to)schedule(0);},2000);
    document.addEventListener('click',e=>{if(e.target?.closest?.('#topRangeQuery,.top-range-query,#dashboardRangeQuery,.side-link[data-page]')){schedule(350);setTimeout(()=>schedule(0),1200);}},true);
    document.addEventListener('change',e=>{if(e.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(350);},true);
    global.addEventListener('ce:exact-date-loaded',()=>{cache.clear();schedule(50);setTimeout(()=>schedule(0),900);});
    global.addEventListener('popstate',()=>schedule(350));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V307_EXACT_DAILY_HOME_OWNER__={version:VERSION,apply,loadExact,types:[...TYPES]};
  console.info('[CE-QC][V307_EXACT_DAILY_HOME]',VERSION,'single-day homepage total and all seven business cards are recomputed from the same exact V253 daily membership rows; late period-dashboard WHPP/total mutations cannot leave mixed dates.');
})(window);
