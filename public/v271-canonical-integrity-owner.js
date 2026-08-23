(function installV271CanonicalIntegrityOwner(global){
  if(global.__CE_QC_V271_CANONICAL_INTEGRITY__)return;
  global.__CE_QC_V271_CANONICAL_INTEGRITY__=true;
  const ID='2026-08-23-v271-canonical-integrity-owner-v1';
  const SPECIAL=new Set(['TBKH','SHOPEECN','SHOPEEVN']);
  const GENERIC=new Set(['CE','CEAF','ALI1688','WHPP']);
  const retryState=new Map();
  const originalRenderBusiness=global.DashboardV18?.renderBusiness?.bind(global.DashboardV18);
  const originalRenderHome=global.DashboardV18?.renderHome?.bind(global.DashboardV18);
  const byId=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=v=>Number.isFinite(Number(v))?Number(v).toLocaleString('zh-CN'):'—';
  const pct=v=>v===null||v===undefined||!Number.isFinite(Number(v))?'—':`${Number(v).toFixed(2)}%`;
  const date=v=>String(v||'').slice(0,10);

  function installStyle(){
    if(byId('v271Style'))return;
    const s=document.createElement('style');s.id='v271Style';s.textContent=`
      #shopSettingsPanel.v271-shop-panel{display:grid!important;grid-template-columns:minmax(0,1fr);gap:12px;align-self:stretch}
      #shopSettingsPanel.v271-shop-panel .panel-title{margin:0}
      #shopSettingsPanel .v271-shop-help{margin:-4px 0 0;color:#607b99;font-size:12px;line-height:1.65}
      #shopSettingsPanel .v271-shop-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      #shopSettingsPanel .v271-shop-actions .btn{margin:0!important;width:100%;height:42px}
      #shopSettingsPanel .v271-shop-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
      #shopSettingsPanel .v271-shop-stat{border:1px solid #dbe7f3;border-radius:8px;background:#f8fbff;padding:9px 10px;min-height:62px}
      #shopSettingsPanel .v271-shop-stat span{display:block;color:#70849b;font-size:11px}.v271-shop-stat b{display:block;color:#123a67;font-size:18px;margin-top:4px}
      #shopSettingsPanel .v271-shop-rule{padding:10px 12px;border-radius:8px;background:#eef7ff;color:#315d86;font-size:12px;line-height:1.7}
      #shopSettingsPanel .v271-shop-rule strong{color:#0d4f8a}
      .v271-db-help{display:block;color:#70849b;font-size:11px;margin-top:3px;line-height:1.5}
      .v271-trend-status{margin:0 0 10px;padding:8px 10px;border-radius:7px;background:#eef7ff;color:#315d86;font-size:12px;line-height:1.55}
      .v271-trend-status.warn{background:#fff7e6;color:#8a6200}.v271-trend-status.error{background:#fff1f1;color:#a61b1b}.v271-trend-status.ok{background:#ecfbf3;color:#087a45}
      .v271-attempt-summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin:10px 0}
      .v271-attempt-summary>div{border:1px solid #dfe9f4;border-radius:8px;padding:9px;background:#fbfdff}.v271-attempt-summary span{display:block;color:#70849b;font-size:11px}.v271-attempt-summary b{display:block;color:#123a67;font-size:18px;margin-top:4px}
      #v271AttemptPanel .v18-chart-grid{grid-template-columns:minmax(0,1fr)!important}
      @media(max-width:1200px){#shopSettingsPanel .v271-shop-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.v271-attempt-summary{grid-template-columns:repeat(3,minmax(0,1fr))}}
    `;document.head.appendChild(s);
  }
  async function api(url,options={}){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),9000);
    try{const r=await fetch(url,{cache:'no-store',credentials:'same-origin',signal:controller.signal,...options});const raw=await r.text();let j={};try{j=raw?JSON.parse(raw):{};}catch{}if(!r.ok||j.ok===false)throw new Error(j.error||j.message||`HTTP ${r.status}`);return j;}finally{clearTimeout(timer);}
  }
  function range(model={}){
    const report=date(model.reportDate);const from=date(byId('topRangeFrom')?.value)||report;const to=date(byId('topRangeTo')?.value)||report;return{from,to};
  }
  function renderer(){return global.RateTrendCardV18?.render;}
  function ensureCards(section,count=4){
    if(!section)return[];section.innerHTML=`<h2>趋势图表 <small>读取已落库日报事实，不扫描页面缓存</small></h2><div class="v271-trend-status">正在读取最近有效日报…</div><section class="v18-chart-grid">${Array.from({length:count},(_,i)=>`<article class="v18-chart-card" data-chart-index="${i}"></article>`).join('')}</section>`;return[...section.querySelectorAll('.v18-chart-card')];
  }
  function setStatus(section,message,tone=''){
    const node=section?.querySelector('.v271-trend-status');if(node){node.className=`v271-trend-status ${tone}`.trim();node.textContent=message;}
  }
  function series(name,color,values,numerators=[],denominators=[]){return{name,color,values:Array.isArray(values)?values:[],numerators,denominators};}
  function renderSpecs(section,specs,statusText,statusTone='ok'){
    const draw=renderer();if(typeof draw!=='function')throw new Error('走势图组件尚未加载');const cards=ensureCards(section,specs.length);cards.forEach((card,i)=>draw(card,specs[i]));setStatus(section,statusText,statusTone);
  }
  function genericSpecs(type,data){
    const daily=Array.isArray(data.daily)?data.daily:[],dates=data.dates||daily.map(r=>r.reportDate);
    const ticket=daily.length?daily.map(r=>Number(r.total||0)):(data.ticket||[]);
    const pod=daily.length?daily.map(r=>r.ready?Number(r.pod||0):null):(data.pod||[]);
    const oc=daily.length?daily.map(r=>r.ready?Number(r.ocCurrent||0):null):(data.oc||[]);
    const same=daily.length?daily.map(r=>r.ready?Number(r.sameDayPod||0):null):(data.sameDayPod||[]);
    const rate=(key,fallback)=>daily.length?daily.map(r=>r.ready?(r[key]===null||r[key]===undefined?null:Number(r[key])):null):(fallback||[]);
    return[
      {title:'票数趋势',type:'count',dates,series:[series(`${type}票数`,'#1677ff',ticket)]},
      {title:'POD率趋势',type:'rate',dates,series:[series('POD率','#16a36a',rate('podRate',data.podRate),pod,ticket)]},
      {title:'OC率趋势',type:'rate',oc:true,dates,series:[series('OC率','#ff8a00',rate('ocRate',data.ocRate),oc,ticket)]},
      {title:'首日POD妥投率趋势',type:'rate',dates,series:[series('首日POD','#6d4aff',rate('sameDayPodRate',data.sameDayPodRate),same,ticket)]}
    ];
  }
  function specialSpecs(data){
    const d=data.dates||[];return[
      {title:'票数趋势',type:'count',dates:d,series:[series('票数','#1677ff',data.ticket||[])]},
      {title:'POD率趋势',type:'rate',dates:d,series:[series('POD率','#16a36a',data.podRate||[],data.pod||[],data.ticket||[])]},
      {title:'OC率趋势',type:'rate',oc:true,dates:d,series:[series('OC率','#ff8a00',data.ocRate||[],data.oc||[],data.ticket||[])]},
      {title:'平均签收天数趋势',type:'days',dates:d,series:[series('平均签收天数','#6d4aff',data.avgSigningDays||[])]}
    ];
  }
  function renderAttempt(root,type,data){
    root.querySelector('#v263DeliveryKpiPanel')?.remove();root.querySelector('#v271AttemptPanel')?.remove();
    let panel=document.createElement('section');panel.id='v271AttemptPanel';panel.className='v18-panel';
    const preview=root.querySelector('.v18-detail-preview');preview?.parentNode?.insertBefore(panel,preview);if(!panel.isConnected)root.appendChild(panel);
    const last=(data.daily||[]).at(-1)||{},pod=Number(last.pod||0),known=Number(last.attemptEvidenceCount||0),unknown=Math.max(0,pod-known),complete=pod===0||known>=pod;
    panel.innerHTML=`<h2>1/2/3派与平均签收天数 <small>${esc(type)} · 仅真实轨迹证据</small></h2>
      <div class="v271-trend-status ${complete?'ok':'warn'}">${complete?'派次证据已覆盖当前POD。':`派次证据仍在自动补抓：已识别 ${fmt(known)}/${fmt(pod)}，待补 ${fmt(unknown)}。未补完前不把0当成最终结论。`}</div>
      <div class="v271-attempt-summary">
        <div><span>当前POD</span><b>${fmt(pod)}</b></div><div><span>1派签收</span><b>${complete||Number(last.attempt1||0)>0?fmt(last.attempt1):'待补抓'}</b></div><div><span>2派签收</span><b>${complete||Number(last.attempt2||0)>0?fmt(last.attempt2):'待补抓'}</b></div><div><span>3派+签收</span><b>${complete||Number(last.attempt3||0)>0?fmt(last.attempt3):'待补抓'}</b></div><div><span>平均签收天数</span><b>${last.avgSigningDays==null?'待补抓':`${Number(last.avgSigningDays).toFixed(2)}天`}</b></div><div><span>签收天数覆盖</span><b>${pct(last.signingCoverageRate)}</b></div>
      </div><section class="v18-chart-grid"><article class="v18-chart-card"></article></section>
      <p class="operation-status">派次规则：70 START优先；整票没有70才允许60；只有Pending/失败后再次START才进入下一派。平均签收天数：首次日报锁定日期 → 真实POD日期（含首尾当天）。</p>`;
    renderer()?.(panel.querySelector('.v18-chart-card'),{title:'1/2/3派签收占POD趋势',type:'rate',dates:data.dates||[],evidenceIncomplete:!complete,series:[series('1派','#1677ff',data.attempt1Rate||[],data.attempt1||[],data.pod||[]),series('2派','#16a36a',data.attempt2Rate||[],data.attempt2||[],data.pod||[]),series('3派+','#ff8a00',data.attempt3Rate||[],data.attempt3||[],data.pod||[])]});
  }
  async function refreshBusiness(root,model,force=false){
    if(!root||!root.isConnected)return;const type=String(model.businessType||'').toUpperCase();if(!SPECIAL.has(type)&&!GENERIC.has(type))return;
    const rg=range(model),key=`${type}|${rg.from}|${rg.to}`;root.dataset.v271TrendKey=key;root.dataset.v263Request=`V271_CANCEL_${Date.now()}`;
    const section=root.querySelector('.v18-trend-section');if(!section)return;ensureCards(section,4);
    try{
      if(SPECIAL.has(type)){
        const data=await api(`/api/v263/delivery-trends?businessType=${encodeURIComponent(type)}&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`);if(root.dataset.v271TrendKey!==key)return;
        const incomplete=(data.daily||[]).filter(r=>r.ledgerReady===false).length;renderSpecs(section,specialSpecs(data),incomplete?`已读取 ${data.dates?.length||0} 个有效日报；${incomplete} 天追踪账本仍在补全，缺失值不伪造为0。`:`已读取 ${data.dates?.length||0} 个有效日报，走势图已更新。`,incomplete?'warn':'ok');renderAttempt(root,type,data);
        const last=(data.daily||[]).at(-1)||{};if(last.evidenceIncomplete||Number(last.attemptUnknown||0)>0)scheduleRetry(key,()=>refreshBusiness(root,model,true));
      }else{
        const data=await api(`/api/v253/trends?businessType=${encodeURIComponent(type)}&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`);if(root.dataset.v271TrendKey!==key)return;
        const missing=Array.isArray(data.missingDates)?data.missingDates.length:0;renderSpecs(section,genericSpecs(type,data),missing?`已读取 ${data.dates?.length||0} 个有效日报；${missing} 天状态事实仍在补全，票数照常显示，未完成比率显示“—”。`:`已读取 ${data.dates?.length||0} 个有效日报，走势图已更新。`,missing?'warn':'ok');if(missing)scheduleRetry(key,()=>refreshBusiness(root,model,true));
      }
    }catch(error){if(root.dataset.v271TrendKey!==key)return;setStatus(section,`走势图读取失败：${error?.name==='AbortError'?'读取超时，系统将自动重试':error?.message||error}`,'error');scheduleRetry(key,()=>refreshBusiness(root,model,true));}
  }
  function scheduleRetry(key,fn){const count=retryState.get(key)||0;if(count>=3)return;retryState.set(key,count+1);setTimeout(fn,count===0?2500:8000).unref?.();}
  async function refreshHome(root,model){
    const rg=range(model),key=`HOME|${rg.from}|${rg.to}`;const section=root.querySelector('.v18-trend-section');if(!section)return;root.dataset.v271HomeKey=key;ensureCards(section,4);
    try{const data=await api(`/api/v253/trends?businessType=ALL&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`);if(root.dataset.v271HomeKey!==key)return;const missing=Array.isArray(data.missingDates)?data.missingDates.length:0;renderSpecs(section,genericSpecs('全部业务',data),missing?`已读取 ${data.dates?.length||0} 个有效日报；${missing} 天仍在补全。`:`已读取 ${data.dates?.length||0} 个有效日报，走势图已更新。`,missing?'warn':'ok');}catch(e){setStatus(section,`总看板走势图读取失败：${e?.message||e}`,'error');}}

  function clarifyDataManagement(){
    const host=byId('dataDbStatus');if(!host)return;const dl=host.querySelector('dl');if(!dl)return;const dts=[...dl.querySelectorAll('dt')],dds=[...dl.querySelectorAll('dd')];
    if(dts[0])dts[0].textContent='数据库文件';if(dts[1])dts[1].textContent='数据库结构版本';if(dts[2])dts[2].textContent='运行状态';
    if(dds[1]&&!dds[1].querySelector('.v271-db-help'))dds[1].insertAdjacentHTML('beforeend','<small class="v271-db-help">这是系统内部表结构版本，用于升级兼容校验，不是数据条数。</small>');
    if(dds[2]){const raw=dds[2].childNodes[0]?.textContent?.trim()?.toLowerCase();if(raw==='normal')dds[2].childNodes[0].textContent='正常';if(!dds[2].querySelector('.v271-db-help'))dds[2].insertAdjacentHTML('beforeend','<small class="v271-db-help">正常＝SQLite数据库可以正常读取和写入。</small>');}
  }
  async function clarifyShopSettings(){
    const panel=byId('shopSettingsPanel');if(!panel||panel.dataset.v271Ready==='1')return;panel.dataset.v271Ready='1';panel.classList.add('v271-shop-panel');
    const title=panel.querySelector('.panel-title h3');if(title)title.textContent='门店CP码与门店名称配置';
    panel.querySelector('.panel-title')?.insertAdjacentHTML('afterend','<p class="v271-shop-help">用途：识别轨迹中的“门店途中 / 门店入库 / 门店滞留”和正确门店名称。<b>不会改变CE、CEAF、TBKH、ALI1688、SHOPEE CN/VN、WHPP的日报业务归属。</b></p>');
    const buttons=[...panel.querySelectorAll('button')];if(buttons[0])buttons[0].textContent='选择门店CP码Excel';if(buttons[1])buttons[1].textContent='导入并立即启用';
    const file=byId('shopCodeFileName');const status=byId('shopCodeSettingStatus');const actions=document.createElement('div');actions.className='v271-shop-actions';buttons.forEach(b=>actions.appendChild(b));if(file)actions.insertBefore(file,actions.lastChild);panel.querySelector('.panel-title')?.parentNode?.insertBefore(actions,status||null);
    if(status)status.innerHTML='<div class="v271-shop-stats"><div class="v271-shop-stat"><span>当前有效门店码</span><b>读取中…</b></div></div>';
    panel.insertAdjacentHTML('beforeend','<div class="v271-shop-rule"><strong>分类保护：</strong> 管理员上传名单立即用于以后扫描/轨迹的门店匹配；同一CP码出现两个不同门店名称会直接阻止导入。日报七业务分类独立锁定：强业务规则优先，无法分类或七板块合计不守恒时整份日报拒绝入库。</div>');
    try{const boot=await api('/api/bootstrap');const s=boot?.state?.shopCodes||{};if(status)status.innerHTML=`<div class="v271-shop-stats"><div class="v271-shop-stat"><span>当前有效门店码</span><b>${fmt(s.count||0)}</b></div><div class="v271-shop-stat"><span>管理员上传</span><b>${fmt(s.userUploadedCount||0)}</b></div><div class="v271-shop-stat"><span>内置基准</span><b>${fmt(s.builtinCount||0)}</b></div><div class="v271-shop-stat"><span>新名单生效</span><b>${s.authority==='ADMIN_UPLOAD_OVERRIDES_BUILTIN'?'立即生效':'已启用'}</b></div></div><small class="v271-db-help">最近更新：${esc(s.latestUserUpdateAt||'尚无管理员上传记录')} · 新日报无需重新配置CP码。</small>`;}catch(e){if(status)status.textContent=`门店码状态读取失败：${e.message||e}`;}
  }
  function wrap(name,after){const fn=global[name];if(typeof fn!=='function'||fn.__v271Wrapped)return;const w=async function(){const out=await fn.apply(this,arguments);try{await after();}catch(e){console.warn('[V271]',name,e);}return out;};w.__v271Wrapped=true;global[name]=w;}

  installStyle();
  if(originalRenderBusiness)global.DashboardV18.renderBusiness=function(root,model){const out=originalRenderBusiness(root,model);void refreshBusiness(root,model,true);return out;};
  if(originalRenderHome)global.DashboardV18.renderHome=function(root,model){const out=originalRenderHome(root,model);void refreshHome(root,model);return out;};
  wrap('loadDataManagement',clarifyDataManagement);wrap('renderCcslOperations',clarifyShopSettings);wrap('renderAll',async()=>{clarifyDataManagement();await clarifyShopSettings();});
  setTimeout(()=>{clarifyDataManagement();void clarifyShopSettings();try{global.renderAll?.();}catch{}},80);
  global.__CE_QC_V271_CANONICAL_INTEGRITY__={id:ID,refreshActive(){try{global.renderAll?.();}catch{}}};
  console.info('[CE-QC][V271_CANONICAL_INTEGRITY]',ID,'Chinese status clarity + authoritative shop-code configuration + exact seven-business classification guard + one dashboard trend owner installed.');
})(window);
