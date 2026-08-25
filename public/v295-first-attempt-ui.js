(function installV295FirstAttemptUi(global){
  if(global.__CE_QC_V295_FIRST_ATTEMPT_UI__)return;
  const VERSION='2026-08-25-v297-exact-visible-truth-nav-dedupe-v1';
  const DASHBOARD_CSS='/dashboard-v18.css?v=20260825-v296-1';
  const FIRST_ATTEMPT_API='/api/v295/first-attempt-trends';
  const CANONICAL_NAV_LABELS=['首页总看板','CE看板','CEAF空运看板','TBKH看板','ALI1688看板','WHPP本土看板','SHOPEE CN看板','SHOPEE VN看板','数据导入','轨迹查询','异常明细','报表导出','数据管理','系统设置','操作日志'];
  let busy=false,timer=null,lastKey='',lastPayload=null,applying=false,applyReleaseTimer=null,navFixing=false;
  const date=v=>String(v||'').slice(0,10);
  const num=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
  const fmt=v=>num(v)===null?'—':Number(v).toLocaleString('zh-CN');
  const pct=v=>num(v)===null?'—':`${Number(v).toFixed(2)}%`;
  function ensureVisibleAssets(){
    let css=[...document.querySelectorAll('link[rel="stylesheet"]')].find(node=>/\/dashboard-v18\.css(?:\?|$)/i.test(String(node.getAttribute('href')||'')));
    if(!css){css=document.createElement('link');css.rel='stylesheet';document.head.appendChild(css);}
    if(String(css.getAttribute('href')||'')!==DASHBOARD_CSS)css.setAttribute('href',DASHBOARD_CSS);
    css.dataset.v296DashboardCss='1';
    const logo=document.querySelector('[data-testid="ce-express-logo"],.sidebar-brand img');
    if(logo&&logo.dataset.v296Logo!=='ready'){
      logo.dataset.v296Logo='ready';
      const sources=['/assets/ce-express-logo-main.png?v=20260825-v296-1','/assets/ce-express-logo.png?v=20260825-v296-1','/assets/ce-express-logo.svg?v=20260825-v296-1'];
      let index=0;
      const advance=()=>{index+=1;if(index<sources.length)logo.src=sources[index];else console.warn('[CE-QC][V296_VISIBLE_STYLE_RESCUE] CE logo fallback chain exhausted');};
      logo.addEventListener('error',advance);
      logo.src=sources[0];
      setTimeout(()=>{if(logo.complete&&logo.naturalWidth===0)advance();},500);
    }
    document.documentElement.dataset.v296VisibleStyle='1';
  }
  function canonicalizeNav(){
    if(navFixing)return;
    const nav=document.querySelector('.side-nav');if(!nav)return;
    navFixing=true;
    try{
      const allowed=new Set(CANONICAL_NAV_LABELS),seen=new Set(),kept=[];
      for(const node of [...nav.children]){
        const label=String(node.querySelector?.('.side-label')?.textContent||node.textContent||'').trim();
        if(!allowed.has(label)||seen.has(label)){node.remove();continue;}
        seen.add(label);kept.push([label,node]);
      }
      const byLabel=new Map(kept);
      const ordered=CANONICAL_NAV_LABELS.map(label=>byLabel.get(label)).filter(Boolean);
      const current=[...nav.children];
      if(ordered.some((node,index)=>current[index]!==node))ordered.forEach(node=>nav.appendChild(node));
      nav.dataset.v297Canonical='1';
    }finally{setTimeout(()=>{navFixing=false;},0);}
  }
  function range(){const to=date(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'');const from=date(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to);return{from,to};}
  function activeRoot(){return[...document.querySelectorAll('.app-page')].find(node=>!node.hidden&&getComputedStyle(node).display!=='none')||null;}
  function activeType(){const home=document.getElementById('homePage');if(home&&!home.hidden&&getComputedStyle(home).display!=='none')return'HOME';const title=String(document.getElementById('pageTitle')?.textContent||document.querySelector('.v18-page-heading h2')?.textContent||'').toUpperCase();if(title.includes('SHOPEE CN'))return'SHOPEECN';if(title.includes('SHOPEE VN'))return'SHOPEEVN';if(title.includes('TBKH'))return'TBKH';if(title.includes('ALI1688'))return'ALI1688';if(title.includes('CEAF'))return'CEAF';if(title.includes('WHPP'))return'WHPP';if(title.includes('CCSL'))return'CCSL';if(title.includes('SHOPEE'))return'SHOPEE';if(/(^|\s)CE(\s|看板|$)/.test(title))return'CE';const p=String(location.pathname||'').replace(/^\/+|\/+$/g,'').toLowerCase();return({ce:'CE',ceaf:'CEAF',tbkh:'TBKH',ali1688:'ALI1688',whpp:'WHPP',shopeecn:'SHOPEECN',shopeevn:'SHOPEEVN',ccsl:'CCSL',shopee:'SHOPEE'})[p]||'';}
  async function json(url){const r=await fetch(url,{cache:'no-store',credentials:'same-origin'});const raw=await r.text();let data={};try{data=raw?JSON.parse(raw):{};}catch{}if(!r.ok||data?.ok===false)throw new Error(data?.error||`HTTP ${r.status}`);return data;}
  function patchCards(s){
    const root=activeRoot();if(!root)return;
    root.querySelectorAll('.v18-metric-card').forEach(card=>{
      if(String(card.querySelector('span')?.textContent||'').trim()!=='首次妥投率')return;
      const b=card.querySelector('b'),small=card.querySelector('small'),r=num(s?.firstAttemptRate),e=num(s?.firstAttemptEligible),ok=num(s?.firstAttemptSuccess);
      const value=r===null?'—':`${r.toFixed(2)}%`,note=r===null?'真实首派证据不足，不显示0%':`首派成功 ${fmt(ok)} / 首派尝试 ${fmt(e)}`;
      if(b&&b.textContent!==value)b.textContent=value;if(small&&small.textContent!==note)small.textContent=note;card.dataset.v295FirstAttempt='1';
    });
  }
  function renderTrend(data,type,rg){
    const root=activeRoot(),section=root?.querySelector('.v18-trend-section'),renderer=global.RateTrendCardV18?.render;if(!section||typeof renderer!=='function')return;
    const dates=data?.dates||[],values=data?.firstAttemptRate||[],success=data?.firstAttemptSuccess||[],eligible=data?.firstAttemptEligible||[];let card;
    if(['TBKH','SHOPEECN','SHOPEEVN'].includes(type)){
      let grid=section.querySelector('.v18-chart-grid,.v272-trend-grid');if(!grid){grid=document.createElement('div');grid.className='v18-chart-grid';section.appendChild(grid);}
      card=grid.querySelector('[data-v295-first-attempt-trend]');if(!card){card=document.createElement('article');card.className='v18-chart-card';card.dataset.v295FirstAttemptTrend='1';grid.appendChild(card);}
    }else{
      const cards=[...section.querySelectorAll('.v18-chart-card')];card=cards[3]||cards.at(-1);if(card)card.dataset.v295FirstAttemptTrend='1';
    }
    if(!card)return;
    const signature=JSON.stringify([type,rg?.from||'',rg?.to||'',dates,values,success,eligible]);
    if(card.dataset.v297FirstAttemptSignature===signature&&/首次妥投率趋势/.test(String(card.textContent||'')))return;
    renderer(card,{title:'首次妥投率趋势',type:'rate',dates,evidenceIncomplete:(data?.firstAttemptEvidenceComplete||[]).some(v=>v===false),series:[{name:'首次妥投率',color:'#6d4aff',values,numerators:success,denominators:eligible}]});
    card.dataset.v297FirstAttemptSignature=signature;
  }
  function patchPanel(s){
    const host=document.querySelector('#v272AttemptPanel .v272-attempt-summary,#v271AttemptPanel .v271-attempt-summary');if(!host)return;
    let e=host.querySelector('[data-v295-first-eligible]');if(!e){e=document.createElement('div');e.dataset.v295FirstEligible='1';host.appendChild(e);}let r=host.querySelector('[data-v295-first-rate]');if(!r){r=document.createElement('div');r.dataset.v295FirstRate='1';host.appendChild(r);}
    const eHtml=`<span>首派尝试票数</span><b>${fmt(s?.firstAttemptEligible)}</b>`,rHtml=`<span>首次妥投率</span><b>${pct(s?.firstAttemptRate)}</b>`;if(e.innerHTML!==eHtml)e.innerHTML=eHtml;if(r.innerHTML!==rHtml)r.innerHTML=rHtml;
  }
  function applyPayload(payload=lastPayload){
    if(!payload)return;
    applying=true;clearTimeout(applyReleaseTimer);
    try{ensureVisibleAssets();canonicalizeNav();patchCards(payload.summary);renderTrend(payload.trend,payload.type,payload.range);patchPanel(payload.summary);}finally{applyReleaseTimer=setTimeout(()=>{applying=false;},120);}
  }
  async function refresh(force=false){
    ensureVisibleAssets();canonicalizeNav();const type=activeType(),rg=range();if(!type||!rg.from||!rg.to)return;const key=`${type}|${rg.from}|${rg.to}`;
    if(!force&&lastKey===key&&lastPayload){applyPayload(lastPayload);return;}if(busy)return;busy=true;
    try{
      const trend=await json(`${FIRST_ATTEMPT_API}?businessType=${encodeURIComponent(type)}&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`);
      const summary=trend?.firstAttemptSummary||null;lastPayload={type,range:rg,trend,summary};lastKey=key;applyPayload(lastPayload);setTimeout(()=>applyPayload(lastPayload),320);setTimeout(()=>applyPayload(lastPayload),1100);
    }catch(error){console.warn('[CE-QC][V297_FIRST_ATTEMPT_UI]',error?.message||error);lastPayload={type,range:rg,trend:{dates:[],firstAttemptRate:[],firstAttemptSuccess:[],firstAttemptEligible:[],firstAttemptEvidenceComplete:[]},summary:null};lastKey=key;applyPayload(lastPayload);}finally{busy=false;}
  }
  function schedule(ms=100,force=true){clearTimeout(timer);timer=setTimeout(()=>refresh(force),ms);}
  function mutationRelevant(r){if(r.type==='characterData')return Boolean(r.target?.parentElement?.closest?.('.v18-metric-card,.v18-trend-section,#v271AttemptPanel,#v272AttemptPanel'));return[...r.addedNodes].some(n=>n?.nodeType===1&&(n.matches?.('.v18-metric-card,.v18-trend-section,#v271AttemptPanel,#v272AttemptPanel')||n.querySelector?.('.v18-metric-card,.v18-trend-section,#v271AttemptPanel,#v272AttemptPanel')));}
  function bind(){
    ensureVisibleAssets();canonicalizeNav();
    document.addEventListener('click',e=>{if(e.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query,#dashboardRangeQuery')){schedule(120,true);setTimeout(()=>refresh(true),650);setTimeout(()=>refresh(true),1500);}},true);
    document.addEventListener('change',e=>{if(e.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo')){schedule(140,true);setTimeout(()=>refresh(true),800);}},true);
    global.addEventListener('popstate',()=>schedule(120,true));
    const o=new MutationObserver(records=>{
      if(records.some(r=>r.target?.closest?.('.side-nav')||[...r.addedNodes].some(n=>n?.nodeType===1&&n.closest?.('.side-nav'))))canonicalizeNav();
      if(applying||busy)return;if(records.some(mutationRelevant)){if(lastPayload&&lastKey===`${activeType()}|${range().from}|${range().to}`)setTimeout(()=>applyPayload(lastPayload),70);else schedule(120,false);}
    });
    if(document.body)o.observe(document.body,{subtree:true,childList:true,characterData:true});
    [80,500,1400,2800].forEach(ms=>setTimeout(()=>refresh(true),ms));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V295_FIRST_ATTEMPT_UI__={version:VERSION,refresh,ensureVisibleAssets,canonicalizeNav};
  console.info('[CE-QC][V297_FIRST_ATTEMPT_UI]',VERSION,'首次妥投率使用精确所选日期与HOME/业务自身范围；旧渲染覆盖会再次纠正；侧栏仅保留一套规范菜单。');
})(window);
