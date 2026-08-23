(function installV261DashboardFinalOwner(global){
  if(global.__CE_QC_V261_DASHBOARD_FINAL_OWNER__)return;
  global.__CE_QC_V261_DASHBOARD_FINAL_OWNER__=true;
  const VERSION='2026-08-23-v261-dashboard-final-owner-v1';
  const PAGE_TYPE={ce:'CE',ceaf:'CEAF',tbkh:'TBKH',ali1688:'ALI1688',whpp:'WHPP',shopeecn:'SHOPEECN',shopeevn:'SHOPEEVN'};
  let timer=null,busy=false,lastKey='';
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=(v,kind='count')=>v===null||v===undefined?'—':kind==='rate'?`${n(v).toFixed(2)}%`:kind==='days'?`${n(v).toFixed(2)}天`:Math.round(n(v)).toLocaleString('zh-CN');

  function activePage(){
    const active=document.querySelector('.side-link.active[data-page]')?.dataset?.page||'';
    if(active)return String(active).toLowerCase();
    const title=String(document.getElementById('pageTitle')?.textContent||'').toUpperCase();
    if(title.includes('SHOPEE CN'))return 'shopeecn';
    if(title.includes('SHOPEE VN'))return 'shopeevn';
    if(title.includes('CEAF'))return 'ceaf';
    if(title.includes('TBKH'))return 'tbkh';
    if(title.includes('ALI1688'))return 'ali1688';
    if(title.includes('WHPP'))return 'whpp';
    if(/^CE看板/.test(title))return 'ce';
    if(title.includes('首页'))return 'home';
    return String(location.pathname||'/').replace(/^\/+|\/+$/g,'').toLowerCase()||'home';
  }
  const activeType=()=>PAGE_TYPE[activePage()]||'';
  function range(){
    const to=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);
    const from=String(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to).slice(0,10);
    return{from,to};
  }
  function rootFor(type){
    if(type==='WHPP')return [...document.querySelectorAll('#whppFastPage,#whppPage')].find(r=>r&&!r.hidden)||document.getElementById('whppFastPage')||document.getElementById('whppPage');
    if(type.startsWith('SHOPEE'))return document.getElementById('shopeePage');
    if(['CE','CEAF','TBKH','ALI1688'].includes(type))return document.getElementById('ccslPage');
    return null;
  }
  function ensureStyle(){
    if(document.getElementById('v261FinalStyle'))return;
    const s=document.createElement('style');s.id='v261FinalStyle';s.textContent=`
      .v261-final-panel{margin-top:16px!important;padding:0!important;overflow:hidden!important}
      .v261-final-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:15px 17px 11px;border-bottom:1px solid #e6eef8;background:#fbfdff}
      .v261-final-head h2{margin:0;color:#17365d;font-size:18px}.v261-final-head p{margin:5px 0 0;color:#6f829c;font-size:12px;line-height:1.6}
      .v261-final-head span{white-space:nowrap;color:#6e86a7;font-size:12px}
      .v261-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:14px}
      .v261-card{min-width:0;border:1px solid #dce8f6;border-radius:9px;background:#fff;padding:12px;box-sizing:border-box}
      .v261-card-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.v261-card-head h3{margin:0;color:#17365d;font-size:15px}.v261-card-head span{font-size:11px;color:#8296b0}
      .v261-plot{height:190px;margin-top:8px}.v261-plot svg{width:100%;height:100%;display:block}.v261-gridline{stroke:#e7eef7;stroke-width:1}.v261-axis{fill:#7890ad;font-size:9px}
      .v261-current{display:flex;justify-content:space-between;align-items:flex-end;border-top:1px solid #edf2f8;margin-top:8px;padding-top:9px}.v261-current span{color:#7b8fa9;font-size:11px}.v261-current b{font-size:21px;color:#1677ff}.v261-current small{color:#8da0b7;font-size:10px}
      .v261-table-wrap{overflow:auto;padding:0 14px 14px}.v261-table{width:100%;border-collapse:collapse;min-width:800px;font-size:12px}.v261-table th,.v261-table td{padding:9px 10px;border-bottom:1px solid #edf2f8;text-align:right;white-space:nowrap}.v261-table th{background:#f5f9fe;color:#58708e}.v261-table th:first-child,.v261-table td:first-child{text-align:left}
      .v261-attempt{margin-top:14px!important}.v261-attempt .v261-attempt-chart{margin:14px;border:1px solid #dce8f6;border-radius:9px;background:#fff;padding:12px}.v261-attempt .v261-plot{height:240px}
      .v261-attempt-legend{display:flex;gap:18px;margin:2px 0 4px;color:#607791;font-size:12px}.v261-attempt-legend i{display:inline-block;width:12px;height:3px;margin-right:5px;vertical-align:middle;border-radius:2px}
      #v252HomeShopeeLifecycle{margin-top:12px!important;min-height:0!important;height:auto!important}#v252HomeShopeeLifecycle .v252-wrap{padding-bottom:8px!important}
      @media(max-width:1300px){.v261-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.v261-grid{grid-template-columns:1fr}}
    `;document.head.appendChild(s);
  }
  function svg(tag,attrs={}){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,String(v));return el;}
  function renderSingle(card,{title,dates,values,kind='count'}){
    if(!card)return;const valid=(values||[]).filter(v=>v!==null&&v!==undefined).map(n);const maxData=Math.max(...valid,1);const max=kind==='rate'?100:kind==='days'?Math.max(3,Math.ceil(maxData*1.25*10)/10):Math.max(10,Math.ceil(maxData*1.18/10)*10);
    card.innerHTML=`<div class="v261-card-head"><h3>${esc(title)}</h3><span>${dates.length}个有效日报日</span></div><div class="v261-plot"></div><div class="v261-current"><div><span>当前</span><br><b>—</b></div><small></small></div>`;
    const W=360,H=170,p={l:42,r:18,t:15,b:28},chart=svg('svg',{viewBox:`0 0 ${W} ${H}`});
    for(let i=0;i<=3;i++){const y=p.t+(H-p.t-p.b)*i/3;chart.appendChild(svg('line',{x1:p.l,x2:W-p.r,y1:y,y2:y,class:'v261-gridline'}));const tx=svg('text',{x:p.l-5,y:y+3,'text-anchor':'end',class:'v261-axis'});tx.textContent=fmt(max*(1-i/3),kind);chart.appendChild(tx);}
    (dates||[]).forEach((d,i)=>{const x=p.l+(W-p.l-p.r)*i/Math.max(1,dates.length-1);const tx=svg('text',{x,y:H-6,'text-anchor':'middle',class:'v261-axis'});tx.textContent=String(d||'').slice(5);chart.appendChild(tx);});
    const pts=[];(values||[]).forEach((v,i)=>{if(v===null||v===undefined)return;const val=n(v),x=p.l+(W-p.l-p.r)*i/Math.max(1,dates.length-1),y=p.t+(H-p.t-p.b)*(1-Math.min(max,val)/max);pts.push({x,y,val});chart.appendChild(svg('circle',{cx:x,cy:y,r:3,fill:'#1677ff'}));if(dates.length<=10){const tx=svg('text',{x,y:Math.max(10,y-6),'text-anchor':'middle',fill:'#1677ff','font-size':'8','font-weight':'700'});tx.textContent=fmt(val,kind);chart.appendChild(tx);}});
    if(pts.length>1)chart.appendChild(svg('polyline',{points:pts.map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:'#1677ff','stroke-width':'2.2','stroke-linecap':'round','stroke-linejoin':'round'}));
    card.querySelector('.v261-plot').appendChild(chart);const last=pts.at(-1)?.val??null;card.querySelector('.v261-current b').textContent=fmt(last,kind);card.querySelector('.v261-current small').textContent=pts.length<2?'当前有效节点不足2天':'已按真实日报事实绘制';
  }
  function renderMultiAttempt(host,data){
    const dates=data?.dates||[],series=[['1派',data?.attempt1Rate||[],'#1677ff'],['2派',data?.attempt2Rate||[],'#16a36a'],['3派+',data?.attempt3Rate||[],'#ff8a00']];
    host.innerHTML=`<div class="v261-attempt-legend">${series.map(s=>`<span><i style="background:${s[2]}"></i>${s[0]}</span>`).join('')}</div><div class="v261-plot"></div>`;
    const W=900,H=245,p={l:50,r:28,t:18,b:34},chart=svg('svg',{viewBox:`0 0 ${W} ${H}`});
    for(let i=0;i<=4;i++){const y=p.t+(H-p.t-p.b)*i/4;chart.appendChild(svg('line',{x1:p.l,x2:W-p.r,y1:y,y2:y,class:'v261-gridline'}));const tx=svg('text',{x:p.l-7,y:y+3,'text-anchor':'end',class:'v261-axis'});tx.textContent=`${(100*(1-i/4)).toFixed(0)}%`;chart.appendChild(tx);}
    dates.forEach((d,i)=>{const x=p.l+(W-p.l-p.r)*i/Math.max(1,dates.length-1);const tx=svg('text',{x,y:H-8,'text-anchor':'middle',class:'v261-axis'});tx.textContent=String(d||'').slice(5);chart.appendChild(tx);});
    series.forEach(([label,values,color])=>{const pts=[];values.forEach((v,i)=>{if(v===null||v===undefined)return;const val=n(v),x=p.l+(W-p.l-p.r)*i/Math.max(1,dates.length-1),y=p.t+(H-p.t-p.b)*(1-Math.min(100,val)/100);pts.push({x,y,val});const c=svg('circle',{cx:x,cy:y,r:3,fill:color});const tt=svg('title');tt.textContent=`${dates[i]} · ${label} · ${val.toFixed(2)}%`;c.appendChild(tt);chart.appendChild(c);if(dates.length<=10){const tx=svg('text',{x,y:Math.max(10,y-6),'text-anchor':'middle',fill:color,'font-size':'8','font-weight':'700'});tx.textContent=`${val.toFixed(2)}%`;chart.appendChild(tx);}});if(pts.length>1)chart.appendChild(svg('polyline',{points:pts.map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:color,'stroke-width':'2.4','stroke-linecap':'round','stroke-linejoin':'round'}));});
    host.querySelector('.v261-plot').appendChild(chart);
  }
  function removeLegacyTrendBlocks(root,type){
    if(!root)return;
    root.querySelectorAll('#v245ShopeeAttemptTruth,#v247HomeShopeeAttempts,#v254DailyTrendTruth,#v234DailyTrendTruth').forEach(n=>n.remove());
    if(type==='WHPP'){
      [...root.querySelectorAll('section,article,div')].forEach(node=>{if(node.id==='v261FinalTrendPanel'||node.closest?.('#v261FinalTrendPanel'))return;const text=String(node.textContent||'').replace(/\s+/g,'');if(/读取已落库日报数据/.test(text)&&/(票数趋势|POD率趋势|OC率趋势|首日POD)/.test(text))node.style.display='none';});
    }
    if(type.startsWith('SHOPEE')){
      [...root.querySelectorAll('section')].forEach(node=>{if(node.id==='v261FinalTrendPanel'||node.id==='v261ShopeeAttemptPanel')return;const text=String(node.textContent||'');if(/1\s*\/\s*2\s*\/\s*3派/.test(text)||/正在读取派次趋势/.test(text))node.remove();});
    }
  }
  function ensurePanel(root,type,shopee=false){
    let panel=root.querySelector('#v261FinalTrendPanel');
    if(!panel){
      panel=document.createElement('section');panel.id='v261FinalTrendPanel';panel.className='v18-panel v261-final-panel';
      const legacy=root.querySelector('.v18-trend-section');
      if(legacy)legacy.replaceWith(panel);else{const preview=root.querySelector('#ccslPreviewPanel,#shopeePreviewPanel');preview?.parentNode?.insertBefore(panel,preview);if(!panel.isConnected)root.appendChild(panel);}
    }
    panel.dataset.type=type;panel.innerHTML=`<div class="v261-final-head"><div><h2>趋势图表</h2><p>${shopee?'持续追踪事实：票数、POD、平均签收天数、OC。':'每日已落库事实：票数、POD率、OC率、首日POD妥投率。'}</p></div><span>${esc(type)} · 最终渲染</span></div><div class="v261-grid">${Array.from({length:4},()=>'<article class="v261-card"></article>').join('')}</div><div class="v261-table-wrap"></div>`;
    return panel;
  }
  function renderGeneric(root,data,type){
    removeLegacyTrendBlocks(root,type);const panel=ensurePanel(root,type,false),cards=[...panel.querySelectorAll('.v261-card')],dates=data?.dates||[],daily=data?.daily||[];const vals=k=>daily.map(r=>r?.ready?(r[k]===null||r[k]===undefined?null:n(r[k])):null);
    renderSingle(cards[0],{title:'票数趋势',dates,values:vals('total')});renderSingle(cards[1],{title:'POD率趋势',kind:'rate',dates,values:vals('podRate')});renderSingle(cards[2],{title:'OC率趋势',kind:'rate',dates,values:vals('ocRate')});renderSingle(cards[3],{title:'首日POD妥投率趋势',kind:'rate',dates,values:vals('sameDayPodRate')});
    const rows=daily.map(r=>`<tr><td>${esc(r.reportDate)}</td><td>${fmt(r.total)}</td><td>${fmt(r.pod)}</td><td>${fmt(r.podRate,'rate')}</td><td>${fmt(r.ocCurrent)}</td><td>${fmt(r.ocRate,'rate')}</td><td>${fmt(r.sameDayPod)}</td><td>${fmt(r.sameDayPodRate,'rate')}</td></tr>`).join('');
    panel.querySelector('.v261-table-wrap').innerHTML=`<table class="v261-table"><thead><tr><th>日期</th><th>总票</th><th>POD</th><th>POD率</th><th>OC</th><th>OC率</th><th>首日POD</th><th>首日POD率</th></tr></thead><tbody>${rows||'<tr><td colspan="8">暂无有效日报数据</td></tr>'}</tbody></table>`;
  }
  function renderShopee(root,data,type){
    removeLegacyTrendBlocks(root,type);const panel=ensurePanel(root,type,true),cards=[...panel.querySelectorAll('.v261-card')],dates=data?.dates||[];
    renderSingle(cards[0],{title:'票数趋势',dates,values:data?.ticket||[]});renderSingle(cards[1],{title:'POD数量趋势',dates,values:data?.pod||[]});renderSingle(cards[2],{title:'平均签收天数趋势',kind:'days',dates,values:data?.avgPodDays||[]});renderSingle(cards[3],{title:'OC数量趋势',dates,values:data?.oc||[]});
    const daily=data?.daily||[];panel.querySelector('.v261-table-wrap').innerHTML=`<table class="v261-table"><thead><tr><th>日期</th><th>总票</th><th>POD</th><th>POD率</th><th>OC</th><th>OC率</th><th>平均签收天数</th><th>签收天数覆盖</th></tr></thead><tbody>${daily.map(r=>`<tr><td>${esc(r.reportDate)}</td><td>${fmt(r.total)}</td><td>${fmt(r.pod)}</td><td>${fmt(r.podRate,'rate')}</td><td>${fmt(r.oc)}</td><td>${fmt(r.ocRate,'rate')}</td><td>${fmt(r.avgPodDays,'days')}</td><td>${fmt(r.podDaysCount)}/${fmt(r.pod)}</td></tr>`).join('')||'<tr><td colspan="8">暂无有效日报数据</td></tr>'}</tbody></table>`;
    let attempt=root.querySelector('#v261ShopeeAttemptPanel');if(!attempt){attempt=document.createElement('section');attempt.id='v261ShopeeAttemptPanel';attempt.className='v18-panel v261-final-panel v261-attempt';panel.after(attempt);}attempt.innerHTML=`<div class="v261-final-head"><div><h2>1/2/3派签收占POD趋势</h2><p>只有真实 START → Pending/失败 → 新START 才增加派次；无证据POD保留“未识别”，不伪造0%。</p></div><span>${esc(type)} · V246严格派次</span></div><div class="v261-attempt-chart"></div><div class="v261-table-wrap"></div>`;renderMultiAttempt(attempt.querySelector('.v261-attempt-chart'),data);
    attempt.querySelector('.v261-table-wrap').innerHTML=`<table class="v261-table"><thead><tr><th>日期</th><th>POD</th><th>1派</th><th>1派/POD</th><th>2派</th><th>2派/POD</th><th>3派+</th><th>3派+/POD</th><th>未识别POD</th><th>证据覆盖</th></tr></thead><tbody>${daily.map(r=>`<tr><td>${esc(r.reportDate)}</td><td>${fmt(r.pod)}</td><td>${fmt(r.attempt1)}</td><td>${fmt(r.attempt1Rate,'rate')}</td><td>${fmt(r.attempt2)}</td><td>${fmt(r.attempt2Rate,'rate')}</td><td>${fmt(r.attempt3)}</td><td>${fmt(r.attempt3Rate,'rate')}</td><td>${fmt(r.attemptUnknown)}</td><td>${fmt(r.attemptCoverageRate,'rate')}</td></tr>`).join('')||'<tr><td colspan="10">暂无派次证据</td></tr>'}</tbody></table>`;
  }
  function cleanHome(){
    const root=document.getElementById('homePage');if(!root||root.hidden)return;
    root.querySelectorAll('#v247HomeShopeeAttempts').forEach(n=>n.remove());
    [...root.querySelectorAll('section')].forEach(node=>{if(node.id==='v252HomeShopeeLifecycle')return;const heading=[...node.querySelectorAll('h1,h2,h3,h4')].map(h=>String(h.textContent||'')).join(' ');if(/SHOPEE\s*1\s*\/\s*2\s*\/\s*3派签收占POD趋势/i.test(heading))node.remove();});
    const summary=root.querySelector('#v252HomeShopeeLifecycle');if(summary){summary.style.width='100%';summary.style.minHeight='0';summary.style.height='auto';}
  }
  async function json(url){const r=await fetch(url,{cache:'no-store',credentials:'same-origin'}),d=await r.json().catch(()=>({}));if(!r.ok||d?.ok===false)throw new Error(d?.error||`HTTP ${r.status}`);return d;}
  async function refresh(){
    if(busy)return;const page=activePage();if(page==='home'){cleanHome();return;}const type=activeType(),rg=range();if(!type||!rg.to)return;const root=rootFor(type);if(!root||root.hidden)return;const key=`${type}|${rg.from}|${rg.to}`;busy=true;try{const data=type.startsWith('SHOPEE')?await json(`/api/v246/shopee-trends?businessType=${encodeURIComponent(type)}&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}&regions=0`):await json(`/api/v253/trends?businessType=${encodeURIComponent(type)}&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`);if(activeType()!==type)return;if(type.startsWith('SHOPEE'))renderShopee(root,data,type);else renderGeneric(root,data,type);lastKey=key;}catch(e){console.warn('[CE-QC][V261_FINAL_OWNER]',type,e?.message||e);}finally{busy=false;}
  }
  function schedule(ms=80){clearTimeout(timer);timer=setTimeout(()=>void refresh(),ms);}
  function bind(){ensureStyle();document.addEventListener('click',e=>{if(e.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query,#dashboardRangeQuery'))schedule(80);},true);document.addEventListener('change',e=>{if(e.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(100);},true);global.addEventListener('popstate',()=>schedule(80));const ob=new MutationObserver(records=>{if(busy)return;const relevant=records.some(r=>[...r.addedNodes].some(node=>node?.nodeType===1&&(node.matches?.('.v18-trend-section,#v247HomeShopeeAttempts,#v245ShopeeAttemptTruth')||node.querySelector?.('.v18-trend-section,#v247HomeShopeeAttempts,#v245ShopeeAttemptTruth'))));if(relevant)schedule(120);});if(document.body)ob.observe(document.body,{childList:true,subtree:true});[60,350,1200,3500].forEach(ms=>setTimeout(()=>void refresh(),ms));}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V261_DASHBOARD_FINAL_OWNER__={version:VERSION,refresh,activePage,activeType,lastKey:()=>lastKey};
  console.info('[CE-QC][V261_FINAL_OWNER]',VERSION,'visible-page business detection + single final trend owner + full-width Shopee attempt evidence enabled');
})(window);
