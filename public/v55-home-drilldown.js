(function installV55HomeDrilldown(global){
  const VERSION='2026-08-11-v55-home-drilldown-v1';
  const MAP={
    'Pending不连续':'pendingNonContinuous','Pending 3天+':'pending3','Pending3天+':'pending3','OC 1天+':'ocAll','OC1天+':'ocAll','OC 2天+':'oc2plus','OC2天+':'oc2plus',
    '门店滞留':'shopStuck','工单':'workOrderAbnormal','工单未处理':'workOrderAbnormal','入库无扫描节点':'inboundNoScan','盘点2天+':'cycle2','盘点 2天+':'cycle2',
    '今日POD':'podClosed','POD率':'podClosed','首次妥投率':'podClosed','外省未完结POD件':'provinceOpen','580滞留包裹':'ccsl580Retention','CCSLCN分流':'ccslCnDiversion','CCSLZT分流':'ccslZtDiversion','金边门店':'phnomPenhShop','外省门店':'provinceShop'
  };
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const labelOf=card=>String(card?.querySelector('.v18-metric-label')?.textContent||card?.querySelector('.metric-label')?.textContent||card?.querySelector('span')?.textContent||card?.querySelector('h3')?.textContent||'').trim();
  function dates(){const from=document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||'';const to=document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||from;return{from:from||to,to:to||from};}
  function host(){
    let node=document.getElementById('v55HomeDetailPanel');if(node)return node;
    const page=document.getElementById('homePage');if(!page)return null;
    node=document.createElement('section');node.id='v55HomeDetailPanel';node.className='panel v27-detail-panel';node.style.marginTop='16px';page.appendChild(node);return node;
  }
  function cols(rows){const keys=['shipmentCode','businessType','reportDate','regionCode','物理位置','当前分类','POD状态','Pending次数','OC天数','盘点天数','最新节点'];return keys.filter(k=>rows.some(r=>r?.[k]!==undefined));}
  async function open(tab,label){
    const r=dates(),panel=host();if(!r.to||!panel)return;
    panel.innerHTML=`<div class="v27-loading"><b>正在读取 ${esc(label)} 明细…</b></div>`;panel.scrollIntoView({behavior:'smooth',block:'start'});
    try{
      const q=new URLSearchParams({businessType:'CCSL',from:r.from,to:r.to,tab,page:'1',pageSize:'200'});const response=await fetch(`/api/v55/metric-detail?${q}`,{cache:'no-store',credentials:'same-origin'});const data=await response.json().catch(()=>({}));if(!response.ok||data.ok===false)throw new Error(data.error||`HTTP ${response.status}`);
      const rows=data.rows||[],c=cols(rows);panel.innerHTML=`<div class="v27-detail-head"><div><h3>${esc(label)}</h3><div class="v27-detail-meta">${esc(data.fromDate)} ～ ${esc(data.toDate)} · 共 ${Number(data.total||0).toLocaleString('zh-CN')} 票</div></div></div><div class="v27-detail-scroll">${rows.length?`<table class="v27-detail-table"><thead><tr>${c.map(k=>`<th>${esc(k==='shipmentCode'?'运单号':k)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${c.map(k=>`<td>${esc(row?.[k]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<div class="empty-state">该指标当前没有匹配的逐票数据</div>'}</div>`;
    }catch(error){panel.innerHTML=`<div class="empty-state">明细读取失败：${esc(error.message||error)}</div>`;}
  }
  global.addEventListener('click',event=>{
    if(!['/','/home'].includes(location.pathname.toLowerCase()))return;
    const card=event.target?.closest?.('.v18-metric-card,.core-metric-card,.metric-card');if(!card)return;
    const label=labelOf(card),tab=MAP[label];if(!tab)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();void open(tab,label);
  },true);
  console.info('[CE-QC][V55_HOME]',VERSION);
})(window);
