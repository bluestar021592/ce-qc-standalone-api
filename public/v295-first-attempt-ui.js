(function installV295FirstAttemptUi(global){
  if(global.__CE_QC_V295_FIRST_ATTEMPT_UI__)return;
  const VERSION='2026-08-25-v298-exact-visible-truth-nav-authority-v1';
  const DASHBOARD_CSS='/dashboard-v18.css?v=20260825-v296-1';
  const FIRST_ATTEMPT_API='/api/v295/first-attempt-trends';
  const NAV_ITEMS=[
    ['home','首页总看板','home','/'],['ce','CE看板','package','/ce'],['ceaf','CEAF空运看板','package','/ceaf'],['tbkh','TBKH看板','package','/tbkh'],['ali1688','ALI1688看板','package','/ali1688'],['whpp','WHPP本土看板','package','/whpp'],
    ['shopeecn','SHOPEE CN看板','bag','/shopeecn'],['shopeevn','SHOPEE VN看板','bag','/shopeevn'],['import','数据导入','database','/import'],['tracking','轨迹查询','route','/tracking'],['exceptions','异常明细','alert','/exceptions'],['reports','报表导出','clipboard','/reports'],['data-management','数据管理','database','/data-management'],['settings','系统设置','settings','/settings'],['logs','操作日志','clipboard','/logs']
  ];
  const cache=new Map(),inflight=new Map();
  let timer=null,lastKey='',lastPayload=null,applying=false,applyReleaseTimer=null,navFixing=false,navPending=false;
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
  function currentPage(){
    const path=String(location.pathname||'/').toLowerCase().replace(/\/+$/,'')||'/';
    const byPath={'/':'home','/home':'home','/ce':'ce','/ceaf':'ceaf','/tbkh':'tbkh','/ali1688':'ali1688','/whpp':'whpp','/shopeecn':'shopeecn','/shopeevn':'shopeevn','/import':'import','/tracking':'tracking','/exceptions':'exceptions','/reports':'reports','/data-management':'data-management','/settings':'settings','/logs':'logs'};
    return byPath[path]||String(document.querySelector('.side-nav .side-link.active')?.dataset?.page||'home');
  }
  function navSignature(nav){return [...nav.children].map(node=>`${String(node.dataset?.page||'')}|${String(node.querySelector?.('.side-label')?.textContent||node.textContent||'').trim()}`).join('>');}
  function canonicalizeNav(){
    if(navFixing){navPending=true;return;}
    const nav=document.querySelector('.side-nav');if(!nav)return;
    navFixing=true;
    try{
      const existingAdmin=[...nav.querySelectorAll('[data-page="data-management"]')].some(node=>!node.hidden);
      const headerAdmin=/ADMIN/i.test(String(document.getElementById('headerUserRole')?.textContent||''));
      const adminVisible=existingAdmin||headerAdmin;
      const active=currentPage();
      const wanted=NAV_ITEMS.map(([page,label])=>`${page}|${label}`).join('>');
      if(navSignature(nav)===wanted){
        nav.querySelectorAll('.side-link').forEach(node=>node.classList.toggle('active',String(node.dataset.page||'')===active));
        const dataNode=nav.querySelector('[data-page="data-management"]');if(dataNode)dataNode.hidden=!adminVisible;
        nav.dataset.v298Canonical='1';return;
      }
      nav.innerHTML=NAV_ITEMS.map(([page,label,icon,path])=>`<button class="side-link ${page===active?'active':''} ${page==='data-management'?'admin-only':''}" data-page="${page}" data-path="${path}" onclick="navigatePage('${page}')" ${page==='data-management'&&!adminVisible?'hidden':''}><svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-${icon}"></use></svg><span class="side-label">${label}</span></button>`).join('');
      nav.dataset.v298Canonical='1';
    }finally{
      navFixing=false;
      if(navPending){navPending=false;queueMicrotask(canonicalizeNav);}
    }
  }
  function range(){const to=date(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'');const from=date(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to);return{from,to};}
  function activeRoot(){return[...document.querySelectorAll('.app-page')].find(node=>!node.hidden&&getComputedStyle(node).display!=='none')||null;}
  function activeType(){
    const home=document.getElementById('homePage');if(home&&!home.hidden&&getComputedStyle(home).display!=='none')return'HOME';
    const title=String(document.getElementById('pageTitle')?.textContent||document.querySelector('.v18-page-heading h2')?.textContent||'').toUpperCase();
    if(title.includes('SHOPEE CN'))return'SHOPEECN';if(title.includes('SHOPEE VN'))return'SHOPEEVN';if(title.includes('TBKH'))return'TBKH';if(title.includes('ALI1688'))return'ALI1688';if(title.includes('CEAF'))return'CEAF';if(title.includes('WHPP'))return'WHPP';if(title.includes('CCSL'))return'CCSL';if(title.includes('SHOPEE'))return'SHOPEE';if(/(^|\s)CE(\s|看板|$)/.test(title))return'CE';
    const p=String(location.pathname||'').replace(/^\/+|\/+$/g,'').toLowerCase();return({ce:'CE',ceaf:'CEAF',tbkh:'TBKH',ali1688:'ALI1688',whpp:'WHPP',shopeecn:'SHOPEECN',shopeevn:'SHOPEEVN',ccsl:'CCSL',shopee:'SHOPEE'})[p]||'';
  }
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
      let grid=section.querySelector('.v18-chart-grid,.v272-trend-grid');if(!grid){grid=document.createElement('div');grid.className='v18-chart-grid';section.appendChild(grid);}card=grid.querySelector('[data-v295-first-attempt-trend]');if(!card){card=document.createElement('article');card.className='v18-chart-card';card.dataset.v295FirstAttemptTrend='1';grid.appendChild(card);}
    }else{const cards=[...section.querySelectorAll('.v18-chart-card')];card=cards[3]||cards.at(-1);if(card)card.dataset.v295FirstAttemptTrend='1';}
    if(!card)return;
    const signature=JSON.stringify([type,rg?.from||'',rg?.to||'',dates,values,success,eligible]);
    if(card.dataset.v298FirstAttemptSignature===signature&&/首次妥投率趋势/.test(String(card.textContent||'')))return;
    renderer(card,{title:'首次妥投率趋势',type:'rate',dates,evidenceIncomplete:(data?.firstAttemptEvidenceComplete||[]).some(v=>v===false),series:[{name:'首次妥投率',color:'#6d4aff',values,numerators:success,denominators:eligible}]});
    card.dataset.v298FirstAttemptSignature=signature;
  }
  function patchPanel(s){
    const host=document.querySelector('#v272AttemptPanel .v272-attempt-summary,#v271AttemptPanel .v271-attempt-summary');if(!host)return;
    let e=host.querySelector('[data-v295-first-eligible]');if(!e){e=document.createElement('div');e.dataset.v295FirstEligible='1';host.appendChild(e);}let r=host.querySelector('[data-v295-first-rate]');if(!r){r=document.createElement('div');r.dataset.v295FirstRate='1';host.appendChild(r);}
    const eHtml=`<span>首派尝试票数</span><b>${fmt(s?.firstAttemptEligible)}</b>`,rHtml=`<span>首次妥投率</span><b>${pct(s?.firstAttemptRate)}</b>`;if(e.innerHTML!==eHtml)e.innerHTML=eHtml;if(r.innerHTML!==rHtml)r.innerHTML=rHtml;
  }
  function applyPayload(payload=lastPayload){
    if(!payload)return;applying=true;clearTimeout(applyReleaseTimer);
    try{ensureVisibleAssets();canonicalizeNav();patchCards(payload.summary);renderTrend(payload.trend,payload.type,payload.range);patchPanel(payload.summary);}finally{applyReleaseTimer=setTimeout(()=>{applying=false;},100);}
  }
  async function loadExact(type,rg,force=false){
    const key=`${type}|${rg.from}|${rg.to}`,hit=cache.get(key);
    if(!force&&hit&&Date.now()-hit.at<5000)return hit.payload;
    if(inflight.has(key))return inflight.get(key);
    const promise=json(`${FIRST_ATTEMPT_API}?businessType=${encodeURIComponent(type)}&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`).then(trend=>{const payload={type,range:rg,trend,summary:trend?.firstAttemptSummary||null};cache.set(key,{at:Date.now(),payload});return payload;}).finally(()=>inflight.delete(key));
    inflight.set(key,promise);return promise;
  }
  async function refresh(force=false){
    ensureVisibleAssets();canonicalizeNav();const type=activeType(),rg=range();if(!type||!rg.from||!rg.to)return;const key=`${type}|${rg.from}|${rg.to}`;
    if(!force&&lastKey===key&&lastPayload){applyPayload(lastPayload);return;}
    try{const payload=await loadExact(type,rg,force);lastPayload=payload;lastKey=key;applyPayload(payload);setTimeout(()=>applyPayload(payload),350);setTimeout(()=>applyPayload(payload),1200);}
    catch(error){console.warn('[CE-QC][V298_FIRST_ATTEMPT_UI]',error?.message||error);if(lastKey!==key){lastPayload={type,range:rg,trend:{dates:[],firstAttemptRate:[],firstAttemptSuccess:[],firstAttemptEligible:[],firstAttemptEvidenceComplete:[]},summary:null};lastKey=key;}applyPayload(lastPayload);}
  }
  function schedule(ms=1600,force=true){clearTimeout(timer);timer=setTimeout(()=>refresh(force),ms);}
  function mutationRelevant(r){if(r.type==='characterData')return Boolean(r.target?.parentElement?.closest?.('.v18-metric-card,.v18-trend-section,#v271AttemptPanel,#v272AttemptPanel'));return[...r.addedNodes].some(n=>n?.nodeType===1&&(n.matches?.('.v18-metric-card,.v18-trend-section,#v271AttemptPanel,#v272AttemptPanel')||n.querySelector?.('.v18-metric-card,.v18-trend-section,#v271AttemptPanel,#v272AttemptPanel')));}
  function bind(){
    ensureVisibleAssets();canonicalizeNav();
    document.addEventListener('click',e=>{if(e.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query,#dashboardRangeQuery')){setTimeout(canonicalizeNav,40);schedule(1700,true);}},true);
    document.addEventListener('change',e=>{if(e.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(1700,true);},true);
    global.addEventListener('popstate',()=>schedule(1700,true));
    const o=new MutationObserver(records=>{
      if(records.some(r=>r.target?.closest?.('.side-nav')||[...r.addedNodes].some(n=>n?.nodeType===1&&n.closest?.('.side-nav'))))canonicalizeNav();
      if(records.some(r=>r.type==='characterData'&&r.target?.parentElement?.closest?.('#headerUserRole')))canonicalizeNav();
      if(applying)return;
      if(records.some(mutationRelevant)&&lastPayload&&lastKey===`${activeType()}|${range().from}|${range().to}`)setTimeout(()=>applyPayload(lastPayload),80);
    });
    if(document.body)o.observe(document.body,{subtree:true,childList:true,characterData:true});
    setTimeout(canonicalizeNav,120);setTimeout(canonicalizeNav,700);setTimeout(()=>refresh(true),2200);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V295_FIRST_ATTEMPT_UI__={version:VERSION,refresh,ensureVisibleAssets,canonicalizeNav};
  console.info('[CE-QC][V298_FIRST_ATTEMPT_UI]',VERSION,'精确首派真值延后到主趋势请求之后读取；同范围请求单飞并短缓存；侧栏由一套规范菜单强制接管，遗留重复入口不会保留。');
})(window);
