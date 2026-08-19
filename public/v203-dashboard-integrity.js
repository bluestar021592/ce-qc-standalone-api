(function v221PassiveUtilities(global){
  'use strict';
  if(global.__CE_QC_V221_PASSIVE_UTILITIES__)return;
  global.__CE_QC_V221_PASSIVE_UTILITIES__='2026-08-19-v221-passive-utilities-v1';
  // Retired compatibility labels only; V221 deliberately does not recreate the old
  // 真实1/2/3派 POD / 派次证据不足 overlay or RETIRED_TITLES DOM-hiding loop.

  const TYPES=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
  const LABELS={CE:'CE',CEAF:'CEAF空运',TBKH:'TBKH',ALI1688:'ALI1688',SHOPEECN:'SHOPEE CN',SHOPEEVN:'SHOPEE VN',WHPP:'WHPP本土'};
  const q=(s,r=document)=>r.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let auditBusy=false;

  async function api(url,opts={}){
    const res=await fetch(url,{credentials:'same-origin',cache:'no-store',...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});
    let data={};try{data=await res.json();}catch{}
    if(!res.ok||data.ok===false)throw new Error(data.error||`HTTP ${res.status}`);
    return data;
  }

  function upgradeManualQuery(){
    const select=q('#trackBusiness');
    if(select&&select.dataset.v221!=='1'){
      const old=String(select.value||'').toUpperCase();
      select.innerHTML=TYPES.map(type=>`<option value="${type}">${LABELS[type]}</option>`).join('');
      select.value=TYPES.includes(old)?old:(old==='SHOPEE'?'SHOPEECN':'CE');
      select.dataset.v221='1';
    }
    const panel=q('.manual-query-panel .track-query-panel');
    if(panel&&!q('#v221TrackAudit',panel)){
      const box=document.createElement('div');
      box.id='v221TrackAudit';
      box.style.cssText='margin-top:10px;border:1px solid #dce8f5;border-radius:8px;background:#f8fbff;padding:10px;color:#536f8f;font-size:12px;line-height:1.55';
      box.innerHTML='<b>完整性核查</b><div>手动查询证据会保存到数据库；不在日报会员清单的单号只补证据，不污染日报KPI。</div><button id="v221AuditNow" class="btn ghost compact" type="button" style="margin-top:8px">核查当前输入单号</button><div id="v221AuditResult"></div>';
      panel.appendChild(box);
      q('#v221AuditNow',box)?.addEventListener('click',auditCurrentCodes);
    }
  }

  function currentCodes(){return [...new Set(String(q('#trackCodes')?.value||'').split(/[\n,，\s]+/).map(x=>x.trim().toUpperCase()).filter(Boolean))].slice(0,200);}
  async function auditCurrentCodes(){
    if(auditBusy)return;
    const bills=currentCodes(),root=q('#v221AuditResult');
    if(!bills.length){if(root)root.textContent='请先输入运单号。';return;}
    auditBusy=true;if(root)root.textContent='正在核查数据库归属与手动查询证据…';
    try{
      const data=await api('/api/v203/waybill-audit',{method:'POST',body:JSON.stringify({shipmentCodes:bills})});
      if(root)root.innerHTML=`<div style="margin-top:6px">已核查 ${Number(data.rows?.length||0)} 票；已保存手动证据 ${Number((data.rows||[]).filter(r=>r.manualEvidence).length).toLocaleString('zh-CN')} 票。</div>`;
    }catch(error){if(root)root.innerHTML=`<div style="margin-top:6px;color:#b43c36">核查失败：${esc(error.message)}</div>`;}
    finally{auditBusy=false;}
  }

  async function renderNetwork(force=false){
    const page=q('#settingsPage')||q('#settings');
    if(!page||page.hidden)return;
    let panel=q('#v221NetworkPanel');
    if(!panel){
      panel=document.createElement('section');panel.id='v221NetworkPanel';panel.className='panel';panel.style.marginTop='14px';
      panel.innerHTML='<div class="panel-title"><div><h3>局域网 / 外网访问状态</h3><p>本机、同一局域网和公网入口分开显示</p></div><button id="v221NetworkRefresh" class="btn ghost compact" type="button">刷新</button></div><div id="v221NetworkBody" style="padding:12px;color:#607995">正在读取…</div>';
      page.appendChild(panel);
      q('#v221NetworkRefresh',panel)?.addEventListener('click',()=>renderNetwork(true));
    }
    if(!force&&panel.dataset.loaded==='1')return;
    const body=q('#v221NetworkBody',panel);if(body)body.textContent='正在读取…';
    try{
      const data=await api('/api/v203/network-access');const lan=data.bind||{},pub=data.public||{};
      const lanUrls=(lan.lanUrls||[]).join(' / ')||'未检测到局域网IPv4';
      const publicText=pub.publicUrl||pub.quickUrl||'尚未配置公网入口';
      if(body)body.innerHTML=`<div style="display:grid;grid-template-columns:repeat(3,minmax(180px,1fr));gap:10px"><div><b>本机</b><div>${esc(lan.localUrl||'http://127.0.0.1:5177')}</div></div><div><b>局域网</b><div>${esc(lanUrls)}</div></div><div><b>不同网络 / 外地</b><div>${esc(publicText)}</div></div></div>`;
      panel.dataset.loaded='1';
    }catch(error){if(body)body.innerHTML=`<span style="color:#b43c36">网络状态读取失败：${esc(error.message)}</span>`;}
  }

  function refreshForCurrentPage(){upgradeManualQuery();renderNetwork(false);}
  function boot(){refreshForCurrentPage();}
  document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link,.top-user,[data-route]'))setTimeout(refreshForCurrentPage,80);},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);