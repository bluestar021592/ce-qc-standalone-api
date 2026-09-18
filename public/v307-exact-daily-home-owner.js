(function installV307ExactDailyHomeOwner(global){
  if(global.__CE_QC_V307_EXACT_DAILY_HOME_OWNER__)return;
  const VERSION='2026-09-18-stability-home-cards-v319-cache-v1';
  const TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
  const LABELS={'总览':'ALL','CE':'CE','CEAF空运':'CEAF','TBKH':'TBKH','ALI1688':'ALI1688','SHOPEE CN':'SHOPEECN','SHOPEE VN':'SHOPEEVN','WHPP本土':'WHPP'};
  const cache=new Map();
  const CACHE_MS=6*60*60*1000;
  let seq=0,timer=null,lastData=null;
  const date=v=>String(v||'').slice(0,10);
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const fmt=v=>num(v).toLocaleString('zh-CN');
  const pct=(v,t)=>t?`${(num(v)*100/num(t)).toFixed(2)}%`:'0.00%';
  function range(){const to=date(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||''),from=date(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to);return{from,to};}
  function visibleHome(){const root=document.getElementById('homePage');return root&&!root.hidden&&getComputedStyle(root).display!=='none'?root:null;}
  async function json(url){const r=await fetch(url,{cache:'no-store',credentials:'same-origin'}),raw=await r.text();let j={};try{j=raw?JSON.parse(raw):{};}catch{}if(!r.ok||j?.ok===false)throw new Error(j?.error||j?.message||`HTTP ${r.status}`);return j;}
  function exactRow(data,d){return (Array.isArray(data?.daily)?data.daily:[]).find(row=>date(row?.reportDate)===d)||null;}
  async function loadExact(d){const hit=cache.get(d);if(hit&&Date.now()-hit.at<CACHE_MS)return hit.value;const rows=await Promise.all(TYPES.map(async type=>{const data=await json(`/api/v319/trends?businessType=${encodeURIComponent(type)}&from=${encodeURIComponent(d)}&to=${encodeURIComponent(d)}`),row=exactRow(data,d);return[type,{total:num(row?.total),pod:num(row?.pod),oc:num(row?.ocCurrent??row?.oc),sameDayPod:num(row?.sameDayPod),ready:row?.ready!==false}];}));const states=Object.fromEntries(rows),total=TYPES.reduce((sum,type)=>sum+num(states[type]?.total),0),value={date:d,total,states};cache.set(d,{at:Date.now(),value});return value;}
  function patchDateCaption(root,d){root.querySelectorAll('h1,h2,h3,p,small,span').forEach(node=>{if(node.children.length)return;const t=String(node.textContent||'');if(/当前日报\s+\d{4}-\d{2}-\d{2}/.test(t)){const next=t.replace(/当前日报\s+\d{4}-\d{2}-\d{2}/,`当前日报 ${d}`);if(node.textContent!==next)node.textContent=next;}});}
  function ensureWhppCard(grid){let card=[...grid.querySelectorAll('.v18-business-card')].find(node=>String(node.querySelector('span')?.textContent||'').trim()==='WHPP本土');if(card)return card;card=document.createElement('button');card.className='v18-business-card cyan';card.dataset.v325Whpp='1';card.innerHTML='<span>WHPP本土</span><small>今日票数</small><b>0</b><em>占总票数 0.00%</em>';card.addEventListener('click',()=>{if(typeof global.navigatePage==='function')global.navigatePage('whpp');else document.querySelector('.side-link[data-page="whpp"]')?.click();});grid.appendChild(card);return card;}
  function setText(node,value){if(node&&node.textContent!==value)node.textContent=value;}
  function patchCards(root,data){const grid=root.querySelector('.v18-business-grid');if(!grid)return false;ensureWhppCard(grid);for(const card of grid.querySelectorAll('.v18-business-card')){const label=String(card.querySelector('span')?.textContent||'').trim(),type=LABELS[label];if(!type)continue;const value=type==='ALL'?data.total:num(data.states[type]?.total),b=card.querySelector('b'),em=card.querySelector('em'),small=card.querySelector('small');setText(b,fmt(value));setText(em,type==='ALL'?'占总票数 100.00%':`占总票数 ${pct(value,data.total)}`);if(type!=='ALL')setText(small,'今日票数');card.dataset.v307ExactDate=data.date;}grid.dataset.v307ExactTotal=String(data.total);grid.dataset.v307ExactDate=data.date;return true;}
  function repairFromCanonical(){const root=visibleHome(),rg=range();if(!root||!rg.from||rg.from!==rg.to)return;if(lastData&&lastData.date===rg.to){patchDateCaption(root,lastData.date);patchCards(root,lastData);root.dataset.v307ExactDaily=lastData.date;}else schedule(0);}
  async function apply(){const root=visibleHome(),rg=range();if(!root||!rg.from||rg.from!==rg.to)return;const my=++seq;try{const data=await loadExact(rg.to);if(my!==seq||!visibleHome()||range().to!==data.date)return;lastData=data;patchDateCaption(root,data.date);patchCards(root,data);root.dataset.v307ExactDaily=data.date;}catch(error){console.warn('[CE-QC][V325_EXACT_DAILY_HOME]',error?.message||error);}}
  function schedule(ms=120){clearTimeout(timer);timer=setTimeout(()=>apply(),ms);}
  function bind(){schedule(250);document.addEventListener('click',e=>{if(e.target?.closest?.('#topRangeQuery,.top-range-query,#dashboardRangeQuery,.side-link[data-page]'))schedule(120);},true);document.addEventListener('change',e=>{if(e.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(120);},true);global.addEventListener('ce:exact-date-loaded',()=>{cache.clear();lastData=null;schedule(20);});global.addEventListener('popstate',()=>schedule(120));const observer=new MutationObserver(()=>repairFromCanonical());if(document.body)observer.observe(document.body,{subtree:true,childList:true,characterData:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V307_EXACT_DAILY_HOME_OWNER__={version:VERSION,apply,loadExact,repairFromCanonical,types:[...TYPES]};
  console.info('[CE-QC][V325_EXACT_DAILY_HOME]',VERSION,'single-day homepage business cards read seven exact V319 saved-cache memberships only; no request-time historical or ledger recalculation.');
})(window);
