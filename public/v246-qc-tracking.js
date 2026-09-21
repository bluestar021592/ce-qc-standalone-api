(function installV246QcTracking(global){
  if(global.__CE_QC_V246_TRACKING_UI__)return;
  global.__CE_QC_V246_TRACKING_UI__=true;
  const VERSION='2026-08-23-v246-qc-tracking-ui-v1';
  const V450_READONLY_SUMMARY_ID='2026-09-07-v450-tracking-summary-auto-read-v1';
  let pollTimer=null;
  let initialReadStarted=false;
  const TYPES=['ALL','CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
  const fmt=v=>Number(v||0).toLocaleString('zh-CN');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function khDate(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
  function addDays(key,days){const d=new Date(`${key}T12:00:00+07:00`);d.setDate(d.getDate()+days);return khDate(d);}
  async function api(url,options={}){const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});const t=await r.text();let j={};try{j=t?JSON.parse(t):{};}catch{}if(!r.ok||j.ok===false)throw new Error(j.error||j.message||`HTTP ${r.status}`);return j;}
  function ensureStyle(){if(document.getElementById('v246TrackingStyle'))return;const s=document.createElement('style');s.id='v246TrackingStyle';s.textContent=`
    #v246TrackingPanel{margin-top:16px;border:1px solid #d7e5f4;border-radius:12px;background:#fff;padding:16px}
    #v246TrackingPanel .v246-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
    #v246TrackingPanel h3{margin:0;color:#123a67;font-size:19px}#v246TrackingPanel p{margin:5px 0 0;color:#687f99;line-height:1.6;font-size:12px}
    .v246-badge{background:#edf5ff;color:#2366ce;border-radius:999px;padding:5px 9px;font-weight:700;font-size:11px;white-space:nowrap}
    .v246-controls{display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-top:14px}.v246-controls label{display:flex;flex-direction:column;gap:4px;color:#59718d;font-size:11px}
    .v246-controls select,.v246-controls input{height:34px;border:1px solid #cbdced;border-radius:7px;padding:0 9px;background:#fff;color:#17365d}
    .v246-btn{height:34px;border-radius:7px;border:1px solid #b8cde4;padding:0 12px;background:#fff;color:#24517f;font-weight:700;cursor:pointer}.v246-btn.primary{background:#1677ff;border-color:#1677ff;color:#fff}.v246-btn:disabled{opacity:.55;cursor:wait}
    .v246-grid{display:grid;grid-template-columns:repeat(6,minmax(110px,1fr));gap:9px;margin-top:14px}.v246-card{border:1px solid #e0eaf5;border-radius:9px;padding:10px 12px;background:#fbfdff}.v246-card span{display:block;color:#74879c;font-size:11px}.v246-card b{display:block;margin-top:4px;color:#123a67;font-size:21px}
    .v246-status{margin-top:12px;padding:10px 12px;border-radius:8px;background:#f5f9ff;color:#48647f;font-size:12px;line-height:1.65}.v246-status.ok{background:#ecfbf3;color:#087a45}.v246-status.warn{background:#fff7e6;color:#8a6200}.v246-status.danger{background:#fff1f1;color:#b42318}
    .v246-progress{height:7px;background:#edf3fa;border-radius:999px;overflow:hidden;margin-top:8px}.v246-progress i{display:block;height:100%;width:0;background:#1677ff;transition:width .2s}
    .v246-bill{display:flex;gap:8px;align-items:end;margin-top:14px;padding-top:12px;border-top:1px solid #e8eff7}.v246-bill label{flex:1;display:flex;flex-direction:column;gap:4px;color:#59718d;font-size:11px}.v246-bill input{height:34px;border:1px solid #cbdced;border-radius:7px;padding:0 9px;text-transform:uppercase}
    .v246-bill-result{margin-top:9px;font-size:12px;color:#506a86;line-height:1.7}.v246-audit{margin-top:6px;color:#7c6b36}
    @media(max-width:1300px){.v246-grid{grid-template-columns:repeat(3,minmax(110px,1fr))}}
  `;document.head.appendChild(s);}
  function host(){const reports=document.getElementById('reportsPage');if(!reports)return null;return document.getElementById('v183HistoryRefreshPanel')||reports.querySelector('.period-export-panel')||reports;}
  function ensurePanel(){let p=document.getElementById('v246TrackingPanel');if(p)return p;const h=host();if(!h)return null;ensureStyle();p=document.createElement('section');p.id='v246TrackingPanel';p.innerHTML=`
    <div class="v246-head"><div><h3>QC持续追踪 / 防漏票核查</h3><p>以第一次日报出现日期为锁定起点。只要没有真正POD、退回完成或取消，就继续追踪；580、自提、门店、正常分流只改变当前位置，不再提前结案。</p></div><span class="v246-badge">V246 · 锁定追踪</span></div>
    <div class="v246-controls">
      <label>业务<select id="v246Type">${TYPES.map(t=>`<option value="${t}">${t==='ALL'?'全部业务':t}</option>`).join('')}</select></label>
      <label>开始日期<input id="v246From" type="date"></label><label>结束日期<input id="v246To" type="date"></label>
      <button class="v246-btn" id="v2467" type="button">最近7天核查</button><button class="v246-btn" id="v24630" type="button">最近30天核查</button>
      <button class="v246-btn primary" id="v246Run" type="button">核查自定义区间</button><button class="v246-btn" id="v246Read" type="button">只读取账本</button>
    </div>
    <div class="v246-grid"><div class="v246-card"><span>追踪账本总票</span><b id="v246Total">—</b></div><div class="v246-card"><span>持续追踪中</span><b id="v246Open">—</b></div><div class="v246-card"><span>已POD</span><b id="v246Pod">—</b></div><div class="v246-card"><span>已退回</span><b id="v246Returned">—</b></div><div class="v246-card"><span>派次证据已识别</span><b id="v246Attempt">—</b></div><div class="v246-card"><span>派次未识别POD</span><b id="v246Unknown">—</b></div></div>
    <div class="v246-status" id="v246Status">正在读取已保存QC追踪账本；这里只读，不会自动启动扫描或轨迹核查。</div><div class="v246-progress"><i id="v246Progress"></i></div>
    <div class="v246-bill"><label>单号追踪诊断<input id="v246Bill" placeholder="例如 TBKH000803140"></label><button class="v246-btn" id="v246BillBtn" type="button">查看这票为什么漏/是否仍追踪</button></div><div class="v246-bill-result" id="v246BillResult"></div>`;
    h.insertAdjacentElement('afterend',p);
    const today=khDate();p.querySelector('#v246To').value=today;p.querySelector('#v246From').value=addDays(today,-29);
    p.querySelector('#v2467').onclick=()=>runPreset(7);p.querySelector('#v24630').onclick=()=>runPreset(30);p.querySelector('#v246Run').onclick=()=>start();p.querySelector('#v246Read').onclick=()=>read();p.querySelector('#v246BillBtn').onclick=()=>bill();
    return p;
  }
  function selection(){return{businessType:document.getElementById('v246Type')?.value||'ALL',fromDate:document.getElementById('v246From')?.value||'',toDate:document.getElementById('v246To')?.value||''};}
  function setBusy(v){document.querySelectorAll('#v246TrackingPanel button').forEach(b=>b.disabled=v);}
  function status(msg,tone=''){const n=document.getElementById('v246Status');if(n){n.className=`v246-status ${tone}`.trim();n.textContent=msg;}}
  function progress(v){const n=document.getElementById('v246Progress');if(n)n.style.width=`${Math.max(0,Math.min(100,Number(v||0)))}%`;}
  function show(s={}){const map={v246Total:s.total,v246Open:s.open,v246Pod:s.pod,v246Returned:s.returned,v246Attempt:s.attemptKnown,v246Unknown:s.attemptUnknown};for(const[id,v]of Object.entries(map)){const n=document.getElementById(id);if(n)n.textContent=v===undefined?'—':fmt(v);}}
  async function read(){ensurePanel();const q=new URLSearchParams(selection());setBusy(true);status('正在只读加载已保存QC追踪账本…');try{const d=await api(`/api/v246/tracking/summary?${q}`);show(d);status(`账本读取完成：${fmt(d.total)}票；仍需持续追踪${fmt(d.open)}票；POD ${fmt(d.pod)}票；派次仍未识别${fmt(d.attemptUnknown)}票。`,'ok');}catch(e){status(`读取失败：${e.message}`,'danger');}finally{setBusy(false);}}
  async function runPreset(days){const p=ensurePanel();const today=khDate();p.querySelector('#v246To').value=today;p.querySelector('#v246From').value=addDays(today,-(days-1));await start();}
  async function start(){ensurePanel();setBusy(true);progress(1);try{const d=await api('/api/v246/tracking/reconcile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(selection())});const id=d.job?.jobId;if(!id)throw new Error('未取得任务编号');status('已开始：先核对日报应有票数，再补回漏票，然后只刷新非终态，最后重建Shopee派次与平均签收天数。','warn');poll(id);}catch(e){setBusy(false);status(`启动失败：${e.message}`,'danger');}}
  async function poll(id){clearTimeout(pollTimer);try{const d=await api(`/api/v246/tracking/job/${encodeURIComponent(id)}`);const j=d.job||{};progress(j.progress);status(j.message||'处理中…',j.status==='FAILED'?'danger':'warn');if(j.status==='COMPLETED'){setBusy(false);show(j.after||j.result?.after||{});const r=j.result||{};status(`核查完成：非终态候选${fmt(r.candidates)}票，成功更新${fmt(r.refreshed)}票，待重试${fmt(r.failed)}票；防漏对账本次补回/重开${fmt(r.finalRepair?.repaired)}票。`,'ok');return;}if(j.status==='FAILED'){setBusy(false);return;}pollTimer=setTimeout(()=>poll(id),1800);}catch(e){setBusy(false);status(`任务读取失败：${e.message}`,'danger');}}
  async function bill(){const code=String(document.getElementById('v246Bill')?.value||'').trim().toUpperCase();if(!code)return;const out=document.getElementById('v246BillResult');out.textContent='正在读取…';try{const d=await api(`/api/v246/tracking/bill/${encodeURIComponent(code)}`);const l=d.ledger;if(!l){out.innerHTML=`<b>${esc(code)}</b>：当前追踪账本没有这票。请用上方7天/30天核查，系统会从原始日报重新枚举并自动补回。`;return;}const audits=(d.audits||[]).slice(0,5).map(a=>`${esc(a.createdAt)} · ${esc(a.action)} · ${esc(a.reason)}`).join('<br>');out.innerHTML=`<b>${esc(code)}</b> · ${esc(l.businessType)}<br>首次日报：<b>${esc(l.firstReportDate)}</b> · 最后出现在日报：${esc(l.lastImportedDate)} · 追踪状态：<b>${esc(l.trackingStatus)}</b> · 终态：${esc(l.terminalReason||'未终态')}<br>POD日期：${esc(l.podDate||'—')} · 派次：${l.attemptNo?`${l.attemptNo}派`:'未识别'} · 平均签收起算结果：${l.signingDays?`${l.signingDays}天`:'—'}<div class="v246-audit">${audits||'暂无修复审计记录'}</div>`;}catch(e){out.textContent=`读取失败：${e.message}`;}}
  function mount(){ensurePanel();if(!initialReadStarted){initialReadStarted=true;status('QC追踪账本已就绪；点击“只读取账本”时才查询，不再在每次打开系统时自动扫描。');}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  const observer=new MutationObserver(()=>ensurePanel());observer.observe(document.documentElement,{childList:true,subtree:true});
  global.__CE_QC_V246_TRACKING_READONLY_SUMMARY_ID__=V450_READONLY_SUMMARY_ID;
})(window);
