(function v203DashboardIntegrity(global){
  'use strict';
  if(global.__CE_QC_V203_DASHBOARD_INTEGRITY__)return;
  global.__CE_QC_V203_DASHBOARD_INTEGRITY__='2026-08-18-v203-dashboard-integrity-ui-v1';

  const TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
  const LABELS={CE:'CE',CEAF:'CEAF空运',TBKH:'TBKH',ALI1688:'ALI1688',SHOPEECN:'SHOPEE CN',SHOPEEVN:'SHOPEE VN',WHPP:'WHPP本土'};
  const RETIRED_TITLES=new Set(['实时状态分布','今日核心指标复核','盘点节点分布','收件省份 / 末端地点','收件省份/末端地点']);
  const q=(sel,root=document)=>root.querySelector(sel);
  const qa=(sel,root=document)=>[...root.querySelectorAll(sel)];
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let attemptKey='',attemptBusy=false,networkLoadedAt=0,auditBusy=false;

  function installStyle(){
    if(q('#v203IntegrityStyle'))return;
    const style=document.createElement('style');style.id='v203IntegrityStyle';style.textContent=`
      .v203-retired-panel{display:none!important}.v203-attempt-panel{margin:14px 0}.v203-attempt-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}.v203-attempt-head h3{margin:0;color:#123f6b}.v203-attempt-head p{margin:5px 0 0;color:#7186a0;font-size:13px}.v203-attempt-grid{display:grid;grid-template-columns:repeat(7,minmax(130px,1fr));gap:10px}.v203-attempt-card{border:1px solid #dbe7f4;border-radius:10px;padding:12px;background:#fff}.v203-attempt-card small{display:block;color:#7186a0}.v203-attempt-card b{display:block;margin-top:5px;font-size:24px;color:#0d4f87}.v203-attempt-card span{display:block;margin-top:3px;color:#52708f;font-size:12px}.v203-attempt-rule{margin-top:10px;padding:9px 11px;border-radius:8px;background:#f4f8fd;color:#536f8f;font-size:12px;line-height:1.55}.v203-attempt-rule strong{color:#173f69}.v203-track-audit{margin-top:10px;border:1px solid #dce8f5;border-radius:8px;background:#f8fbff;padding:10px;color:#536f8f;font-size:12px;line-height:1.55}.v203-audit-table{overflow:auto;max-height:260px;margin-top:8px}.v203-audit-table table{width:100%;border-collapse:collapse;min-width:780px}.v203-audit-table th,.v203-audit-table td{padding:6px 8px;border-bottom:1px solid #e5edf6;text-align:left;white-space:nowrap}.v203-network{margin-top:14px}.v203-network-grid{display:grid;grid-template-columns:repeat(3,minmax(180px,1fr));gap:10px}.v203-network-card{border:1px solid #dce8f5;border-radius:9px;padding:12px;background:#fff}.v203-network-card small{display:block;color:#7186a0}.v203-network-card b{display:block;margin-top:5px;color:#143f69;word-break:break-all}.v203-good{color:#238451!important}.v203-warn{color:#b86a00!important}.v203-bad{color:#b43c36!important}@media(max-width:1300px){.v203-attempt-grid{grid-template-columns:repeat(4,1fr)}.v203-network-grid{grid-template-columns:1fr}}`;
    document.head.appendChild(style);
  }
  async function api(url,opts={}){
    const res=await fetch(url,{credentials:'same-origin',...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});let data={};try{data=await res.json();}catch{}if(!res.ok||data.ok===false)throw new Error(data.error||`HTTP ${res.status}`);return data;
  }
  function visible(el){return Boolean(el&&!el.hidden&&getComputedStyle(el).display!=='none');}
  function normalizedTitle(text=''){return String(text||'').replace(/\s+/g,' ').trim();}
  function retireLowValuePanels(){
    qa('h1,h2,h3,.pixel-panel-title,.panel-title').forEach(node=>{
      const title=normalizedTitle(node.textContent||'');
      const matched=[...RETIRED_TITLES].some(item=>title===item||title.startsWith(`${item} `));
      if(!matched)return;
      const panel=node.closest('article.pixel-panel,article.panel,section.panel,.pixel-panel,.dashboard-panel');
      if(panel&&!panel.classList.contains('v203-attempt-panel'))panel.classList.add('v203-retired-panel');
    });
  }
  function trackBusinessOptions(){return TYPES.map(type=>`<option value="${type}">${LABELS[type]}</option>`).join('');}
  function upgradeManualQuery(){
    const select=q('#trackBusiness');if(select&&select.dataset.v203!=='1'){
      const old=String(select.value||'').toUpperCase();select.innerHTML=trackBusinessOptions();
      if(TYPES.includes(old))select.value=old;else if(old==='SHOPEE')select.value='SHOPEECN';else select.value='CE';
      select.dataset.v203='1';select.setAttribute('aria-label','精确业务板块');
      const label=select.closest('label');if(label){const text=[...label.childNodes].find(n=>n.nodeType===Node.TEXT_NODE);if(text)text.nodeValue='精确业务板块 ';}
    }
    const panel=q('.manual-query-panel .track-query-panel');if(panel&&!q('#v203TrackAudit',panel)){
      const box=document.createElement('div');box.id='v203TrackAudit';box.className='v203-track-audit';box.innerHTML='<b>完整性核查</b><div>每次临时查询完成后，查询结果会自动写入“手动查询证据池”；即使该单号不在日报会员清单，也会进入后续明细/导出，不再凭空消失。</div><button id="v203AuditNow" class="btn ghost compact" type="button" style="margin-top:8px">核查当前输入单号</button><div id="v203AuditResult"></div>';
      panel.appendChild(box);q('#v203AuditNow').onclick=auditCurrentCodes;
    }
    if(typeof global.queryTrackNow==='function'&&!global.queryTrackNow.__v203Wrapped){
      const original=global.queryTrackNow;
      const wrapped=async function(...args){const result=await original.apply(this,args);setTimeout(()=>auditCurrentCodes(true),600);return result;};
      wrapped.__v203Wrapped=true;wrapped.__v203Original=original;global.queryTrackNow=wrapped;
    }
  }
  function currentCodes(){return [...new Set(String(q('#trackCodes')?.value||'').split(/[\n,，\s]+/).map(x=>x.trim().toUpperCase()).filter(Boolean))].slice(0,200);}
  async function auditCurrentCodes(silent=false){
    if(auditBusy)return;const bills=currentCodes();const root=q('#v203AuditResult');if(!bills.length){if(root&&!silent)root.innerHTML='<div style="margin-top:6px">请先输入运单号。</div>';return;}
    auditBusy=true;if(root)root.innerHTML='<div style="margin-top:6px">正在核查数据库归属与手动查询证据…</div>';
    try{
      const data=await api('/api/v203/waybill-audit',{method:'POST',body:JSON.stringify({shipmentCodes:bills})});
      if(!root)return;
      root.innerHTML=`<div class="v203-audit-table"><table><thead><tr><th>运单号</th><th>日报成员</th><th>手动证据</th><th>当前/轨迹数据</th><th>最近记录</th></tr></thead><tbody>${(data.rows||[]).map(row=>`<tr><td>${esc(row.shipmentCode)}</td><td>${row.dailyMembership?'是':'否'}</td><td>${row.manualEvidence?'<b class="v203-good">已保存</b>':'未保存'}</td><td>${esc((row.foundIn||[]).join(' / ')||'无')}</td><td>${esc(row.latest?.lastEventTime||row.latest?.reportDate||'—')}</td></tr>`).join('')}</tbody></table></div>`;
    }catch(error){if(root)root.innerHTML=`<div class="v203-bad" style="margin-top:6px">核查失败：${esc(error.message)}</div>`;}finally{auditBusy=false;}
  }
  function getAttemptContext(){
    const home=q('#homePage');const shopee=q('#shopeePage');const path=location.pathname.toLowerCase();
    if(visible(home))return{root:home,type:'ALL',title:'SHOPEE CN + VN 真实1/2/3派 POD'};
    if(visible(shopee)){
      if(path.includes('shopeecn'))return{root:shopee,type:'SHOPEECN',title:'SHOPEE CN 真实1/2/3派 POD'};
      if(path.includes('shopeevn'))return{root:shopee,type:'SHOPEEVN',title:'SHOPEE VN 真实1/2/3派 POD'};
      const text=(q('#pageTitle')?.textContent||'').toUpperCase();if(text.includes('CN'))return{root:shopee,type:'SHOPEECN',title:'SHOPEE CN 真实1/2/3派 POD'};if(text.includes('VN'))return{root:shopee,type:'SHOPEEVN',title:'SHOPEE VN 真实1/2/3派 POD'};
      return{root:shopee,type:'ALL',title:'SHOPEE CN + VN 真实1/2/3派 POD'};
    }
    return null;
  }
  function rangeForAttempt(){
    const from=q('#dashboardRangeFrom')?.value||q('#topRangeFrom')?.value||'';
    const to=q('#dashboardRangeTo')?.value||q('#topRangeTo')?.value||from;
    return{from,to};
  }
  function ensureAttemptPanel(ctx){
    let panel=q('#v203AttemptPanel');
    if(panel&&panel.closest('.app-page')!==ctx.root){panel.remove();panel=null;}
    if(!panel){
      panel=document.createElement('section');panel.id='v203AttemptPanel';panel.className='panel v203-attempt-panel';
      const anchor=q('#homeTrendGrid',ctx.root)||q('#shopeeRecipientTrends',ctx.root)||q('#shopeeTrendGrid',ctx.root)||ctx.root.firstElementChild;
      if(anchor?.parentNode)anchor.parentNode.insertBefore(panel,anchor);else ctx.root.appendChild(panel);
    }
    return panel;
  }
  function attemptCard(label,count,rate,sub=''){return `<div class="v203-attempt-card"><small>${esc(label)}</small><b>${Number(count||0).toLocaleString('zh-CN')}</b><span>${rate===null?esc(sub):`${Number(rate||0).toFixed(2)}%${sub?` · ${esc(sub)}`:''}`}</span></div>`;}
  async function renderAttemptPanel(force=false){
    const ctx=getAttemptContext();if(!ctx)return;
    const range=rangeForAttempt();const key=`${ctx.type}|${range.from}|${range.to}|${location.pathname}`;
    const panel=ensureAttemptPanel(ctx);if(!force&&key===attemptKey&&panel.dataset.loaded==='1')return;if(attemptBusy)return;attemptBusy=true;attemptKey=key;
    panel.innerHTML=`<div class="v203-attempt-head"><div><h3>${esc(ctx.title)}</h3><p>只按真实派送周期计算，不再用“经过几天”猜1派/2派/3派</p></div><span class="status-pill muted">正在计算…</span></div>`;
    try{
      const params=new URLSearchParams({businessType:ctx.type});if(range.from)params.set('fromDate',range.from);if(range.to)params.set('toDate',range.to);
      const data=await api(`/api/v203/attempt-summary?${params.toString()}`);const s=data.combined||{};
      panel.innerHTML=`<div class="v203-attempt-head"><div><h3>${esc(ctx.title)}</h3><p>${esc(data.range?.from||'')} 至 ${esc(data.range?.to||'')} · 派次分母=POD票数</p></div><span class="status-pill">真实周期口径</span></div><div class="v203-attempt-grid">${attemptCard('POD总数',s.pod,null,'派次统计分母')}${attemptCard('1派POD',s.a1,s.a1Rate)}${attemptCard('2派POD',s.a2,s.a2Rate)}${attemptCard('3派+ POD',s.a3,s.a3Rate)}${attemptCard('派次证据不足',s.attemptUnknown,s.unknownRate,'不强行归1派')}${attemptCard('平均签收天数',s.averageDays,null,`${Number(s.averageSamples||0).toLocaleString('zh-CN')}票有效样本`)}${attemptCard('手动查询补录',s.manualEvidenceRows,null,'只补明细，不污染日报KPI')}</div><div class="v203-attempt-rule"><strong>1/2/3派：</strong>${esc(data.rule?.attempt||'')}<br><strong>平均签收：</strong>${esc(data.rule?.average||'')}<br><strong>对账：</strong>1派 + 2派 + 3派+ + 派次证据不足 = POD总数。</div>`;
      panel.dataset.loaded='1';
    }catch(error){panel.innerHTML=`<div class="v203-attempt-head"><div><h3>${esc(ctx.title)}</h3><p class="v203-bad">读取失败：${esc(error.message)}</p></div><button id="v203AttemptRetry" class="btn ghost compact">重试</button></div>`;q('#v203AttemptRetry',panel)?.addEventListener('click',()=>renderAttemptPanel(true));}
    finally{attemptBusy=false;}
  }
  async function renderNetwork(){
    const page=q('#settingsPage')||q('#settings');if(!page)return;
    let panel=q('#v203NetworkPanel');if(!panel){panel=document.createElement('section');panel.id='v203NetworkPanel';panel.className='panel v203-network';panel.innerHTML='<div class="panel-title"><div><h3>局域网 / 外网访问状态</h3><p>同一套系统同时支持本机、局域网和公网入口</p></div><button id="v203NetworkRefresh" class="btn ghost compact">刷新</button></div><div id="v203NetworkBody">正在读取…</div>';page.appendChild(panel);q('#v203NetworkRefresh').onclick=()=>renderNetwork(true);}
    if(arguments[0]!==true&&Date.now()-networkLoadedAt<30000)return;networkLoadedAt=Date.now();const body=q('#v203NetworkBody');
    try{
      const data=await api('/api/v203/network-access');const lan=data.bind||{},pub=data.public||{};const lanUrls=(lan.lanUrls||[]).join(' / ')||'未检测到局域网IPv4';
      body.innerHTML=`<div class="v203-network-grid"><div class="v203-network-card"><small>本机访问</small><b class="v203-good">${esc(lan.localUrl||'—')}</b></div><div class="v203-network-card"><small>局域网访问</small><b class="${lan.lanEnabled?'v203-good':'v203-bad'}">${esc(lanUrls)}</b><span>${lan.lanEnabled?'已监听 0.0.0.0，可供同局域网电脑访问':'当前未开启局域网监听'}</span></div><div class="v203-network-card"><small>公网访问</small><b class="${pub.applicationReady?'v203-good':'v203-warn'}">${esc(pub.origin||pub.hostname||'尚未配置域名')}</b><span>${pub.applicationReady?'应用认证配置已就绪；仍需运行Tunnel/反向代理':'需要配置公网域名 + Cloudflare Access（或明确开启Direct）'}</span></div></div><div class="v203-attempt-rule"><strong>安全边界：</strong>${esc(pub.security||'')}<br><strong>说明：</strong>局域网只需要本机服务监听与Windows防火墙放行端口；公网还必须有Cloudflare Tunnel/反向代理实际把域名接到本机，代码不能凭空替代DNS和Tunnel授权。</div>`;
    }catch(error){body.innerHTML=`<div class="v203-bad">网络状态读取失败：${esc(error.message)}</div>`;}
  }
  function hookRangeButtons(){
    for(const id of ['dashboardRangeFrom','dashboardRangeTo','topRangeFrom','topRangeTo']){const input=q(`#${id}`);if(input&&input.dataset.v203!=='1'){input.dataset.v203='1';input.addEventListener('change',()=>{attemptKey='';setTimeout(()=>renderAttemptPanel(true),100);});}}
  }
  function tick(){installStyle();retireLowValuePanels();upgradeManualQuery();hookRangeButtons();renderAttemptPanel();renderNetwork();}
  function boot(){tick();const observer=new MutationObserver(()=>{clearTimeout(global.__v203IntegrityTick);global.__v203IntegrityTick=setTimeout(tick,100);});observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class']});setInterval(tick,5000);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);
