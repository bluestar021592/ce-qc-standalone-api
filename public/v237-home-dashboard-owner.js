(function installV237HomeDashboardOwner(global){
  if(global.__CE_QC_V237_HOME_DASHBOARD_OWNER__)return;
  global.__CE_QC_V237_HOME_DASHBOARD_OWNER__=true;
  const VERSION='2026-08-23-v247-home-ledger-truth-owner-v2';
  const REQUIRED=['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'];
  const cache=new Map();
  let timer=null,requestId=0,currentRetryTimer=null,currentRetryCount=0,trendRetryTimer=null,trendRetryCount=0,ledgerRetryTimer=null,ledgerRetryCount=0;
  const num=value=>Number.isFinite(Number(value))?Number(value):0;
  const pct=(value,total)=>total?Number((num(value)*100/num(total)).toFixed(2)):0;
  const currentPath=()=>String(location.pathname||'/').toLowerCase().replace(/\/+$/,'')||'/';
  const onHome=()=>['/','/home'].includes(currentPath());
  const shopeeType=()=>currentPath()==='/shopeecn'?'SHOPEECN':currentPath()==='/shopeevn'?'SHOPEEVN':'';
  const range=()=>{const to=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);const from=String(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to).slice(0,10);return{from,to};};
  const series=(name,color,values)=>({name,color,values:Array.isArray(values)?values:[],numerators:[],denominators:[]});
  async function json(url){const response=await fetch(url,{cache:'no-store',credentials:'same-origin'});const data=await response.json().catch(()=>({}));if(!response.ok||data.ok===false)throw new Error(data.error||`HTTP ${response.status}`);return data;}
  async function cached(key,url,force=false){if(!force&&cache.has(key))return cache.get(key);const data=await json(url);cache.set(key,data);return data;}
  function homeRoot(){const root=document.getElementById('homePage');return root&&!root.hidden?root:null;}
  function shopeeRoot(){const root=document.getElementById('shopeePage');return root&&!root.hidden?root:null;}
  function normalizeLabel(value=''){return String(value||'').trim().toUpperCase().replace(/[\s_-]+/g,'');}
  function latestDaily(data,date=''){const rows=Array.isArray(data?.daily)?data.daily:[];return rows.find(row=>String(row?.reportDate||'')===String(date||''))||rows.at(-1)||null;}
  function ledgerMetric(currentRow,trendRow){
    if(!trendRow?.ledgerReady)return currentRow||{};
    return{...(currentRow||{}),ready:true,total:num(trendRow.total),pod:num(trendRow.pod),podRate:num(trendRow.podRate),ocCurrent:num(trendRow.oc),ocRate:num(trendRow.ocRate),attempt1:num(trendRow.attempt1),attempt2:num(trendRow.attempt2),attempt3:num(trendRow.attempt3),_v247Ledger:true};
  }
  function homeTruthPayload(payload,cnTrend,vnTrend,date){
    const business={...(payload?.business||{})};
    business.SHOPEECN=ledgerMetric(business.SHOPEECN,latestDaily(cnTrend,date));
    business.SHOPEEVN=ledgerMetric(business.SHOPEEVN,latestDaily(vnTrend,date));
    return{...(payload||{}),business};
  }
  function setBusinessCards(root,payload){
    const byType={...(payload?.business||{}),WHPP:payload?.whpp||{}};
    const aliases={CE:'CE',CEAF:'CEAF',TBKH:'TBKH',ALI1688:'ALI1688',SHOPEECN:'SHOPEECN',SHOPEEVN:'SHOPEEVN',WHPP:'WHPP'};
    const grand=Object.values(byType).reduce((sum,row)=>sum+num(row?.total),0);
    root.querySelectorAll('.v18-business-grid .v18-business-card').forEach(card=>{
      const raw=String(card.querySelector('span')?.textContent||'').trim();const normalized=normalizeLabel(raw);const b=card.querySelector('b'),em=card.querySelector('em');
      if(/总览|总计|全部/.test(raw)){if(b)b.textContent=grand.toLocaleString('zh-CN');if(em)em.textContent='占总票数 100.00%';return;}
      const type=aliases[normalized];if(!type)return;const row=byType[type]||{};
      if(b)b.textContent=num(row.total).toLocaleString('zh-CN');if(em)em.textContent=`占总票数 ${grand?pct(row.total,grand).toFixed(2):'0.00'}%`;
    });
  }
  function setHomePodCards(root,payload){
    const rows=[...Object.values(payload?.business||{}),payload?.whpp||{}];const total=rows.reduce((s,row)=>s+num(row?.total),0),pod=rows.reduce((s,row)=>s+num(row?.pod),0);
    root.querySelectorAll('.v18-core-grid .v18-metric-card').forEach(card=>{const label=String(card.querySelector('span')?.textContent||'').trim(),b=card.querySelector('b'),small=card.querySelector('small');if(!b)return;
      if(label==='今日POD'){b.textContent=pod.toLocaleString('zh-CN');if(small)small.textContent=`占总票 ${total?pct(pod,total).toFixed(2):'0.00'}%`;}
      if(label==='POD率'){b.textContent=`${total?pct(pod,total).toFixed(2):'0.00'}%`;if(small)small.textContent='持续追踪后的当前POD率';}
    });
  }
  function setPair(box,cn,vn,key){
    if(!box)return;const spans=[...box.querySelectorAll(':scope > span')];
    [[spans[0],cn],[spans[1],vn]].forEach(([span,m])=>{if(!span)return;const b=span.querySelector('b'),small=span.querySelector('small');if(!m?.ready){if(b)b.textContent='—';if(small)small.textContent='等待处理';return;}const value=num(m[key]),total=num(m.total);if(b)b.textContent=value.toLocaleString('zh-CN');if(small)small.textContent=`${pct(value,total).toFixed(2)}%`;});
  }
  function attemptRates(region){if(!region)return[null,null,null];const direct=[region.attempt1Rate,region.attempt2Rate,region.attempt3Rate];if(direct.some(v=>v!==undefined))return direct.map(v=>v===null||v===undefined?null:num(v));if(!region.ready)return[null,null,null];const attempts=[num(region.attempt1),num(region.attempt2),num(region.attempt3)],known=attempts.reduce((a,b)=>a+b,0),pod=num(region.pod);if(!known||!pod)return[null,null,null];return attempts.map(value=>pct(value,pod));}
  function setDispatchGroup(node,region){if(!node)return;const rates=attemptRates(region),spans=[...node.querySelectorAll(':scope > span')];spans.forEach((span,index)=>{const value=rates[index],bar=span.querySelector('i b'),em=span.querySelector('em');if(bar)bar.style.width=value===null?'0%':`${Math.max(0,Math.min(100,value))}%`;if(em)em.textContent=value===null?'—':`${value.toFixed(2)}%`;});}
  function removeDuplicateHomeAssessment(root){const duplicate=new Set(['首次妥投率','首日POD妥投率','首日妥投率','首日POD']);root.querySelectorAll('.v18-core-grid .v18-metric-card').forEach(card=>{const label=String(card.querySelector('span')?.textContent||'').trim();if(duplicate.has(label))card.remove();});}
  function applyHomeCurrent(payload){
    const root=homeRoot();if(!root)return;setBusinessCards(root,payload);setHomePodCards(root,payload);
    const cn=payload?.business?.SHOPEECN||{},vn=payload?.business?.SHOPEEVN||{};const boxes=[...root.querySelectorAll('.v18-special-grid > div')];setPair(boxes[0],cn,vn,'pendingNonContinuous');setPair(boxes[1],cn,vn,'returned');removeDuplicateHomeAssessment(root);
  }
  const REGION_KEYS={'今日件数':['total','件'],'签收率':['podRate','%'],'签收件数':['pod','件'],'Pending1+':['pending1','件'],'Pending2+':['pending2','件'],'Pending3+':['pending3','件'],'OC1+':['oc1','件'],'OC2+':['oc2','件'],'OC3+':['oc3','件'],'入库无扫描':['inboundNoScan','件'],'已退回件':['returned','件']};
  function setRegionBlock(block,row){if(!block)return;block.querySelectorAll('button').forEach(button=>{const label=String(button.querySelector('span')?.textContent||'').trim(),spec=REGION_KEYS[label];if(!spec)return;const b=button.querySelector('b');if(!b)return;if(!row?.ready){b.textContent='—';return;}const [key,unit]=spec,value=row[key];b.textContent=unit==='%'?`${num(value).toFixed(2)}%`:num(value).toLocaleString('zh-CN');});}
  function applyShopeeBusiness(payload){const type=shopeeType(),root=shopeeRoot();if(!type||!root)return;const metric=payload?.business?.[type];for(const code of ['PP','PV'])setRegionBlock(root.querySelector(`.region-block.${code.toLowerCase()}`),metric?.regions?.[code]);}
  function values(data,key){const daily=Array.isArray(data?.daily)?data.daily:[];return daily.length?daily.map(row=>row?.ready?(row[key]===null||row[key]===undefined?null:num(row[key])):null):(data?.[key]||[]);}
  function rowMap(data){return new Map((data?.daily||[]).map(row=>[String(row?.reportDate||''),row]));}
  function correctedAllTrend(allTrend,oldShopee,cn,vn){
    const oldMap=rowMap(oldShopee),cnMap=rowMap(cn),vnMap=rowMap(vn);const daily=(allTrend?.daily||[]).map(row=>{
      if(!row?.ready)return row;const date=String(row.reportDate||''),old=oldMap.get(date),c=cnMap.get(date),v=vnMap.get(date);if(!old?.ready||!c||!v)return row;
      const total=Math.max(0,num(row.total)-num(old.total)+num(c.total)+num(v.total));const pod=Math.max(0,num(row.pod)-num(old.pod)+num(c.pod)+num(v.pod));const ocCurrent=Math.max(0,num(row.ocCurrent)-num(old.ocCurrent)+num(c.oc)+num(v.oc));
      return{...row,total,pod,ocCurrent,podRate:pct(pod,total),ocRate:pct(ocCurrent,total),v247ShopeeLedgerApplied:Boolean(c.ledgerReady||v.ledgerReady)};
    });
    return{...(allTrend||{}),daily,ticket:daily.map(r=>r?.ready?num(r.total):null),pod:daily.map(r=>r?.ready?num(r.pod):null),podRate:daily.map(r=>r?.ready?num(r.podRate):null),oc:daily.map(r=>r?.ready?num(r.ocCurrent):null),ocRate:daily.map(r=>r?.ready?num(r.ocRate):null)};
  }
  function renderTrends(allTrend){
    const root=homeRoot();if(!root||!global.RateTrendCardV18?.render)return;const cards=[...root.querySelectorAll('.v18-trend-section .v18-chart-card')].slice(0,4);if(cards.length<4)return;const dates=allTrend?.dates||[];
    const specs=[{title:'总票数趋势',type:'count',dates,series:[series('总票数','#1677ff',values(allTrend,'total'))]},{title:'POD数量趋势',type:'count',dates,series:[series('POD数量','#16a36a',values(allTrend,'pod'))]},{title:'POD率趋势',type:'rate',dates,series:[series('POD率','#6c4cf5',values(allTrend,'podRate'))]},{title:'OC数量趋势',type:'count',dates,series:[series('当日OC','#ff8a00',values(allTrend,'ocCurrent'))]}];
    cards.forEach((card,index)=>global.RateTrendCardV18.render(card,specs[index]));root.querySelectorAll('#v230MetricTruthPanel').forEach(node=>node.remove());
  }
  function findHomeAttemptSection(root){for(const h of root.querySelectorAll('h2,h3,h4')){const t=String(h.textContent||'');if(/SHOPEE\s*1\s*\/\s*2\s*\/\s*3派|1\s*\/\s*2\s*\/\s*3派成功率趋势/.test(t))return h.closest('section')||h.closest('article');}return root.querySelector('#v247HomeShopeeAttempts');}
  function attemptSummary(data){const rows=Array.isArray(data?.daily)?data.daily:[];const pod=rows.reduce((s,r)=>s+num(r.pod),0),unknown=rows.reduce((s,r)=>s+num(r.attemptUnknown),0),known=Math.max(0,pod-unknown),ready=rows.filter(r=>r.ledgerReady).length;return{pod,unknown,known,ready,totalDays:rows.length};}
  function renderAttemptChart(card,data,label){if(!card||!global.RateTrendCardV18?.render)return;global.RateTrendCardV18.render(card,{title:`${label} 1/2/3派签收占POD趋势`,type:'rate',dates:data?.dates||[],series:[{name:'1派',color:'#1677ff',values:data?.attempt1Rate||[],numerators:data?.attempt1||[],denominators:data?.pod||[]},{name:'2派',color:'#16a36a',values:data?.attempt2Rate||[],numerators:data?.attempt2||[],denominators:data?.pod||[]},{name:'3派+',color:'#ff8a00',values:data?.attempt3Rate||[],numerators:data?.attempt3||[],denominators:data?.pod||[]}]});}
  function renderHomeAttempts(cn,vn){
    const root=homeRoot();if(!root)return;let host=findHomeAttemptSection(root);if(!host){host=document.createElement('section');const trend=root.querySelector('.v18-trend-section');(trend?.parentNode||root).insertBefore(host,trend?.nextSibling||null);}host.id='v247HomeShopeeAttempts';host.className='v18-panel';host.dataset.v247=VERSION;
    const c=attemptSummary(cn),v=attemptSummary(vn);const note=(name,s)=>s.totalDays===0?`${name}：暂无有效日报`:(s.ready<s.totalDays?`${name}：V246账本正在补齐（${s.ready}/${s.totalDays}个日报日已锁定）；不显示部分数据假0%`:`${name}：已识别派次 ${s.known}/${s.pod} POD，未识别 ${s.unknown}票`);
    host.innerHTML=`<div style="padding:14px 16px 6px"><h2 style="margin:0;color:#17365d">SHOPEE 1/2/3派签收占POD趋势</h2><p style="margin:6px 0 0;color:#7a6a3a;font-size:12px;line-height:1.7">${note('CN',c)}<br>${note('VN',v)}。派次严格按真实70 START → Pending/失败 → 新START计算；无证据保持“—”。</p></div><div class="v18-chart-grid"><article class="v18-chart-card" data-v247-attempt="CN"></article><article class="v18-chart-card" data-v247-attempt="VN"></article></div>`;renderAttemptChart(host.querySelector('[data-v247-attempt="CN"]'),cn,'SHOPEE CN');renderAttemptChart(host.querySelector('[data-v247-attempt="VN"]'),vn,'SHOPEE VN');
  }
  function applyHomeDispatchTruth(cn,vn){const root=homeRoot();if(!root)return;const cnDay=latestDaily(cn,range().to),vnDay=latestDaily(vn,range().to);const byLabel={'CN-PP':cnDay?.regions?.PP,'CN-PV':cnDay?.regions?.PV,'VN-PP':vnDay?.regions?.PP,'VN-PV':vnDay?.regions?.PV};root.querySelectorAll('.v18-dispatch-grid > div').forEach(node=>setDispatchGroup(node,byLabel[String(node.querySelector('h3')?.textContent||'').trim()]||null));}
  async function currentPayload(r,force=false){const live=global.__CE_QC_V237_CURRENT_SUMMARY__;if(!force&&live&&String(live.reportDate||'')===r.to)return live;return cached(`current|${r.to}`,`/api/v234/current-summary?reportDate=${encodeURIComponent(r.to)}`,force);}
  async function shopeeTrendPayload(type,r,force=false){return cached(`v247|${type}|${r.from}|${r.to}`,`/api/v246/shopee-trends?businessType=${encodeURIComponent(type)}&from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`,force);}
  function currentReady(payload){return REQUIRED.every(type=>payload?.business?.[type]?.ready);}
  function scheduleCurrentRetry(payload){clearTimeout(currentRetryTimer);if(currentReady(payload)){currentRetryCount=0;return;}if(currentRetryCount>=15)return;currentRetryCount+=1;currentRetryTimer=setTimeout(async()=>{const r=range();if(!r.to)return;cache.delete(`current|${r.to}`);try{const current=await currentPayload(r,true);if(onHome())applyHomeCurrent(current);else if(shopeeType())applyShopeeBusiness(current);scheduleCurrentRetry(current);}catch(error){console.warn('[V247 home current retry]',error);}},4000);}
  function trendMissing(payload){return (Array.isArray(payload?.missingDates)?payload.missingDates.length:(payload?.daily||[]).filter(row=>!row?.ready).length)>0;}
  function scheduleTrendRetry(allTrend){clearTimeout(trendRetryTimer);if(!trendMissing(allTrend)){trendRetryCount=0;return;}if(trendRetryCount>=12)return;const delay=trendRetryCount<3?3000:6000;trendRetryCount+=1;trendRetryTimer=setTimeout(()=>{if(!onHome())return;const r=range();cache.delete(`all|${r.from}|${r.to}`);cache.delete(`oldShopee|${r.from}|${r.to}`);void refreshHome(false);},delay);}
  function ledgerNeedsRetry(data){const rows=Array.isArray(data?.daily)?data.daily:[];return rows.some(r=>!r.ledgerReady)||(rows.some(r=>num(r.pod)>0&&num(r.attemptUnknown)>0));}
  function scheduleLedgerRetry(cn,vn){clearTimeout(ledgerRetryTimer);if(!ledgerNeedsRetry(cn)&&!ledgerNeedsRetry(vn)){ledgerRetryCount=0;return;}if(ledgerRetryCount>=24)return;ledgerRetryCount+=1;ledgerRetryTimer=setTimeout(()=>{if(!onHome())return;const r=range();for(const t of ['SHOPEECN','SHOPEEVN'])cache.delete(`v247|${t}|${r.from}|${r.to}`);void refreshHome(false);},15000);}
  async function refreshHome(force=false){
    if(!onHome()||!homeRoot())return;const r=range();if(!r.to)return;const id=++requestId;
    try{
      const [current,allTrend,oldShopee,cnTrend,vnTrend]=await Promise.all([currentPayload(r,force),cached(`all|${r.from}|${r.to}`,`/api/v234/trends?businessType=ALL&from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`,force),cached(`oldShopee|${r.from}|${r.to}`,`/api/v234/trends?businessType=SHOPEE&from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`,force),shopeeTrendPayload('SHOPEECN',r,force),shopeeTrendPayload('SHOPEEVN',r,force)]);
      if(id!==requestId)return;const truthCurrent=homeTruthPayload(current,cnTrend,vnTrend,r.to);const truthTrend=correctedAllTrend(allTrend,oldShopee,cnTrend,vnTrend);applyHomeCurrent(truthCurrent);renderTrends(truthTrend);renderHomeAttempts(cnTrend,vnTrend);applyHomeDispatchTruth(cnTrend,vnTrend);removeDuplicateHomeAssessment(homeRoot());scheduleCurrentRetry(current);scheduleTrendRetry(allTrend);scheduleLedgerRetry(cnTrend,vnTrend);
    }catch(error){console.warn('[V247 home dashboard]',error);}
  }
  async function refreshShopeeRegions(force=false){if(!shopeeType()||!shopeeRoot())return;const r=range();if(!r.to)return;try{const current=await currentPayload(r,force);applyShopeeBusiness(current);scheduleCurrentRetry(current);}catch(error){console.warn('[V247 shopee regions]',error);}}
  function schedule(delay=80,force=false){clearTimeout(timer);if(force){currentRetryCount=0;trendRetryCount=0;ledgerRetryCount=0;clearTimeout(currentRetryTimer);clearTimeout(trendRetryTimer);clearTimeout(ledgerRetryTimer);}timer=setTimeout(()=>{if(onHome())void refreshHome(force);else if(shopeeType())void refreshShopeeRegions(force);},delay);}
  const observer=new MutationObserver(records=>{const relevant=records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1&&(node.matches?.('#homePage,#shopeePage,.v18-business-grid,.v18-mid-grid,.v18-trend-section,.region-block,.v18-dispatch-grid')||node.querySelector?.('.v18-business-grid,.v18-mid-grid,.v18-trend-section,.region-block,.v18-dispatch-grid'))));if(relevant)schedule(80,false);});observer.observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('click',event=>{if(event.target?.closest?.('#topRangeQuery,.top-range-query,#dashboardRangeQuery'))schedule(120,true);if(event.target?.closest?.('.side-link[data-page]'))schedule(100,false);},true);document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(120,true);});global.addEventListener('popstate',()=>schedule(80,false));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>schedule(100,true),{once:true});else schedule(100,true);
  console.info('[CE-QC][V247_HOME_DASHBOARD_OWNER]',VERSION,'home totals, POD, trends and Shopee attempts/PP-PV distribution are corrected by V246 locked tracking ledger; duplicate first-day assessment removed');
})(window);