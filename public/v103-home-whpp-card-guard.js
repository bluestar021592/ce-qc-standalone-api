(function installHomeWhppCardGuardV103(global){
  if(global.__CE_QC_V103_HOME_WHPP__)return;
  const VERSION='2026-08-14-v103-home-whpp-card-guard-v2';
  const SIX=['CE','CEAF空运','TBKH','SHOPEE CN','SHOPEE VN','ALI1688'];
  let timer=null;

  const num=value=>{
    const n=Number(String(value??'').replace(/[,%\s]/g,''));
    return Number.isFinite(n)?n:0;
  };
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const rate=(value,total)=>total?Number(value||0)*100/Number(total):0;
  const setText=(node,text)=>{if(node&&node.textContent!==text)node.textContent=text;};

  function cardByLabel(grid,label){
    return [...(grid?.querySelectorAll?.('.v18-business-card')||[])]
      .find(card=>String(card.querySelector('span')?.textContent||'').trim()===label)||null;
  }

  function singleDaySelected(){
    const from=String(document.getElementById('topRangeFrom')?.value||'').slice(0,10);
    const to=String(document.getElementById('topRangeTo')?.value||'').slice(0,10);
    return Boolean(from&&to&&from===to);
  }

  function ensureWhpp(grid){
    let card=cardByLabel(grid,'WHPP本土');
    if(card)return card;
    card=document.createElement('button');
    card.type='button';
    card.className='v18-business-card cyan';
    card.dataset.v103Business='WHPP';
    card.onclick=()=>typeof global.navigateWhppPage==='function'
      ? global.navigateWhppPage()
      : (typeof global.navigatePage==='function'?global.navigatePage('whpp'):null);
    card.innerHTML='<span>WHPP本土</span><small>今日票数</small><b>0</b><em>占总票数 0.00%</em>';
    grid.appendChild(card);
    return card;
  }

  function patch(){
    const home=document.getElementById('homePage');
    if(!home||home.hidden||!singleDaySelected())return;
    const grid=home.querySelector('.v18-business-grid');
    if(!grid)return;
    const totalCard=cardByLabel(grid,'总览');
    if(!totalCard)return;

    const total=num(totalCard.querySelector('b')?.textContent);
    const sixTotal=SIX.reduce((sum,label)=>sum+num(cardByLabel(grid,label)?.querySelector('b')?.textContent),0);
    const residual=Math.max(0,total-sixTotal);
    const existing=cardByLabel(grid,'WHPP本土');
    if(residual<=0&&!existing)return;

    const whpp=ensureWhpp(grid);
    const existingValue=num(existing?.querySelector('b')?.textContent);
    const whppValue=residual>0?residual:existingValue;
    const finalTotal=sixTotal+whppValue;

    setText(totalCard.querySelector('b'),fmt(finalTotal));
    setText(whpp.querySelector('b'),fmt(whppValue));
    setText(whpp.querySelector('em'),`占总票数 ${rate(whppValue,finalTotal).toFixed(2)}%`);
    for(const label of SIX){
      const card=cardByLabel(grid,label);
      if(card)setText(card.querySelector('em'),`占总票数 ${rate(num(card.querySelector('b')?.textContent),finalTotal).toFixed(2)}%`);
    }
    setText(totalCard.querySelector('em'),'占总票数 100.00%');
  }

  function schedule(delay=0){
    clearTimeout(timer);
    timer=setTimeout(patch,Math.max(0,delay));
  }

  function install(){
    const originalRenderAll=global.renderAll;
    if(typeof originalRenderAll==='function'&&!originalRenderAll.__v103WhppGuardWrapped){
      const wrapped=function(){
        const result=originalRenderAll.apply(this,arguments);
        schedule(0);
        return result;
      };
      wrapped.__v103WhppGuardWrapped=true;
      global.renderAll=wrapped;
    }
    document.addEventListener('click',event=>{
      if(event.target?.closest?.('#topRangeQuery,[data-page="home"]'))schedule(20);
    },true);
    document.addEventListener('ce-qc-run-complete',()=>schedule(0));
    schedule(0);
    schedule(1000);
    global.__CE_QC_V103_HOME_WHPP__={version:VERSION,patch,schedule};
    console.info('[CE-QC][V103_HOME_WHPP]',VERSION);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})(window);

(function installV203DashboardStability(global){
  if(global.__CE_QC_V203_DASHBOARD_STABILITY__)return;
  const VERSION='2026-08-21-v203-dashboard-route-status-stability-v1';
  const PATH_PAGE={
    '/':'home','/home':'home','/ce':'ce','/ceaf':'ceaf','/tbkh':'tbkh','/ali1688':'ali1688',
    '/shopeecn':'shopeecn','/shopeevn':'shopeevn','/import':'import','/tracking':'tracking','/track':'tracking',
    '/exceptions':'exceptions','/reports':'reports','/data-management':'data-management','/settings':'settings','/logs':'logs'
  };
  let busy=false;
  let queued=false;

  function cleanPath(){return String(location.pathname||'/').replace(/\/+$/,'')||'/';}
  function intendedPage(){return PATH_PAGE[cleanPath()]||'';}
  function dateText(){
    const candidates=[document.getElementById('topRangeTo')?.value,document.getElementById('dashboardRangeTo')?.value];
    try{candidates.push(unifiedImportState?.reportDate);}catch{}
    for(const value of candidates){const text=String(value||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;}
    return '';
  }
  function validationText(value=''){
    return /已先显示本机最近验证数据|后台正在校验最新值|正在后台校验最新WHPP摘要|正在后台校验/.test(String(value||''));
  }
  function normalizeStatus(){
    const path=cleanPath();
    const date=dateText();
    document.querySelectorAll('.processing-notice,.global-processing-notice').forEach(node=>{
      if(validationText(node.textContent||''))node.remove();
    });
    const page=path==='/whpp'?document.getElementById('whppFastPage'):
      ['/ce','/ceaf','/tbkh','/ali1688'].includes(path)?document.getElementById('ccslPage'):
      ['/shopeecn','/shopeevn'].includes(path)?document.getElementById('shopeePage'):null;
    const heading=page?.querySelector('.v18-page-heading p');
    if(heading&&validationText(heading.textContent||'')){
      let completed=false;
      try{
        const type=path==='/ceaf'?'CEAF':path==='/ce'?'CE':path==='/tbkh'?'TBKH':path==='/ali1688'?'ALI1688':path==='/shopeecn'?'SHOPEECN':path==='/shopeevn'?'SHOPEEVN':'';
        const state=type?businessStates?.[type]:null;
        const status=String(state?.snapshotStatus||'').toUpperCase();
        completed=['COMPLETED','COMPLETED_WITH_RETRY'].includes(status)&&(!date||String(state?.reportDate||'').slice(0,10)===date);
      }catch{}
      heading.textContent=`日报 ${date||'—'}${completed?' · 数据来自当前业务有效快照':''}`;
    }
  }
  function restore(){
    queued=false;
    if(busy)return;
    const path=cleanPath();
    if(path==='/whpp'){normalizeStatus();return;}
    const intended=intendedPage();
    if(!intended)return;
    const whpp=document.getElementById('whppFastPage');
    let lexicalWhpp=false;
    try{lexicalWhpp=typeof currentPage!=='undefined'&&String(currentPage)==='whpp';}catch{}
    const visibleWhpp=Boolean(whpp&&(!whpp.hidden||whpp.classList.contains('active')));
    if(!visibleWhpp&&!lexicalWhpp){normalizeStatus();return;}
    busy=true;
    try{
      if(whpp){whpp.hidden=true;whpp.classList.remove('active');}
      try{if(typeof currentPage!=='undefined')currentPage=intended;}catch{}
      document.querySelectorAll('.side-link[data-page]').forEach(node=>node.classList.toggle('active',String(node.dataset.page||'')===intended));
      if(typeof global.renderPageVisibility==='function')global.renderPageVisibility();
      if(typeof global.renderTopbar==='function')global.renderTopbar();
      if(typeof global.renderAll==='function')global.renderAll();
      console.warn('[CE-QC][V203_ROUTE_GUARD] ignored late WHPP render on',path,'restored',intended);
    }catch(error){console.warn('[CE-QC][V203_ROUTE_GUARD] restore failed',error);}
    finally{busy=false;normalizeStatus();}
  }
  function scheduleGuard(){if(queued)return;queued=true;queueMicrotask(restore);}
  function install(){
    const observer=new MutationObserver(scheduleGuard);
    observer.observe(document.querySelector('.app-shell')||document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});
    global.addEventListener('popstate',scheduleGuard);
    document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page],#topRangeQuery'))setTimeout(scheduleGuard,0);},true);
    document.addEventListener('ce-qc-run-complete',()=>setTimeout(scheduleGuard,0));
    setInterval(()=>{if(cleanPath()!=='/whpp')restore();else normalizeStatus();},1000);
    scheduleGuard();
    global.__CE_QC_V203_DASHBOARD_STABILITY__={version:VERSION,restore,normalizeStatus};
    console.info('[CE-QC][V203_DASHBOARD_STABILITY]',VERSION);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
