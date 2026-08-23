(function installV249WhppExactOwner(global){
  if(global.__CE_QC_V249_WHPP_EXACT_OWNER__)return;
  global.__CE_QC_V249_WHPP_EXACT_OWNER__=true;
  const VERSION='2026-08-23-v249-whpp-exact-drilldown-owner-v1';
  let repairTimer=null;
  let detailRequest=0;
  let handoffBusy=false;

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const numberFrom=value=>{const n=Number(String(value??'').replace(/[^0-9.\-]/g,''));return Number.isFinite(n)?n:0;};
  const isWhpp=()=>String(location.pathname||'').replace(/\/+$/,'')==='/whpp';
  const selectedDate=()=>{
    const value=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);
    if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
    try{
      const fallback=String(unifiedImportState?.reportDate||appState?.reportDate||shopeeState?.reportDate||'').slice(0,10);
      return /^\d{4}-\d{2}-\d{2}$/.test(fallback)?fallback:'';
    }catch{return '';}
  };

  function canonicalRoot(){const node=document.getElementById('whppFastPage');return node&&!node.hidden?node:null;}
  function fallbackRoot(){const node=document.getElementById('shopeePage');return isWhpp()&&node&&!node.hidden?node:null;}
  function visibleRoot(){return canonicalRoot()||fallbackRoot();}
  function labelOf(node){return String(node?.querySelector?.('span')?.textContent||node?.textContent||'').trim();}
  function findCard(root,label){return [...(root?.querySelectorAll?.('.v18-business-card,.v18-metric-card')||[])].find(node=>labelOf(node)===label)||null;}

  const LABEL_TAB=Object.freeze({
    'WHPP本土':'all','今日票数':'all','今日件数':'all',
    '今日POD':'pod','POD率':'pod','签收率':'pod','签收件数':'pod',
    '已退回件':'returned','退回率':'returned','退件率':'returned',
    '订单取消':'cancelled','取消率':'cancelled',
    '闭环率':'closed','已闭环':'closed',
    '当前未闭环':'unresolved',
    'Pending不连续':'pendingNonContinuous','Pending1+':'pending1','Pending2+':'pending2','Pending3+':'pending3',
    'OC1+':'oc1','OC2+':'oc2','OC3+':'oc3','盘点2天+':'cycle2','入库无扫描':'inboundNoScan',
    '派送中':'delivery','工单':'workOrder','CCSLCN':'ccslCnDiversion','CEZT':'ccslZtDiversion',
    'CCSL580':'ccsl580Retention','580滞留包裹':'ccsl580Retention','金边门店':'phnomPenhShop','外省门店':'provinceShop'
  });

  function tabOf(node){return String(node?.dataset?.whppTab||LABEL_TAB[labelOf(node)]||'');}
  function regionOf(node){return String(node?.dataset?.whppRegion||node?.closest?.('[data-region]')?.dataset?.region||'').toUpperCase();}

  async function json(url){
    const response=await fetch(url,{cache:'no-store',credentials:'same-origin'});
    const text=await response.text();let payload={};try{payload=text?JSON.parse(text):{};}catch{}
    if(!response.ok||payload?.ok===false)throw new Error(payload?.error||payload?.message||`HTTP ${response.status}`);
    return payload;
  }
  async function fetchAllTab(tab,region=''){
    const date=selectedDate();
    const base=new URLSearchParams({reportDate:date,tab,region:region||'',page:'1',pageSize:'300'});
    const first=await json(`/api/v172/whpp-metric-detail?${base}`);
    const total=Math.max(0,Number(first.total||0));
    const rows=[...(Array.isArray(first.rows)?first.rows:[])];
    const pages=Math.ceil(total/300);
    if(pages>1){
      const requests=[];
      for(let page=2;page<=pages;page+=1){const params=new URLSearchParams(base);params.set('page',String(page));requests.push(json(`/api/v172/whpp-metric-detail?${params}`));}
      const extra=await Promise.all(requests);
      for(const payload of extra)rows.push(...(Array.isArray(payload.rows)?payload.rows:[]));
    }
    return {...first,total,rows};
  }
  async function detailPayload(tab,region=''){
    if(tab!=='closed')return fetchAllTab(tab,region);
    const parts=await Promise.all(['pod','returned','cancelled'].map(value=>fetchAllTab(value,region)));
    const unique=new Map();
    for(const part of parts)for(const row of part.rows||[]){const code=String(row?.shipmentCode||row?.运单号||row?.waybill||'').trim().toUpperCase();if(code)unique.set(code,row);}
    return {ok:true,businessType:'WHPP',reportDate:selectedDate(),tab:'closed',region,label:`${region==='PP'?'本省PP · ':region==='PV'?'外省PV · ':''}已闭环（POD + 已退回 + 订单取消）`,total:unique.size,rows:[...unique.values()]};
  }
  function normalizeRow(row={}){
    const state=String(row.currentState||row.当前状态||'');
    const isPod=row.POD状态||row.是否POD==='是'||state.toUpperCase()==='POD';
    return {
      运单号:row.shipmentCode||row.运单号||row.waybill||'—',
      区域:row.regionCode||row.区域||'—',
      当前状态:state||row.primaryCategory||row.主分类||'—',
      当前分类:row.primaryCategory||row.主分类||row.异常分类||'—',
      POD状态:typeof isPod==='string'?isPod:(isPod?'POD':'未POD'),
      退回状态:row.退回状态||(/RETURN/i.test(state)?'已退回':'—'),
      Pending次数:row.Pending当前次数??row.Pending次数??row.pendingDistinctDayCount??'—',
      OC天数:row.OC天数??row.ocDays??'—',
      最新节点:row.latestEventDesc||row.lastEventDesc||row.最后节点||row.latestNode||'—',
      最新时间:row.latestEventTime||row.lastEventTime||row.最后节点时间||'—'
    };
  }
  function detailHost(root){
    let host=root?.querySelector?.('#whppV132Detail,#whppPreviewPanel,.v249-whpp-detail-host');
    if(host)return host;
    host=document.createElement('section');host.className='panel v18-detail-preview v249-whpp-detail-host';host.setAttribute('aria-live','polite');root?.appendChild(host);return host;
  }
  async function openDetail(tab,region='',label=''){
    const root=visibleRoot();if(!root||!tab)return;
    const host=detailHost(root);if(!host)return;
    const request=++detailRequest;host.hidden=false;host.innerHTML=`<div class="empty-state">正在读取 ${esc(label||tab)} 逐票明细…</div>`;host.scrollIntoView({behavior:'smooth',block:'start'});
    try{
      const payload=await detailPayload(tab,region);if(request!==detailRequest)return;
      const rows=(payload.rows||[]).map(normalizeRow);
      const fields=['运单号','区域','当前状态','当前分类','POD状态','退回状态','Pending次数','OC天数','最新节点','最新时间'];
      host.innerHTML=`<div class="panel-title"><h3>${esc(payload.label||label||tab)}</h3><span>${fmt(payload.total)}票</span></div><div class="preview-table-wrap">${rows.length?`<table class="preview-table"><thead><tr>${fields.map(field=>`<th>${field}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${fields.map(field=>`<td>${esc(row[field]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<div class="empty-state">该指标当前没有匹配明细</div>'}</div>`;
      host.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(error){if(request===detailRequest)host.innerHTML=`<div class="empty-state">明细读取失败：${esc(error.message||error)}</div>`;}
  }

  function ensureClosureCard(root){
    const grid=root?.querySelector?.('.v18-business-grid');if(!grid)return;
    const total=numberFrom(findCard(root,'WHPP本土')?.querySelector('b')?.textContent);
    const pod=numberFrom(findCard(root,'今日POD')?.querySelector('b')?.textContent);
    const returned=numberFrom(findCard(root,'已退回件')?.querySelector('b')?.textContent);
    const cancelled=numberFrom(findCard(root,'订单取消')?.querySelector('b')?.textContent);
    if(total<0)return;
    const closed=Math.max(0,Math.min(total,pod+returned+cancelled));
    const rate=total?closed*100/total:0;
    let card=findCard(root,'闭环率');
    if(!card||card.tagName!=='BUTTON'){
      const button=document.createElement('button');button.className='v18-business-card green v249-whpp-closure-card';
      if(card)card.replaceWith(button);else grid.appendChild(button);card=button;
    }
    const desired=`<span>闭环率</span><small>当前比率</small><b>${rate.toFixed(2).replace(/\.00$/,'')}%</b><em>已闭环 ${fmt(closed)} / 总票 ${fmt(total)}</em>`;
    card.dataset.whppTab='closed';if(card.innerHTML!==desired)card.innerHTML=desired;
  }
  function markClickable(root){
    root?.querySelectorAll?.('[data-whpp-tab],.v18-business-card,.v18-metric-card,.region-block button').forEach(node=>{
      if(tabOf(node)){node.style.cursor='pointer';node.title='点击查看对应逐票明细';node.dataset.v249WhppDetail='1';}
    });
  }
  async function ensureCanonical(){
    if(!isWhpp())return;
    const owner=global.__CE_QC_V132_WHPP_FAST__;
    const canonical=document.getElementById('whppFastPage');
    const fallback=fallbackRoot();
    const fallbackText=String(fallback?.textContent||'');
    // V249 stale fallback markers: WHPP页面已切换完成|区域\/趋势数据正在后台更新
    const needsHandoff=Boolean(owner?.navigate)&&(!canonical||canonical.hidden||/WHPP页面已切换完成|区域\/趋势数据正在后台更新/.test(fallbackText));
    if(needsHandoff&&!handoffBusy){
      handoffBusy=true;
      try{await owner.navigate(false);}catch(error){console.warn('[CE-QC][V249_WHPP] canonical handoff skipped',error);}finally{handoffBusy=false;}
    }
    const root=visibleRoot();if(root){ensureClosureCard(root);markClickable(root);root.dataset.v249WhppOwner=VERSION;}
  }
  function schedule(ms=40){clearTimeout(repairTimer);repairTimer=setTimeout(()=>void ensureCanonical(),ms);}

  global.addEventListener('click',event=>{
    if(!isWhpp())return;
    const root=visibleRoot();if(!root)return;
    const card=event.target?.closest?.('[data-whpp-tab],.v18-business-card,.v18-metric-card,.region-block button');
    if(!card||!root.contains(card))return;
    const tab=tabOf(card);if(!tab)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    void openDetail(tab,regionOf(card),labelOf(card));
  },true);
  global.addEventListener('popstate',()=>schedule(30));
  document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(80);},true);
  const observer=new MutationObserver(()=>{if(isWhpp())schedule(35);});
  const start=()=>{observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class']});schedule(10);[80,250,700,1500].forEach(ms=>setTimeout(()=>schedule(0),ms));};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();

  global.__CE_QC_V249_WHPP_EXACT_OWNER__={version:VERSION,openDetail,ensureCanonical,tabForLabel:label=>LABEL_TAB[String(label||'')]||''};
  console.info('[CE-QC][V249_WHPP_DETAIL_UI]',VERSION,'WHPP canonical page handoff + exact V172 drilldown + closure arithmetic enabled');
})(window);
