(function installRuntimeFixV51(global){
  const VERSION='2026-08-12-v51-runtime-fix-v3';
  const nativeFetch=global.fetch.bind(global);
  const SPECIAL_TAB_BY_LABEL={
    'CCSLCN分流':'ccslCnDiversion','CECN滞留包裹':'ccslCnDiversion',
    'CCSLZT分流':'ccslZtDiversion','CEZT滞留包裹':'ccslZtDiversion',
    '580滞留包裹':'ccsl580Retention','CCSL580分流':'ccsl580Retention','CCSL580滞留包裹':'ccsl580Retention',
    '金边门店':'phnomPenhShop','外省门店':'provinceShop'
  };
  const CARRY_PATHS=new Set([
    '/api/v27/carry-monitor','/api/v27/carry-monitor-business','/api/v29/carry-monitor',
    '/api/v30/carry-monitor','/api/v32/carry-monitor'
  ]);
  const EXTRA_BUSINESS=[
    {type:'CEAF',label:'CEAF空运',page:'ceaf'},
    {type:'WHPP',label:'WHPP本土',page:'whpp'}
  ];
  let carrySelected='ALL';
  let carryStatus='OPEN';
  let carrySummary={};
  let homeWhppTotal=null;
  let homeWhppDate='';
  let homeRequest=null;
  let decorateTimer=null;

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const parseNumber=text=>Number(String(text||'').replace(/[^0-9.-]/g,''))||0;

  function currentBusinessType(){
    return ({
      '/ce':'CE','/ceaf':'CEAF','/tbkh':'TBKH','/ali1688':'ALI1688',
      '/shopeecn':'SHOPEECN','/shopeevn':'SHOPEEVN','/whpp':'WHPP'
    })[location.pathname.toLowerCase()]||'';
  }
  function selectedDate(){
    return document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||document.getElementById('topHistoryDate')?.value||'';
  }
  function buildUrl(input){
    if(typeof input==='string')return new URL(input,location.origin);
    if(input instanceof URL)return new URL(input.href);
    if(input instanceof Request)return new URL(input.url);
    return null;
  }
  function sameOrigin(url){return url&&url.origin===location.origin;}
  function rewriteSpecialDetail(url){
    const tab=String(url.searchParams.get('tab')||'');
    const specials=new Set(['ccslCnDiversion','ccslZtDiversion','ccsl580Retention','ccsl580Diversion','phnomPenhShop','provinceShop']);
    if(!specials.has(tab))return false;
    let type=String(url.searchParams.get('businessType')||currentBusinessType()||'').toUpperCase();
    if(type==='CCSL'||type==='SHOPEE')type=currentBusinessType()||type;
    const to=url.searchParams.get('to')||url.searchParams.get('reportDate')||selectedDate();
    const from=url.searchParams.get('from')||to;
    url.pathname='/api/v50/special-detail';
    url.searchParams.set('businessType',type);
    if(from)url.searchParams.set('from',from);
    if(to)url.searchParams.set('to',to);
    return true;
  }

  global.fetch=async function v51Fetch(input,init){
    const url=buildUrl(input);
    if(!sameOrigin(url))return nativeFetch(input,init);

    if(url.pathname==='/api/whpp/state')url.pathname='/api/v71/whpp-summary';
    else if(url.pathname==='/api/whpp/metric-detail')url.pathname='/api/v50/whpp-metric-detail';
    else if(CARRY_PATHS.has(url.pathname)){
      carryStatus=String(url.searchParams.get('status')||carryStatus||'OPEN').toUpperCase();
      const requested=String(url.searchParams.get('businessType')||'ALL').toUpperCase();
      if(carrySelected==='ALL'&&requested!=='ALL')carrySelected=requested;
      url.pathname='/api/v51/carry-monitor';
      url.searchParams.set('status',carryStatus);
      url.searchParams.set('businessType',carrySelected||requested||'ALL');
    }else if(url.pathname==='/api/v61/metric-detail'){
      // Canonical detail route stays untouched.
    }else if(/\/metric-detail$/.test(url.pathname)){
      rewriteSpecialDetail(url);
    }

    const target=url.pathname+url.search+url.hash;
    const response=await nativeFetch(target,init);
    if(url.pathname==='/api/v51/carry-monitor'){
      response.clone().json().then(data=>{
        if(data?.ok){carrySummary=data.businessSummary||carrySummary;scheduleDecorate();}
      }).catch(()=>{});
    }
    return response;
  };

  function specialPanel(type){
    return String(type).startsWith('SHOPEE')?document.getElementById('shopeePreviewPanel'):document.getElementById('ccslPreviewPanel');
  }
  function cardLabel(card){return String(card?.querySelector('span')?.textContent||'').trim();}
  function detailRange(){
    const to=selectedDate();
    const from=document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to;
    return{from:from||to,to};
  }
  async function openSpecialDetail(type,tab,label){
    const host=specialPanel(type),range=detailRange();if(!host||!range.to)return;
    host.classList.add('v27-detail-panel');
    host.innerHTML=`<div class="v27-loading"><b>正在读取 ${esc(label)} 明细…</b><br>只读取最终有效位置，不返回业务全量。</div>`;
    host.scrollIntoView({behavior:'smooth',block:'start'});
    try{
      const params=new URLSearchParams({businessType:type,from:range.from,to:range.to,tab,page:'1',pageSize:'200'});
      const response=await nativeFetch(`/api/v50/special-detail?${params}`,{cache:'no-store',credentials:'same-origin'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data.ok===false)throw new Error(data.error||`HTTP ${response.status}`);
      const rows=data.rows||[];
      const cols=['shipmentCode','businessType','reportDate','regionCode','当前分类','POD状态','Pending次数','OC天数','最新节点','最新时间'].filter(key=>rows.some(row=>row?.[key]!==undefined));
      const names={shipmentCode:'运单号',businessType:'业务',reportDate:'日报日期',regionCode:'区域',当前分类:'当前分类',POD状态:'POD状态',Pending次数:'Pending天数',OC天数:'OC天数',最新节点:'最新节点',最新时间:'最新时间'};
      host.innerHTML=`<div class="v27-detail-head"><div><h3>${esc(label)}</h3><div class="v27-detail-meta">${esc(data.fromDate)} ～ ${esc(data.toDate)} · 共 ${fmt(data.total)} 票</div></div></div><div class="v27-detail-scroll">${rows.length?`<table class="v27-detail-table"><thead><tr>${cols.map(key=>`<th>${esc(names[key]||key)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${cols.map(key=>`<td>${esc(row?.[key]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<div class="empty-state">该指标当前没有匹配的逐票数据</div>'}</div>`;
    }catch(error){host.innerHTML=`<div class="empty-state">明细读取失败：${esc(error.message||error)}</div>`;}
  }

  document.addEventListener('click',event=>{
    const card=event.target?.closest?.('.v18-metric-card,.v18-business-card');
    if(!card)return;
    const label=cardLabel(card),tab=SPECIAL_TAB_BY_LABEL[label],type=currentBusinessType();
    if(!tab||!type||type==='WHPP'||global.__CE_QC_V61_DRILLDOWN_ROUTE_BRIDGE__)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    void openSpecialDetail(type,tab,label);
  },true);

  function homeVisible(){const node=document.getElementById('homePage');return Boolean((node&&!node.hidden&&node.classList.contains('active'))||location.pathname==='/'||location.pathname==='/home');}
  function businessCardValue(card){return parseNumber(card.querySelector('b')?.textContent);}
  function patchHomeWhppCard(){
    if(homeWhppTotal===null||!homeVisible())return;
    const grid=document.querySelector('#homePage .v18-business-grid');if(!grid)return;
    let cards=[...grid.querySelectorAll('.v18-business-card')];if(!cards.length)return;
    let whpp=cards.find(card=>cardLabel(card)==='WHPP本土');
    if(!whpp){
      whpp=document.createElement('button');
      whpp.className='v18-business-card cyan v51-whpp-home-card';
      whpp.onclick=()=>global.navigatePage?.('whpp');
      whpp.innerHTML=`<span>WHPP本土</span><small>今日票数</small><b>${fmt(homeWhppTotal)}</b><em>占总票数 0.00%</em>`;
      grid.appendChild(whpp);
      cards=[...grid.querySelectorAll('.v18-business-card')];
    }else{
      const value=whpp.querySelector('b');if(value&&value.textContent!==fmt(homeWhppTotal))value.textContent=fmt(homeWhppTotal);
    }
    const totalCard=cards.find(card=>cardLabel(card)==='总览')||cards[0];
    const nonTotal=cards.filter(card=>card!==totalCard&&card!==whpp);
    const existingSum=nonTotal.reduce((sum,card)=>sum+businessCardValue(card),0);
    let grand=businessCardValue(totalCard);
    const expected=existingSum+Number(homeWhppTotal||0);
    if(grand<=0||Math.abs(grand-existingSum)<0.5||grand<expected)grand=expected;
    const totalValue=totalCard?.querySelector('b');if(totalValue&&totalValue.textContent!==fmt(grand))totalValue.textContent=fmt(grand);
    const totalRatio=totalCard?.querySelector('em');if(totalRatio&&totalRatio.textContent!=='占总票数 100.00%')totalRatio.textContent='占总票数 100.00%';
    cards.filter(card=>card!==totalCard).forEach(card=>{
      const ratio=card.querySelector('em');const text=`占总票数 ${grand?(businessCardValue(card)*100/grand).toFixed(2):'0.00'}%`;if(ratio&&ratio.textContent!==text)ratio.textContent=text;
    });
  }
  async function refreshHomeWhpp(force=false){
    if(!homeVisible())return;
    const date=selectedDate();
    if(homeRequest)return homeRequest;
    if(!force&&homeWhppDate===date&&homeWhppTotal!==null){patchHomeWhppCard();return;}
    homeRequest=(async()=>{
      try{
        const q=date?`?reportDate=${encodeURIComponent(date)}`:'';
        const response=await nativeFetch(`/api/v71/whpp-summary${q}`,{cache:'no-store',credentials:'same-origin'});
        const data=await response.json().catch(()=>({}));
        if(response.ok&&data?.ok!==false){homeWhppTotal=Number(data?.dashboard?.metrics?.total??data?.total??0);homeWhppDate=date||data?.state?.reportDate||data?.reportDate||'';patchHomeWhppCard();}
      }catch(error){console.warn('[V51][HOME_WHPP]',error);}
      finally{homeRequest=null;}
    })();
    return homeRequest;
  }

  function businessFromCard(card){
    const label=cardLabel(card);
    if(label==='全部业务')return'ALL';
    if(label==='CE')return'CE';
    if(label==='CEAF空运'||label==='CEAF')return'CEAF';
    if(label==='TBKH')return'TBKH';
    if(label==='ALI1688')return'ALI1688';
    if(label==='WHPP本土'||label==='WHPP')return'WHPP';
    if(label==='SHOPEE CN')return'SHOPEECN';
    if(label==='SHOPEE VN')return'SHOPEEVN';
    return'';
  }
  function patchCarryBusinessCards(){
    const grid=document.querySelector('.v27-carry-business-grid');if(!grid)return;
    [...grid.querySelectorAll('.v27-carry-business-card')].forEach(card=>{
      const type=businessFromCard(card);if(type)card.dataset.v51Business=type;
      if(card.classList.contains('active')!==(type===carrySelected))card.classList.toggle('active',type===carrySelected);
      const count=card.querySelector('b');const text=fmt(carrySummary[type]||0);if(count&&type&&carrySummary[type]!==undefined&&count.textContent!==text)count.textContent=text;
    });
    for(const item of EXTRA_BUSINESS){
      let card=grid.querySelector(`[data-v51-business="${item.type}"]`);
      if(card)continue;
      card=document.createElement('button');
      card.className=`v27-carry-business-card ${carrySelected===item.type?'active':''}`;
      card.dataset.v51Business=item.type;
      card.innerHTML=`<strong>${esc(item.label)}</strong><b>${fmt(carrySummary[item.type]||0)}</b><small>进入${esc(item.label)}看板 →</small>`;
      card.addEventListener('click',event=>{
        if(event.target.closest('small')){event.stopPropagation();global.navigatePage?.(item.page);return;}
        global.v51CarryChooseBusiness(item.type);
      });
      grid.appendChild(card);
    }
  }
  global.v51CarryChooseBusiness=function(type){
    carrySelected=String(type||'ALL').toUpperCase();
    patchCarryBusinessCards();
    if(typeof global.v27SetCarryStatus==='function')global.v27SetCarryStatus(carryStatus||'OPEN');
  };
  document.addEventListener('click',event=>{
    const card=event.target?.closest?.('.v27-carry-business-card');if(card){const type=card.dataset.v51Business||businessFromCard(card);if(type)carrySelected=type;}
    if(event.target?.closest?.('[data-page="home"],#topRangeQuery'))setTimeout(()=>void refreshHomeWhpp(true),20);
    if(event.target?.closest?.('[data-page="carry"]'))setTimeout(()=>void refreshCarrySummary(),20);
  },true);

  async function refreshCarrySummary(){
    if(!document.querySelector('.v27-carry-business-grid'))return;
    try{
      const params=new URLSearchParams({status:carryStatus,businessType:'ALL',limit:'1'});
      const response=await nativeFetch(`/api/v51/carry-monitor?${params}`,{cache:'no-store',credentials:'same-origin'});
      const data=await response.json().catch(()=>({}));
      if(response.ok&&data?.ok){carrySummary=data.businessSummary||{};patchCarryBusinessCards();}
    }catch(error){console.warn('[V51][CARRY_SUMMARY]',error);}
  }

  function scheduleDecorate(){
    clearTimeout(decorateTimer);
    decorateTimer=setTimeout(()=>{patchHomeWhppCard();patchCarryBusinessCards();},30);
  }

  global.addEventListener('popstate',()=>setTimeout(()=>{void refreshHomeWhpp(true);void refreshCarrySummary();},40));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){void refreshHomeWhpp(false);}});
  document.addEventListener('ce-qc-run-complete',()=>{homeWhppDate='';void refreshHomeWhpp(true);void refreshCarrySummary();});
  setTimeout(()=>{void refreshHomeWhpp(false);void refreshCarrySummary();},40);
  console.info('[CE-QC][RUNTIME_V51]',VERSION);
})(window);