(function installCanonicalHomeTruthV150(global){
  if(global.__CE_QC_V149_HOME_TRUTH_UI__)return;
  const VERSION='2026-08-15-v150-event-driven-home-truth-v4';
  const cache=new Map();let timer=null,running=false,rerun=false;
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const pct=value=>value===null||value===undefined?'—':`${Number(value||0).toFixed(2).replace(/\.00$/,'')}%`;
  const selectedDate=()=>String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);
  const singleDay=date=>date&&String(document.getElementById('topRangeFrom')?.value||date).slice(0,10)===date&&String(document.getElementById('topRangeTo')?.value||date).slice(0,10)===date;
  const setText=(node,text)=>{if(node&&node.textContent!==text)node.textContent=text;};

  async function load(date){
    const hit=cache.get(date);if(hit&&Date.now()-hit.at<15000)return hit.data;
    const response=await fetch(`/api/v143/home-truth?reportDate=${encodeURIComponent(date)}&_=${Date.now()}`,{cache:'no-store',credentials:'same-origin'});
    const data=await response.json().catch(()=>({}));if(!response.ok||data?.ok===false)throw new Error(data?.error||`HTTP ${response.status}`);
    cache.set(date,{at:Date.now(),data});return data;
  }
  function card(label){return [...document.querySelectorAll('#homePage .v18-business-grid .v18-business-card')].find(node=>String(node.querySelector('span')?.textContent||'').trim()===label)||null;}
  function ensureWhpp(){const grid=document.querySelector('#homePage .v18-business-grid');if(!grid)return null;let node=card('WHPP本土');if(node)return node;node=document.createElement('button');node.type='button';node.className='v18-business-card cyan';node.onclick=()=>global.navigateWhppPage?.()||global.navigatePage?.('whpp');node.innerHTML='<span>WHPP本土</span><small>今日票数</small><b>0</b><em>占总票数 0.00%</em>';grid.appendChild(node);return node;}
  function patchTop(data){const labels={CE:'CE',CEAF:'CEAF空运',TBKH:'TBKH',ALI1688:'ALI1688',SHOPEECN:'SHOPEE CN',SHOPEEVN:'SHOPEE VN',WHPP:'WHPP本土'};ensureWhpp();for(const [type,label] of Object.entries(labels)){const node=card(label);if(!node)continue;const value=Number(data.counts?.[type]||0);setText(node.querySelector('b'),fmt(value));setText(node.querySelector('em'),`占总票数 ${data.total?(value*100/data.total).toFixed(2):'0.00'}%`);}const total=card('总览');if(total){setText(total.querySelector('b'),fmt(data.total));setText(total.querySelector('em'),'占总票数 100.00%');}}
  function metric(label){return [...document.querySelectorAll('#homePage .v18-core-grid .v18-metric-card')].find(node=>String(node.querySelector('span')?.textContent||'').trim()===label)||null;}
  function metricAny(labels){for(const label of labels){const node=metric(label);if(node)return node;}return null;}
  function setCount(labels,value,total){const node=metricAny(labels);if(!node)return;setText(node.querySelector('b'),fmt(value));setText(node.querySelector('small'),`占核心业务 ${total?(Number(value||0)*100/total).toFixed(2):'0.00'}%`);}
  function setRate(labels,value){const node=metricAny(labels);if(!node)return;setText(node.querySelector('b'),pct(value));setText(node.querySelector('small'),value===null||value===undefined?'派次证据不足':`当前 ${Number(value||0).toFixed(2)}%`);}
  function patchCore(data){const c=data.core,root=document.querySelector('#homePage .v18-core');if(!c||!root)return;const h=root.querySelector('h2');if(h)h.innerHTML='核心指标总览 <small>CE + CEAF空运 + TBKH + ALI1688 + WHPP本土，不含 SHOPEE CN/VN</small>';setCount(['Pending不连续'],c.pendingNonContinuous,c.total);setCount(['Pending 3天+','Pending3+'],c.pending3,c.total);setCount(['OC 1天+','OC1+'],c.oc1,c.total);setCount(['门店滞留'],c.storeRetention,c.total);setCount(['工单','工单未处理'],c.workOrder,c.total);setCount(['入库无扫描节点','入库无扫描'],c.inboundNoScan,c.total);setCount(['盘点2天+','盘点 2天+'],c.cycle2,c.total);setCount(['OC 2天+','OC2+'],c.oc2,c.total);setRate(['首次妥投率'],c.firstPodRate);setCount(['今日POD'],c.todayPod,c.total);setRate(['POD率'],c.podRate);setCount(['外省未完结POD件'],c.provinceOpen,c.total);root.dataset.homeTruthSource='EVENT_DRIVEN_DATABASE_TRUTH';}
  function patchSpecial(data){const root=[...document.querySelectorAll('#homePage .v18-panel')].find(node=>/SHOPEE\s*专项指标/.test(String(node.querySelector('h2')?.textContent||'')));if(!root||!data.special)return;for(const [title,field] of [['Pending不连续','pendingNonContinuous'],['退回件','returned']]){const block=[...root.querySelectorAll('.v18-special-grid > div')].find(node=>String(node.querySelector('h3')?.textContent||'').includes(title));if(!block)continue;const spans=[...block.querySelectorAll(':scope > span')];[['CN',data.special.CN],['VN',data.special.VN]].forEach(([label,item],i)=>{const span=spans[i];if(!span||!item)return;const value=Number(item[field]||0),total=Number(item.total||0);setText(span.querySelector('b'),fmt(value));setText(span.querySelector('small'),`${total?(value*100/total).toFixed(2):'0.00'}%`);span.title=`${label} ${title} ${value}票 / ${total}票`;});}}
  function patchDispatch(data){const grid=document.querySelector('#homePage .v18-dispatch-grid');if(!grid)return;for(const block of grid.children){const truth=data.dispatch?.[String(block.querySelector('h3')?.textContent||'').trim()];if(!truth)continue;[...block.querySelectorAll('span')].slice(0,3).forEach((row,index)=>{const value=truth.values?.[index],bar=row.querySelector('i b'),out=row.querySelector('em');if(bar)bar.style.width=value==null?'0%':`${Math.max(0,Math.min(100,Number(value)||0))}%`;if(out)out.textContent=value==null?'—':`${Number(value).toFixed(2)}%`;});}}
  async function apply(){if(running){rerun=true;return;}const home=document.getElementById('homePage'),date=selectedDate();if(!home||home.hidden||!singleDay(date))return;running=true;try{const data=await load(date);if(data?.available){patchTop(data);patchCore(data);patchSpecial(data);patchDispatch(data);document.documentElement.dataset.v150HomeTruth=VERSION;}}catch(error){console.warn('[CE-QC][V150_HOME_TRUTH]',error);}finally{running=false;if(rerun){rerun=false;setTimeout(()=>void apply(),0);}}}
  function schedule(delay=20,invalidate=false){if(invalidate)cache.clear();clearTimeout(timer);timer=setTimeout(()=>void apply(),delay);}

  // Deliberately event-driven. The previous 5-second SQL polling repeatedly scanned
  // cross-day SHOPEE evidence and could starve Excel upload requests on the single
  // Node process. Home truth now refreshes only when the user opens/queries home or
  // when a processing run explicitly completes.
  document.addEventListener('click',event=>{if(event.target?.closest?.('#topRangeQuery,#dashboardRangeQuery,[data-page="home"]'))schedule(30,true);},true);
  document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(30,true);});
  global.addEventListener('ce-qc-run-complete',()=>schedule(50,true));
  global.addEventListener('ce-qc-unified-import-saved',()=>cache.clear());
  global.__CE_QC_V149_HOME_TRUTH_UI__={version:VERSION,refresh:()=>schedule(0,true),policy:'EVENT_DRIVEN_NO_BACKGROUND_POLL'};
  console.info('[CE-QC][V150_HOME_TRUTH]',VERSION);
})(window);
