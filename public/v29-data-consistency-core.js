(function installV30DataConsistencyFix(global){
  if(new URLSearchParams(location.search).has('visualTest'))return;
  let detailContext=null;

  function esc(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
  function fmt(value){return Number(value||0).toLocaleString('zh-CN');}
  function exactType(type){
    const raw=String(type||'').toUpperCase();
    if(raw==='HOME')return 'CCSL';
    if(raw==='SHOPEE'){
      try{return shopeeRecipientGroup==='CN'?'SHOPEECN':shopeeRecipientGroup==='VN'?'SHOPEEVN':'SHOPEE';}catch{return 'SHOPEE';}
    }
    return raw||'CCSL';
  }
  function currentRange(){
    try{if(typeof dashboardPeriodRange!=='undefined'&&dashboardPeriodRange?.fromDate&&dashboardPeriodRange?.toDate)return{from:dashboardPeriodRange.fromDate,to:dashboardPeriodRange.toDate};}catch{}
    const from=document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value;
    const to=document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value;
    if(from&&to&&from<=to)return{from,to};
    let date='';try{date=historyModeDate||unifiedImportState?.reportDate||appState?.reportDate||shopeeState?.reportDate||'';}catch{}
    return{from:date,to:date};
  }
  function currentSnapshotId(){
    try{
      return String(
        unifiedImportState?.snapshotId||unifiedImportState?.currentSnapshotId||
        appState?.snapshotId||appState?.currentSnapshotId||
        shopeeState?.snapshotId||shopeeState?.currentSnapshotId||''
      ).trim();
    }catch{return '';}
  }
  function tabFor(label,metricKey,type){
    const shopee=String(type||'').startsWith('SHOPEE');
    const text=String(label||'').trim();
    const key=String(metricKey||'').trim();
    const ccsl={
      'Pending1+':'pending1','Pending2+':'pending2plus','Pending3+':'pending3','Pending不连续':'pendingNonContinuous',
      'OC1+':'oc1','OC2+':'oc2plus','OC3+':'oc3','签收件数':'podClosed','今日POD':'podClosed','POD率':'podClosed',
      '已退回件':'accountingReturned','退回件':'accountingReturned','退回率':'accountingReturned','当前未闭环':'accountingOpen','未闭环':'accountingOpen',
      '入库无扫描':'inboundNoScan','入库无扫描节点':'inboundNoScan','工单未处理':'workOrderAbnormal','工单':'workOrderAbnormal',
      '严重异常':'severeAbnormal','盘点2天+':'cycle2','外省未完结POD件':'provinceOpen','门店滞留':'shopStuck','门店途中':'shopTransit','门店入库':'shopArrived',
      'CECN滞留包裹':'cecnRetention','CEZT滞留包裹':'ceztRetention','580滞留包裹':'ccsl580Retention','派送中':'deliveryAll'
    };
    const shop={
      'Pending1+':'pending1','Pending2+':'pending2','Pending3+':'pending3','Pending不连续':'pendingNonContinuous',
      'OC1+':'oc1','OC2+':'oc2','OC3+':'oc3','签收件数':'pod','今日POD':'pod','POD率':'pod',
      '已退回件':'returned','退回件':'returned','退回率':'returned','当前未闭环':'unresolved','未闭环':'unresolved',
      '入库无扫描':'inboundNoScan','入库无扫描节点':'inboundNoScan','盘点2天+':'cycle2','外省未完结POD件':'provinceOpen',
      '派送中':'deliveryStay','外省派送中':'pvDelivery','外省门店滞留':'pvStoreRetention','外省门店入库无节点':'pvStoreInboundNoScan','外省其他未闭环':'pvOtherUnresolved'
    };
    const direct=(shopee?shop:ccsl)[text];
    if(direct)return direct;

    const aliases=shopee?{
      pending1:'pending1',pending2:'pending2',pending2plus:'pending2',pending3:'pending3',pendingNonContinuous:'pendingNonContinuous',
      oc1:'oc1',oc2:'oc2',oc2plus:'oc2',oc3:'oc3',cycle2:'cycle2',inboundNoScan:'inboundNoScan',returned:'returned',
      unresolved:'unresolved',deliveryStay:'deliveryStay',pvDelivery:'pvDelivery',pvStoreRetention:'pvStoreRetention',
      pvStoreInboundNoScan:'pvStoreInboundNoScan',pvOtherUnresolved:'pvOtherUnresolved',provinceOpen:'provinceOpen',podClosed:'pod',pod:'pod'
    }:{
      pending1:'pending1',pending2:'pending2plus',pending2plus:'pending2plus',pending3:'pending3',pendingNonContinuous:'pendingNonContinuous',
      oc1:'oc1',oc2:'oc2plus',oc2plus:'oc2plus',oc3:'oc3',cycle2:'cycle2',inboundNoScan:'inboundNoScan',
      workOrder:'workOrderAbnormal',workOrderAbnormal:'workOrderAbnormal',returned:'accountingReturned',accountingReturned:'accountingReturned',
      unresolved:'accountingOpen',accountingOpen:'accountingOpen',severe:'severeAbnormal',severeAbnormal:'severeAbnormal',provinceOpen:'provinceOpen',
      cecnRetention:'cecnRetention',ceztRetention:'ceztRetention',retention580:'ccsl580Retention',ccsl580Retention:'ccsl580Retention',
      shopTransit:'shopTransit',shopArrived:'shopArrived',shopStuck:'shopStuck',deliveryStay:'deliveryAll',deliveryAll:'deliveryAll',podClosed:'podClosed'
    };
    for(const [needle,target] of Object.entries(aliases)){
      if(key===needle||key.endsWith(`-${needle}`)||key.toLowerCase().includes(needle.toLowerCase()))return target;
    }
    return shopee?'all':'allData';
  }
  function panelFor(type){
    if(String(currentPage)==='home'){
      let panel=document.getElementById('v29HomeDetailPanel');
      if(!panel){panel=document.createElement('section');panel.id='v29HomeDetailPanel';panel.className='v18-panel v27-detail-panel';document.getElementById('homePage')?.appendChild(panel);}
      return panel;
    }
    return document.getElementById(String(type).startsWith('SHOPEE')?'shopeePreviewPanel':'ccslPreviewPanel');
  }
  function columns(rows){
    const preferred=['shipmentCode','businessType','reportDate','regionCode','recipient_raw','customerName','当前分类','POD状态','pendingDays','ocDays','最新节点','最新时间'];
    return preferred.filter(key=>rows.some(row=>row?.[key]!==undefined)).slice(0,12);
  }
  function name(key){return({shipmentCode:'运单号',businessType:'业务',reportDate:'日报日期',regionCode:'区域',recipient_raw:'收件人',customerName:'收件人',pendingDays:'Pending天数',ocDays:'OC天数'})[key]||key;}
  function render(panel,data,label){
    const rows=data.rows||[],cols=columns(rows),maxPage=Math.max(1,Math.ceil(Number(data.total||0)/Number(data.pageSize||200)));
    panel.innerHTML=`<div class="v27-detail-head"><div><h3>${esc(label||'指标明细')}</h3><div class="v27-detail-meta">${esc(data.fromDate)} ～ ${esc(data.toDate)} · 共 ${fmt(data.total)} 票 · 当前第 ${data.page}/${maxPage} 页</div></div></div><div class="v27-detail-scroll">${rows.length?`<table class="v27-detail-table"><thead><tr>${cols.map(k=>`<th>${esc(name(k))}</th>`).join('')}<th>操作</th></tr></thead><tbody>${rows.map(row=>`<tr>${cols.map(k=>`<td>${esc(row[k]??'—')}</td>`).join('')}<td><button class="text-button" data-v29row="${encodeURIComponent(JSON.stringify({shipmentCode:row.shipmentCode,businessType:row.businessType,reportDate:row.reportDate,region:row.regionCode,category:row.当前分类||''}))}" onclick="window.v27OpenTracking?.(this.dataset.v29row)">查看轨迹</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">该指标当前没有匹配的逐票数据</div>'}</div><div class="v27-detail-pager"><button ${data.page<=1?'disabled':''} onclick="window.v29DetailPage(${data.page-1})">上一页</button><button ${data.page>=maxPage?'disabled':''} onclick="window.v29DetailPage(${data.page+1})">下一页</button></div>`;
  }
  async function load(ctx,page=1){
    const panel=ctx.panel||panelFor(ctx.businessType);if(!panel)return;
    panel.classList.add('v27-detail-panel');panel.innerHTML=`<div class="v27-loading"><b>正在读取 ${esc(ctx.label)} 明细…</b></div>`;panel.scrollIntoView({behavior:'smooth',block:'start'});
    const range=currentRange();const params=new URLSearchParams({businessType:ctx.businessType,from:range.from,to:range.to,tab:ctx.tab,page:String(page),pageSize:'200'});
    if(ctx.region)params.set('region',ctx.region);if(ctx.attempt)params.set('attempt',String(ctx.attempt));
    const snapshotId=currentSnapshotId();if(snapshotId)params.set('snapshotId',snapshotId);
    try{const data=await api(`/api/v29/metric-detail?${params}`);detailContext={...ctx,page};render(panel,data,ctx.label);}catch(error){panel.innerHTML=`<div class="empty-state">明细读取失败：${esc(error.message)}</div>`;}
  }
  function open(type,metricKey,label,extra={}){const businessType=exactType(type);const tab=extra.tab||tabFor(label,metricKey,businessType);void load({businessType,tab,label:label||metricKey||'指标明细',region:extra.region||'',attempt:extra.attempt||0,panel:extra.panel||null},1);}
  global.v29DetailPage=page=>{if(detailContext)void load(detailContext,Math.max(1,page));};
  global.openV18MetricDetail=function(type,metricKey,label){open(type,metricKey,label);};
  try{openMetricDetail=function(type,tab){const businessType=exactType(type);open(businessType,tab,tab,{tab:tabFor(tab,tab,businessType)});};}catch{}
  global.__V29_DATA_CONSISTENCY_FIX__=true;
  global.__V30_METRIC_TAB_MAPPING__=true;
})(window);