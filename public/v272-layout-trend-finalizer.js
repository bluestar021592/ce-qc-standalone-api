(function installV272LayoutTrendFinalizer(global){
  if(global.__CE_QC_V272_LAYOUT_TREND_FINALIZER__)return;
  global.__CE_QC_V272_LAYOUT_TREND_FINALIZER__=true;
  const ID='2026-08-25-v299-fast-exact-all-board-trend-owner-v1';
  const V273_COMPAT_ID='2026-08-24-v273-single-visible-trend-owner-v1';
  const SPECIAL=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
  const GENERIC=new Set(['CE','CEAF','ALI1688','WHPP','ALL']);
  const ALL_BOARDS=new Set([...SPECIAL,...GENERIC]);
  const COLORS={blue:'#1677ff',green:'#16a36a',orange:'#ff8a00',purple:'#6d4aff'};
  const FAST_TIMEOUT_MS=5000;
  const STRICT_TIMEOUT_MS=25000;
  const STRICT_DELAY_MS=16000;
  const strictRetries=new Map();
  let hydrationSeq=0;
  const byId=id=>document.getElementById(id);
  const date=v=>String(v||'').slice(0,10);
  const nullable=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const fmt=v=>Number.isFinite(Number(v))?Number(v).toLocaleString('zh-CN'):'—';
  const pct=v=>v===null||v===undefined||!Number.isFinite(Number(v))?'—':`${Number(v).toFixed(2)}%`;

  function installStyle(){
    if(byId('v272Style'))return;
    const s=document.createElement('style');s.id='v272Style';s.textContent=`
      #settingsPage .settings-grid{align-items:start!important;grid-auto-rows:auto!important}
      #settingsPage .settings-grid>.panel{align-self:start!important;height:auto!important;min-height:0!important}
      #settingsPage .auth-panel,#settingsPage #shopSettingsPanel,#settingsPage .settings-grid>.panel:nth-child(3){min-height:0!important}
      #shopSettingsPanel.v271-shop-panel{padding-bottom:14px!important}
      #shopSettingsPanel .v271-shop-help{min-height:0!important}
      .v272-status{margin:0 0 12px;padding:9px 12px;border-radius:8px;background:#eef7ff;color:#315d86;font-size:12px;line-height:1.55}
      .v272-status.ok{background:#ecfbf3;color:#087a45}.v272-status.warn{background:#fff7e6;color:#8a6200}.v272-status.error{background:#fff1f1;color:#a61b1b}
      .v272-trend-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
      .v272-trend-grid>.v18-chart-card{min-height:270px!important;margin:0!important}
      .v272-skeleton-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
      .v272-skeleton{height:132px;border:1px solid #e0eaf4;border-radius:10px;background:linear-gradient(90deg,#f7faff 25%,#eef5fb 37%,#f7faff 63%);background-size:400% 100%;animation:v272pulse 1.3s ease infinite}
      @keyframes v272pulse{0%{background-position:100% 0}100%{background-position:0 0}}
      .v272-empty{display:flex;align-items:center;justify-content:center;min-height:150px;border:1px dashed #d8e4ef;border-radius:10px;background:#fbfdff;color:#6c8095;text-align:center;padding:20px;line-height:1.7}
      .v272-attempt-panel{margin-top:14px}.v272-attempt-panel .v272-attempt-summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:12px 0}
      .v272-attempt-summary>div{border:1px solid #dfe9f4;border-radius:9px;background:#fbfdff;padding:10px 12px}.v272-attempt-summary span{display:block;color:#70849b;font-size:11px}.v272-attempt-summary b{display:block;color:#123a67;font-size:19px;margin-top:4px}
      .v272-attempt-chart{display:grid;grid-template-columns:minmax(0,1fr)}.v272-attempt-chart>.v18-chart-card{min-height:290px!important}
      .v272-legacy-hidden{display:none!important}
      @media(max-width:1280px){.v272-trend-grid,.v272-skeleton-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.v272-attempt-panel .v272-attempt-summary{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media(max-width:760px){.v272-trend-grid,.v272-skeleton-grid{grid-template-columns:1fr}.v272-attempt-panel .v272-attempt-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;document.head.appendChild(s);
  }

  function range(model={}){
    const report=date(model.reportDate);return{from:date(byId('topRangeFrom')?.value)||report,to:date(byId('topRangeTo')?.value)||report};
  }
  function renderer(){return global.RateTrendCardV18?.render;}
  async function api(url,timeout){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
    try{const r=await fetch(url,{cache:'no-store',credentials:'same-origin',signal:c.signal});const raw=await r.text();let j={};try{j=raw?JSON.parse(raw):{};}catch{}if(!r.ok||j.ok===false)throw new Error(j.error||j.message||`HTTP ${r.status}`);return j;}finally{clearTimeout(t);}
  }
  const series=(name,color,values,numerators=[],denominators=[])=>({name,color,values:Array.isArray(values)?values:[],numerators,denominators});
  function status(section,text,tone=''){
    if(!section)return;let n=section.querySelector('.v272-status');if(!n){n=document.createElement('div');n.className='v272-status';section.querySelector('h2')?.insertAdjacentElement('afterend',n);}n.className=`v272-status ${tone}`.trim();n.textContent=text;
  }
  function removeTrendBodies(section){section?.querySelectorAll('.v18-chart-grid,.v272-trend-grid,.v272-skeleton-grid,.v272-empty').forEach(n=>n.remove());}
  function skeleton(section){
    if(!section)return;removeTrendBodies(section);const n=document.createElement('div');n.className='v272-skeleton-grid';n.innerHTML='<div class="v272-skeleton"></div>'.repeat(4);section.appendChild(n);
  }
  function clearLoading(section){section?.querySelectorAll('.v272-skeleton-grid,.v271-trend-status').forEach(n=>n.remove());}
  function draw(section,specs){
    const render=renderer();if(typeof render!=='function')throw new Error('走势图组件尚未就绪');clearLoading(section);removeTrendBodies(section);
    const grid=document.createElement('div');grid.className='v272-trend-grid';grid.innerHTML=specs.map(()=>'<article class="v18-chart-card"></article>').join('');section.appendChild(grid);[...grid.children].forEach((node,i)=>render(node,specs[i]));
  }
  function noData(section,message){clearLoading(section);removeTrendBodies(section);const n=document.createElement('div');n.className='v272-empty';n.innerHTML=`<div><b>暂无可绘制趋势</b><br>${message}</div>`;section.appendChild(n);}
  function hasUseful(values=[]){return values.some(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v)));}

  function exactSlice(data={},from='',to=''){
    const sourceDaily=Array.isArray(data.daily)?data.daily:[];
    const daily=sourceDaily.filter(row=>{const d=date(row?.reportDate);return d&&d>=from&&d<=to;});
    if(!daily.length){return{...data,fromDate:from,toDate:to,exactRequestedRange:true,dates:[],daily:[],ticket:[],pod:[],podRate:[],oc:[],ocRate:[],sameDayPod:[],sameDayPodRate:[]};}
    const dates=daily.map(row=>date(row.reportDate));
    return{
      ...data,fromDate:from,toDate:to,exactRequestedRange:true,dates,daily,
      ticket:daily.map(row=>num(row.total)),
      pod:daily.map(row=>row.ready===false?null:nullable(row.pod)),
      podRate:daily.map(row=>row.ready===false?null:nullable(row.podRate)),
      oc:daily.map(row=>row.ready===false?null:nullable(row.ocCurrent??row.oc)),
      ocRate:daily.map(row=>row.ready===false?null:nullable(row.ocRate)),
      sameDayPod:daily.map(row=>row.ready===false?null:nullable(row.sameDayPod)),
      sameDayPodRate:daily.map(row=>row.ready===false?null:nullable(row.sameDayPodRate)),
      avgSigningDays:daily.map(row=>nullable(row.avgSigningDays)),
      attempt1:daily.map(row=>row.attempt1??null),attempt2:daily.map(row=>row.attempt2??null),attempt3:daily.map(row=>row.attempt3??null),
      attempt1Rate:daily.map(row=>row.attempt1Rate??null),attempt2Rate:daily.map(row=>row.attempt2Rate??null),attempt3Rate:daily.map(row=>row.attempt3Rate??null),
      attemptCoverageRate:daily.map(row=>row.attemptCoverageRate??null),signingCoverageRate:daily.map(row=>row.signingCoverageRate??null)
    };
  }

  function genericSpecs(type,data){
    const daily=Array.isArray(data.daily)?data.daily:[],dates=data.dates||daily.map(r=>r.reportDate),ticket=daily.length?daily.map(r=>num(r.total)):(data.ticket||[]),pod=daily.length?daily.map(r=>r.ready===false?null:nullable(r.pod)):(data.pod||[]),oc=daily.length?daily.map(r=>r.ready===false?null:nullable(r.ocCurrent??r.oc)):(data.oc||[]),same=daily.length?daily.map(r=>r.ready===false?null:nullable(r.sameDayPod)):(data.sameDayPod||[]);
    const rate=(key,fallback)=>daily.length?daily.map(r=>r.ready===false?null:nullable(r[key])):(fallback||[]);
    return[
      {title:'票数趋势',type:'count',dates,series:[series(`${type}票数`,COLORS.blue,ticket)]},
      {title:'POD率趋势',type:'rate',dates,series:[series('POD率',COLORS.green,rate('podRate',data.podRate),pod,ticket)]},
      {title:'OC率趋势',type:'rate',oc:true,dates,series:[series('OC率',COLORS.orange,rate('ocRate',data.ocRate),oc,ticket)]},
      {title:'首日POD妥投率趋势',type:'rate',dates,series:[series('首日POD',COLORS.purple,rate('sameDayPodRate',data.sameDayPodRate),same,ticket)]}
    ];
  }
  function specialSpecs(data){return[
    {title:'票数趋势',type:'count',dates:data.dates||[],series:[series('票数',COLORS.blue,data.ticket||[])]},
    {title:'POD率趋势',type:'rate',dates:data.dates||[],series:[series('POD率',COLORS.green,data.podRate||[],data.pod||[],data.ticket||[])]},
    {title:'OC率趋势',type:'rate',oc:true,dates:data.dates||[],series:[series('OC率',COLORS.orange,data.ocRate||[],data.oc||[],data.ticket||[])]},
    {title:'平均签收天数趋势',type:'days',dates:data.dates||[],series:[series('平均签收天数',COLORS.purple,data.avgSigningDays||[])]}
  ];}

  function hideLegacyAttempt(root){
    if(!root)return;[...root.querySelectorAll('h2,h3')].forEach(h=>{const t=String(h.textContent||'').replace(/\s+/g,'');if(/^(SHOPEE)?1\/2\/3派成功率趋势/.test(t)||/^SHOPEE1\/2\/3派签收占POD趋势/.test(t)){const box=h.closest('section,article,.panel');if(box&&!box.matches('#v272AttemptPanel,#v271AttemptPanel'))box.classList.add('v272-legacy-hidden');}});root.querySelector('#v271AttemptPanel')?.classList.add('v272-legacy-hidden');root.querySelector('#v263DeliveryKpiPanel')?.classList.add('v272-legacy-hidden');
  }
  function clearStrictExtras(root){root?.querySelector('#v272AttemptPanel')?.remove();hideLegacyAttempt(root);}
  function renderAttempt(root,type,data){
    hideLegacyAttempt(root);root.querySelector('#v272AttemptPanel')?.remove();
    const last=(data.daily||[]).at(-1)||{};
    const ledgerReady=last.ledgerReady!==false;
    const pod=ledgerReady?num(last.pod):null;
    const known=ledgerReady?num(last.attemptEvidenceCount):0;
    const attemptComplete=ledgerReady&&Boolean(last.attemptEvidenceComplete ?? (pod===0||known>=pod));
    const signingComplete=ledgerReady&&Boolean(last.signingEvidenceComplete ?? (pod===0||last.avgSigningDays!=null));
    const unknown=ledgerReady&&pod!=null?Math.max(0,pod-known):0;
    const fullComplete=ledgerReady&&attemptComplete&&signingComplete;
    const statusText=!ledgerReady
      ?'当前日报状态事实仍在验证，未完成前POD、派次和平均签收天数统一显示“—”。'
      :!attemptComplete
        ?`正在补全派次证据：已识别 ${fmt(known)}/${fmt(pod)}，待补 ${fmt(unknown)}。未覆盖全部POD前1/2/3派件数与比例统一显示“—”。`
        :!signingComplete
          ?'派次证据已覆盖当前POD；签收日期证据仍在补全，平均签收天数暂显示“—”。'
          :'当前POD的派次与签收天数证据已完整覆盖。';
    const panel=document.createElement('section');panel.id='v272AttemptPanel';panel.className='v18-panel v272-attempt-panel';panel.innerHTML=`<h2>1/2/3派与平均签收天数 <small>${type} · 真实轨迹持续跟踪</small></h2><div class="v272-status ${fullComplete?'ok':'warn'}">${statusText}</div><div class="v272-attempt-summary"><div><span>当前POD</span><b>${ledgerReady?fmt(pod):'—'}</b></div><div><span>1派签收</span><b>${attemptComplete?fmt(last.attempt1):'—'}</b></div><div><span>2派签收</span><b>${attemptComplete?fmt(last.attempt2):'—'}</b></div><div><span>3派+签收</span><b>${attemptComplete?fmt(last.attempt3):'—'}</b></div><div><span>平均签收天数</span><b>${signingComplete&&last.avgSigningDays!=null?`${Number(last.avgSigningDays).toFixed(2)}天`:'—'}</b></div><div><span>签收天数覆盖</span><b>${ledgerReady?pct(last.signingCoverageRate):'—'}</b></div></div>`;
    const evidence=[...(data.attempt1Rate||[]),...(data.attempt2Rate||[]),...(data.attempt3Rate||[])].some(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v)));
    if(evidence){const chart=document.createElement('div');chart.className='v272-attempt-chart';chart.innerHTML='<article class="v18-chart-card"></article>';panel.appendChild(chart);renderer()?.(chart.firstElementChild,{title:'1/2/3派签收占POD趋势',type:'rate',dates:data.dates||[],evidenceIncomplete:Boolean(data.evidenceIncomplete),series:[series('1派',COLORS.blue,data.attempt1Rate||[],data.attempt1||[],data.pod||[]),series('2派',COLORS.green,data.attempt2Rate||[],data.attempt2||[],data.pod||[]),series('3派+',COLORS.orange,data.attempt3Rate||[],data.attempt3||[],data.pod||[])]});}else{const empty=document.createElement('div');empty.className='v272-empty';empty.innerHTML='<div><b>当前暂无可验证的1/2/3派轨迹证据</b><br>系统继续自动补抓；证据未完整前显示“—”，这不代表1派、2派、3派为0。</div>';panel.appendChild(empty);}
    const preview=root.querySelector('.v18-detail-preview');preview?.parentNode?.insertBefore(panel,preview);if(!panel.isConnected)root.appendChild(panel);
  }

  function findSection(root){return root?.querySelector('.v18-trend-section')||null;}
  function snapshotFallback(section){
    if(!section)return;status(section,'正在按所选日期读取走势图…','');skeleton(section);
  }
  function fastUrl(type,rg){return`/api/v253/trends?businessType=${encodeURIComponent(type)}&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`;}
  function strictUrl(type,rg){return SPECIAL.has(type)?`/api/v263/delivery-trends?businessType=${encodeURIComponent(type)}&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`:`/api/v273/trends?businessType=${encodeURIComponent(type)}&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`;}
  function usefulData(data,specs){return(data.dates||[]).length&&specs.some(spec=>spec.series.some(s=>hasUseful(s.values)));}
  function exactCountText(data){return`${(data.dates||[]).length} 个有效日报`;}

  async function refineStrict(root,type,rg,key,section,fastVisible){
    if(!root?.isConnected||root.dataset.v272Key!==key)return;
    try{
      const raw=await api(strictUrl(type,rg),STRICT_TIMEOUT_MS);if(root.dataset.v272Key!==key)return;
      const data=exactSlice(raw,rg.from,rg.to),specs=SPECIAL.has(type)?specialSpecs(data):genericSpecs(type,data);
      if(!usefulData(data,specs)){
        if(fastVisible)status(section,`已显示 ${exactCountText({dates:[...section.querySelectorAll('.v18-chart-card')].length?data.dates:[]})}的基础走势图；严格轨迹证据仍在补全，缺失指标保持“—”。`,'warn');
        return;
      }
      draw(section,specs);
      const missing=Array.isArray(data.missingDates)?data.missingDates.length:(data.daily||[]).filter(r=>r.ledgerReady===false||r.evidenceIncomplete===true).length;
      status(section,missing?`已显示 ${(data.dates||[]).length} 个有效日报；其中 ${missing} 天严格轨迹证据仍在补全，缺失指标显示“—”。`:`已显示 ${(data.dates||[]).length} 个有效日报，走势图已完成严格证据校准。`,missing?'warn':'ok');
      if(SPECIAL.has(type))renderAttempt(root,type,data);
      strictRetries.delete(`${type}|${rg.from}|${rg.to}`);
    }catch(error){
      if(root.dataset.v272Key!==key)return;
      if(fastVisible){
        status(section,`基础走势图已按所选日期显示；严格轨迹证据${error?.name==='AbortError'?'读取较慢':'暂未完成'}，系统会后台继续校准，不影响当前走势图。`,'warn');
        const retryKey=`${type}|${rg.from}|${rg.to}`,n=strictRetries.get(retryKey)||0;if(n<1){strictRetries.set(retryKey,n+1);setTimeout(()=>refineStrict(root,type,rg,key,section,true),30000);}
      }else{
        status(section,`走势图暂未完成：${error?.name==='AbortError'?'读取超时':error?.message||error}。系统会自动重试。`,'error');
      }
    }
  }

  async function hydrate(root,model,type){
    if(!root||!root.isConnected||!ALL_BOARDS.has(type))return;const section=findSection(root);if(!section)return;
    const rg=range(model);if(!rg.from||!rg.to||rg.from>rg.to)return;
    const key=`V299|${type}|${rg.from}|${rg.to}|${++hydrationSeq}`;root.dataset.v272Key=key;root.dataset.v271TrendKey=`V299_OWNER_${key}`;root.dataset.v263Request=`V299_OWNER_${key}`;clearStrictExtras(root);snapshotFallback(section);
    try{
      const fastRaw=await api(fastUrl(type,rg),FAST_TIMEOUT_MS);if(root.dataset.v272Key!==key)return;
      const fast=exactSlice(fastRaw,rg.from,rg.to),specs=genericSpecs(type,fast);
      if(!usefulData(fast,specs)){
        status(section,'快速日报事实暂未返回，正在直接读取严格轨迹证据…','warn');
        await refineStrict(root,type,rg,key,section,false);return;
      }
      draw(section,specs);status(section,`已显示 ${(fast.dates||[]).length} 个有效日报，走势图已更新。严格轨迹证据将在后台继续校准。`,'ok');
      setTimeout(()=>refineStrict(root,type,rg,key,section,true),STRICT_DELAY_MS);
    }catch(error){
      if(root.dataset.v272Key!==key)return;
      status(section,`快速走势图${error?.name==='AbortError'?'读取较慢':'暂未完成'}，正在切换严格证据通道…`,'warn');
      await refineStrict(root,type,rg,key,section,false);
    }
  }

  function visibleRoot(){return[...document.querySelectorAll('.app-page')].find(n=>!n.hidden&&getComputedStyle(n).display!=='none')||document.querySelector('main');}
  function activeType(){const t=String(byId('pageTitle')?.textContent||'').toUpperCase();if(t.includes('SHOPEE CN'))return'SHOPEECN';if(t.includes('SHOPEE VN'))return'SHOPEEVN';if(t.includes('WHPP'))return'WHPP';if(t.includes('CEAF'))return'CEAF';if(t.includes('TBKH'))return'TBKH';if(t.includes('ALI1688'))return'ALI1688';if(/^CE看板/.test(t))return'CE';if(t.includes('首页'))return'ALL';return'';}
  async function hydrateWhppStandalone(){
    if(activeType()!=='WHPP')return;const root=visibleRoot();if(!root)return;
    if(findSection(root)){hydrate(root,{reportDate:byId('topRangeTo')?.value},'WHPP');return;}
    const rg={from:date(byId('topRangeFrom')?.value),to:date(byId('topRangeTo')?.value)};if(!rg.to)return;if(!rg.from)rg.from=rg.to;
    const heading=[...root.querySelectorAll('h2,h3')].find(h=>/区域与趋势|趋势图表/.test(String(h.textContent||''))),panel=heading?.closest('section,article,.panel');if(!panel)return;
    let host=panel.querySelector('.v299-whpp-host');if(!host){host=document.createElement('div');host.className='v299-whpp-host';panel.appendChild(host);}host.innerHTML='<div class="v272-status">正在按所选日期读取WHPP走势图…</div><div class="v272-skeleton-grid">'+ '<div class="v272-skeleton"></div>'.repeat(4)+'</div>';
    try{const fast=exactSlice(await api(fastUrl('WHPP',rg),FAST_TIMEOUT_MS),rg.from,rg.to);host.innerHTML='';const st=document.createElement('div');st.className='v272-status ok';st.textContent=`已显示 ${(fast.dates||[]).length} 个有效日报，WHPP走势图已更新。`;host.appendChild(st);const grid=document.createElement('div');grid.className='v272-trend-grid';const specs=genericSpecs('WHPP',fast);grid.innerHTML=specs.map(()=>'<article class="v18-chart-card"></article>').join('');host.appendChild(grid);[...grid.children].forEach((n,i)=>renderer()?.(n,specs[i]));}catch(e){host.innerHTML=`<div class="v272-status error">WHPP走势图暂未完成：${String(e?.message||e).replace(/[<>]/g,'')}</div><div class="v272-empty">系统将自动重试。</div>`;setTimeout(hydrateWhppStandalone,8000);}
  }

  function polishSettings(){installStyle();const page=byId('settingsPage');if(!page)return;page.querySelector('.settings-grid')?.classList.add('v272-settings-clean');}
  function retireLegacyEverywhere(){const root=visibleRoot();if(root)hideLegacyAttempt(root);}
  function rehydrateVisible(){const root=visibleRoot(),type=activeType();if(root&&ALL_BOARDS.has(type))hydrate(root,{reportDate:byId('topRangeTo')?.value},type);else hydrateWhppStandalone();}

  function installWrappers(){
    if(!global.DashboardV18||global.DashboardV18.__v272Wrapped)return false;const prevBusiness=global.DashboardV18.renderBusiness?.bind(global.DashboardV18),prevHome=global.DashboardV18.renderHome?.bind(global.DashboardV18);if(!prevBusiness||!prevHome)return false;
    global.DashboardV18.renderBusiness=function(root,model){const out=prevBusiness(root,model);root.dataset.v271TrendKey=`V299_SUPERSEDED_${Date.now()}`;root.dataset.v263Request=`V299_SUPERSEDED_${Date.now()}`;const type=String(model?.businessType||'').toUpperCase();if(ALL_BOARDS.has(type))queueMicrotask(()=>hydrate(root,model,type));return out;};
    global.DashboardV18.renderHome=function(root,model){const out=prevHome(root,model);root.dataset.v271HomeKey=`V299_SUPERSEDED_${Date.now()}`;root.dataset.v271TrendKey=`V299_SUPERSEDED_${Date.now()}`;queueMicrotask(()=>hydrate(root,model,'ALL'));queueMicrotask(()=>hideLegacyAttempt(root));return out;};
    global.DashboardV18.__v272Wrapped=true;return true;
  }
  function boot(){installStyle();if(!installWrappers()){setTimeout(boot,120);return;}polishSettings();retireLegacyEverywhere();setTimeout(rehydrateVisible,180);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  document.addEventListener('click',e=>{if(e.target?.closest?.('.side-link[data-page],#topRangeQuery'))setTimeout(()=>{polishSettings();retireLegacyEverywhere();rehydrateVisible();},180);},false);
  document.addEventListener('change',e=>{if(e.target?.matches?.('#topRangeFrom,#topRangeTo'))setTimeout(rehydrateVisible,180);},false);
  const observer=new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1))){polishSettings();retireLegacyEverywhere();}});observer.observe(document.documentElement,{subtree:true,childList:true});
  global.__CE_QC_V272_LAYOUT_TREND_FINALIZER__={id:ID,compatId:V273_COMPAT_ID,hydrateWhppStandalone,rehydrateVisible,exactSlice};
  console.info('[CE-QC][V299_LAYOUT_TREND]',ID,'all eight visible board scopes use fast V253 latest-VALID exact-sliced first paint; V273/V263 strict truth refines later without blanking an already correct selected-range chart.');
})(window);
