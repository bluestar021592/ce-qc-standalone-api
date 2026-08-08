(function installV27TrendMountFix(global){
  if (new URLSearchParams(location.search).has('visualTest')) return;

  const TYPE_BY_PAGE={ce:'CE',tbkh:'TBKH',ali1688:'ALI1688',shopeecn:'SHOPEECN',shopeevn:'SHOPEEVN'};
  const pending=new Map();
  const cache=new Map();
  let timer=null;
  let mountSerial=0;

  const css=document.createElement('style');
  css.textContent=`
    .v27-force-trend{margin-top:14px!important;display:block!important;visibility:visible!important;min-height:390px}
    .v27-force-trend .v18-chart-grid{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:10px!important;padding:10px!important}
    .v27-force-trend .v18-chart-card{display:flex!important;visibility:visible!important;min-height:326px!important}
    .v27-force-attempt{margin-top:14px!important;display:block!important;visibility:visible!important}
    .v27-force-attempt-grid,.v27-attempt-grid{display:grid;grid-template-columns:1fr;gap:10px;padding:10px}
    .v27-attempt-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
    .v27-force-attempt-card{min-height:326px;border:1px solid #d9e4f2;border-radius:6px;background:#fff;padding:10px}
    .v27-trend-loading{height:300px;display:grid;place-items:center;color:#7b8ea8;background:#fff;border:1px solid #d9e4f2;border-radius:6px}
    .v27-trend-error{padding:28px;color:#d94b4b;text-align:center}
    @media(max-width:1100px){.v27-force-trend .v18-chart-grid,.v27-attempt-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
  `;
  document.head.appendChild(css);

  function pageValue(){try{return String(currentPage||'');}catch{return '';}}
  function currentRange(){
    let from='',to='';
    try{from=String(dashboardPeriodRange?.fromDate||'');to=String(dashboardPeriodRange?.toDate||'');}catch{}
    from=from||document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||'';
    to=to||document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'';
    if(!to){try{to=String(historyModeDate||unifiedImportState?.reportDate||'');}catch{}}
    if(!from)from=to;
    return {from,to};
  }
  function rootFor(type){return type.startsWith('SHOPEE')?document.getElementById('shopeePage'):document.getElementById('ccslPage');}
  function isVisible(node){return Boolean(node&&!node.hidden&&node.offsetParent!==null);}
  function series(name,color,values){return{name,color,values:(values||[]).map(value=>Number.isFinite(Number(value))?Number(value):null)};}
  function genericCharts(data){return[
    {title:'今日票数趋势',type:'count',dates:data.dates||[],series:[series('票数','#1677ff',data.ticket)]},
    {title:'POD率趋势',type:'rate',dates:data.dates||[],series:[series('POD率','#16a36a',data.podRate)]},
    {title:'OC率趋势',type:'rate',oc:true,dates:data.dates||[],series:[series('OC率','#ff8a00',data.ocRate)]},
    {title:'首次妥投率趋势',type:'rate',dates:data.dates||[],series:[series('首次妥投率','#6c4cf5',data.firstRate)]}
  ];}
  function attemptChart(data,label){return{title:`${label} 1/2/3派成功率趋势`,type:'rate',dates:data.dates||[],series:[series('1派','#1677ff',data.attempt1),series('2派','#16a36a',data.attempt2),series('3派','#ff8a00',data.attempt3)]};}

  function ensureSection(root){
    let section=root.querySelector('.v18-trend-section');
    if(!section){
      section=document.createElement('section');
      section.className='v18-panel v18-trend-section v27-force-trend';
      section.innerHTML='<h2>趋势图表</h2><div class="v18-chart-grid"></div>';
      const preview=root.querySelector('#ccslPreviewPanel,#shopeePreviewPanel,.v18-detail-preview,.preview-panel');
      if(preview)preview.insertAdjacentElement('beforebegin',section);else root.appendChild(section);
    }
    section.classList.add('v27-force-trend');
    let grid=section.querySelector('.v18-chart-grid');
    if(!grid){grid=document.createElement('div');grid.className='v18-chart-grid';section.appendChild(grid);}
    return section;
  }
  function resetGridIfNeeded(grid){
    if(grid.querySelectorAll('.v18-chart-card').length===4)return;
    grid.innerHTML=Array.from({length:4},(_,index)=>`<article class="v18-chart-card" data-v27-force-index="${index}"><div class="v27-trend-loading">正在读取趋势…</div></article>`).join('');
  }
  function ensureAttempt(root,type){
    if(!type.startsWith('SHOPEE')){root.querySelector('#v27ForcedAttemptTrend')?.remove();return null;}
    let section=root.querySelector('#v27ForcedAttemptTrend');
    if(!section){
      section=document.createElement('section');
      section.id='v27ForcedAttemptTrend';
      section.className='v18-panel v27-force-attempt';
      section.innerHTML='<h2>1/2/3派成功率趋势</h2><div class="v27-force-attempt-grid"><article class="v27-force-attempt-card"><div class="v27-trend-loading">正在读取派次趋势…</div></article></div>';
      const trend=root.querySelector('.v18-trend-section');
      trend?.insertAdjacentElement('afterend',section);
    }
    return section;
  }

  async function load(type,range){
    const key=`${type}:${range.from}:${range.to}`;
    const cached=cache.get(key);
    if(cached&&Date.now()-cached.at<15000)return cached.data;
    if(pending.has(key))return pending.get(key);
    const promise=(async()=>{
      const url=`/api/v27/trends?businessType=${encodeURIComponent(type)}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
      const data=await api(url);
      cache.set(key,{at:Date.now(),data});
      return data;
    })().finally(()=>pending.delete(key));
    pending.set(key,promise);
    return promise;
  }

  async function mount(type,{force=false}={}){
    const root=rootFor(type);
    if(!isVisible(root))return;
    const range=currentRange();
    if(!range.to)return;
    const key=`${type}:${range.from}:${range.to}`;
    const section=ensureSection(root);
    const grid=section.querySelector('.v18-chart-grid');
    const attemptSection=ensureAttempt(root,type);

    if(!force&&section.dataset.v27TrendKey===key&&section.dataset.v27TrendState==='ready')return;

    section.dataset.v27TrendKey=key;
    section.dataset.v27TrendState='loading';
    resetGridIfNeeded(grid);
    const serial=++mountSerial;
    try{
      const data=await load(type,range);
      if(serial!==mountSerial||!isVisible(root)||section.dataset.v27TrendKey!==key)return;
      if(!data||!Array.isArray(data.dates))throw new Error('趋势数据不可用');
      resetGridIfNeeded(grid);
      genericCharts(data).forEach((chart,index)=>{
        const card=grid.children[index];
        if(card&&global.RateTrendCardV18)global.RateTrendCardV18.render(card,chart);
      });
      if(attemptSection&&global.RateTrendCardV18){
        const card=attemptSection.querySelector('.v27-force-attempt-card');
        if(card)global.RateTrendCardV18.render(card,attemptChart(data,type==='SHOPEECN'?'SHOPEE CN':'SHOPEE VN'));
      }
      section.dataset.v27TrendState='ready';
    }catch(error){
      if(serial!==mountSerial||section.dataset.v27TrendKey!==key)return;
      section.dataset.v27TrendState='error';
      grid.innerHTML=`<div class="v27-trend-error">走势图读取失败：${String(error?.message||error)}</div>`;
      if(attemptSection){
        const card=attemptSection.querySelector('.v27-force-attempt-card');
        if(card)card.innerHTML=`<div class="v27-trend-error">派次走势图读取失败：${String(error?.message||error)}</div>`;
      }
    }
  }

  async function mountHomeAttempts({force=false}={}){
    if(pageValue()!=='home')return;
    const root=document.getElementById('homePage');
    if(!isVisible(root))return;
    const range=currentRange();
    if(!range.to)return;
    const key=`HOME:${range.from}:${range.to}`;
    const anchor=root.querySelector('.v18-trend-section');
    if(!anchor)return;
    let section=root.querySelector('#v27ForcedHomeAttemptTrends');
    if(!section){
      section=document.createElement('section');
      section.id='v27ForcedHomeAttemptTrends';
      section.className='v18-panel v27-force-attempt';
      section.innerHTML='<h2>SHOPEE 1/2/3派成功率趋势</h2><div class="v27-attempt-grid"><article class="v27-force-attempt-card" data-group="CN"><div class="v27-trend-loading">正在读取 CN 派次趋势…</div></article><article class="v27-force-attempt-card" data-group="VN"><div class="v27-trend-loading">正在读取 VN 派次趋势…</div></article></div>';
      anchor.insertAdjacentElement('afterend',section);
    }
    if(!force&&section.dataset.v27TrendKey===key&&section.dataset.v27TrendState==='ready')return;
    section.dataset.v27TrendKey=key;
    section.dataset.v27TrendState='loading';
    const serial=++mountSerial;
    try{
      const [cn,vn]=await Promise.all([load('SHOPEECN',range),load('SHOPEEVN',range)]);
      if(serial!==mountSerial||pageValue()!=='home'||section.dataset.v27TrendKey!==key)return;
      if(global.RateTrendCardV18){
        global.RateTrendCardV18.render(section.querySelector('[data-group="CN"]'),attemptChart(cn,'SHOPEE CN'));
        global.RateTrendCardV18.render(section.querySelector('[data-group="VN"]'),attemptChart(vn,'SHOPEE VN'));
      }
      section.dataset.v27TrendState='ready';
    }catch(error){
      if(serial!==mountSerial||section.dataset.v27TrendKey!==key)return;
      section.dataset.v27TrendState='error';
      section.querySelectorAll('.v27-force-attempt-card').forEach(card=>card.innerHTML=`<div class="v27-trend-error">派次走势图读取失败：${String(error?.message||error)}</div>`);
    }
  }

  function schedule({force=false,delay=80}={}){
    clearTimeout(timer);
    timer=setTimeout(()=>{
      const page=pageValue();
      const type=TYPE_BY_PAGE[page];
      if(type)void mount(type,{force});
      else if(page==='home')void mountHomeAttempts({force});
    },delay);
  }

  function installHooks(){
    try{
      if(global.DashboardV18&&!global.DashboardV18.__v27TrendMountWrapped){
        const oldBusiness=global.DashboardV18.renderBusiness;
        const oldHome=global.DashboardV18.renderHome;
        global.DashboardV18.renderBusiness=function(root,model){
          const value=oldBusiness(root,model);
          const type=String(model?.businessType||'').toUpperCase();
          setTimeout(()=>void mount(type,{force:true}),0);
          return value;
        };
        global.DashboardV18.renderHome=function(root,model){
          const value=oldHome(root,model);
          setTimeout(()=>void mountHomeAttempts({force:true}),0);
          return value;
        };
        global.DashboardV18.__v27TrendMountWrapped=true;
      }
    }catch(error){console.warn('[V27 TREND] hook failed',error);}

    // IMPORTANT: do NOT observe the dashboard DOM. Chart rendering itself mutates
    // the DOM and a MutationObserver here creates a render -> mutation -> render loop
    // that freezes Chrome. Only explicit navigation/render/date actions may remount.
    document.getElementById('topRangeQuery')?.addEventListener('click',()=>schedule({force:true,delay:180}));
    document.getElementById('dashboardRangeFrom')?.addEventListener('change',()=>schedule({force:true,delay:180}));
    document.getElementById('dashboardRangeTo')?.addEventListener('change',()=>schedule({force:true,delay:180}));
    schedule({force:false,delay:120});
  }

  let tries=0;
  const ready=setInterval(()=>{
    tries+=1;
    if(global.RateTrendCardV18&&typeof api==='function'){
      clearInterval(ready);
      installHooks();
    }else if(tries>100){
      clearInterval(ready);
    }
  },100);
})(window);
