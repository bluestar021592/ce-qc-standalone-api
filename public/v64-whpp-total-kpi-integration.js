(function installCanonicalHomeTruthV149(global){
  if(global.__CE_QC_V149_HOME_TRUTH_UI__)return;
  const VERSION='2026-08-15-v149-current-import-home-truth-v3';
  const cache=new Map();let timer=null,running=false,rerun=false;

  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const pct=value=>value===null||value===undefined?'—':`${Number(value||0).toFixed(2).replace(/\.00$/,'')}%`;
  const selectedDate=()=>String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||global.historyModeDate||global.unifiedImportState?.reportDate||'').slice(0,10);
  const singleDay=date=>date&&String(document.getElementById('topRangeFrom')?.value||date).slice(0,10)===date&&String(document.getElementById('topRangeTo')?.value||date).slice(0,10)===date;

  async function load(date){
    const hit=cache.get(date);if(hit&&Date.now()-hit.at<3000)return hit.data;
    const response=await fetch(`/api/v143/home-truth?reportDate=${encodeURIComponent(date)}&_=${Date.now()}`,{cache:'no-store',credentials:'same-origin'});
    const data=await response.json().catch(()=>({}));if(!response.ok||data?.ok===false)throw new Error(data?.error||`HTTP ${response.status}`);
    cache.set(date,{at:Date.now(),data});return data;
  }

  function card(label){return [...document.querySelectorAll('#homePage .v18-business-grid .v18-business-card')].find(node=>String(node.querySelector('span')?.textContent||'').trim()===label)||null;}
  function setText(node,text){if(node&&node.textContent!==text)node.textContent=text;}
  function ensureWhpp(){
    const grid=document.querySelector('#homePage .v18-business-grid');if(!grid)return null;let node=card('WHPP本土');if(node)return node;
    node=document.createElement('button');node.type='button';node.className='v18-business-card cyan';node.dataset.v149Business='WHPP';
    node.onclick=()=>typeof global.navigateWhppPage==='function'?global.navigateWhppPage():global.navigatePage?.('whpp');
    node.innerHTML='<span>WHPP本土</span><small>今日票数</small><b>0</b><em>占总票数 0.00%</em>';grid.appendChild(node);return node;
  }

  function patchTop(data){
    const labels={CE:'CE',CEAF:'CEAF空运',TBKH:'TBKH',ALI1688:'ALI1688',SHOPEECN:'SHOPEE CN',SHOPEEVN:'SHOPEE VN',WHPP:'WHPP本土'};
    ensureWhpp();
    for(const [type,label] of Object.entries(labels)){const node=card(label);if(!node)continue;const value=Number(data.counts?.[type]||0);setText(node.querySelector('b'),fmt(value));setText(node.querySelector('em'),`占总票数 ${data.total?((value*100/data.total).toFixed(2)):'0.00'}%`);}
    const totalCard=card('总览');if(totalCard){setText(totalCard.querySelector('b'),fmt(data.total));setText(totalCard.querySelector('em'),'占总票数 100.00%');}
  }

  function metric(label){return [...document.querySelectorAll('#homePage .v18-core-grid .v18-metric-card')].find(node=>String(node.querySelector('span')?.textContent||'').trim()===label)||null;}
  function metricAny(labels){for(const label of labels){const node=metric(label);if(node)return node;}return null;}
  function setCount(labels,value,total,note='占核心业务'){
    const node=metricAny(labels);if(!node)return;setText(node.querySelector('b'),fmt(value));setText(node.querySelector('small'),`${note} ${total?((Number(value||0)*100/total).toFixed(2)):'0.00'}%`);
  }
  function setRate(labels,value,note='当前'){
    const node=metricAny(labels);if(!node)return;setText(node.querySelector('b'),pct(value));setText(node.querySelector('small'),value===null||value===undefined?'派次证据不足':`${note} ${Number(value||0).toFixed(2)}%`);
  }

  function patchCore(data){
    const c=data.core;if(!c)return;const root=document.querySelector('#homePage .v18-core');if(!root)return;
    const heading=root.querySelector('h2');if(heading)heading.innerHTML='核心指标总览 <small>CE + CEAF空运 + TBKH + ALI1688 + WHPP本土，不含 SHOPEE CN/VN</small>';
    setCount(['Pending不连续'],c.pendingNonContinuous,c.total);
    setCount(['Pending 3天+','Pending3+'],c.pending3,c.total);
    setCount(['OC 1天+','OC1+'],c.oc1,c.total);
    setCount(['门店滞留'],c.storeRetention,c.total);
    setCount(['工单','工单未处理'],c.workOrder,c.total);
    setCount(['入库无扫描节点','入库无扫描'],c.inboundNoScan,c.total);
    setCount(['盘点2天+','盘点 2天+'],c.cycle2,c.total);
    setCount(['OC 2天+','OC2+'],c.oc2,c.total);
    setRate(['首次妥投率'],c.firstPodRate);
    setCount(['今日POD'],c.todayPod,c.total);
    setRate(['POD率'],c.podRate);
    setCount(['外省未完结POD件'],c.provinceOpen,c.total);
    root.dataset.v149CoreSource='LATEST_VALID_UNIFIED_IMPORT_PLUS_LIVE_SQL_EVIDENCE';
    root.dataset.v149CoreTotal=String(c.total||0);
  }

  function patchSpecial(data){
    const root=[...document.querySelectorAll('#homePage .v18-panel')].find(node=>/SHOPEE\s*专项指标/.test(String(node.querySelector('h2')?.textContent||'')));
    if(!root||!data.special)return;
    const applyBlock=(title,field)=>{
      const block=[...root.querySelectorAll('.v18-special-grid > div')].find(node=>String(node.querySelector('h3')?.textContent||'').includes(title));
      if(!block)return;
      const spans=[...block.querySelectorAll(':scope > span')];
      const pairs=[['CN',data.special.CN],['VN',data.special.VN]];
      spans.slice(0,2).forEach((span,index)=>{
        const [label,item]=pairs[index];if(!item)return;
        const value=Number(item[field]||0),total=Number(item.total||0);
        const b=span.querySelector('b'),small=span.querySelector('small');
        if(b)setText(b,fmt(value));
        if(small)setText(small,`${total?((value*100/total).toFixed(2)):'0.00'}%`);
        span.title=`${label} ${field==='returned'?'退回件':'Pending不连续'} ${value}票 / 本板块 ${total}票`;
      });
      block.dataset.v149SpecialSource='LIVE_SQL_FINAL_OR_CURRENT_STATE';
    };
    applyBlock('Pending不连续','pendingNonContinuous');
    applyBlock('退回件','returned');
  }

  function patchDispatch(data){
    const grid=document.querySelector('#homePage .v18-dispatch-grid');if(!grid)return;
    const groups=data.dispatch||{};
    for(const block of grid.children){
      const label=String(block.querySelector('h3')?.textContent||'').trim();const truth=groups[label];if(!truth)continue;
      const rows=[...block.querySelectorAll('span')];
      rows.slice(0,3).forEach((row,index)=>{
        const value=truth.values?.[index];const bar=row.querySelector('i b'),out=row.querySelector('em');
        if(bar)bar.style.width=value===null||value===undefined?'0%':`${Math.max(0,Math.min(100,Number(value)||0))}%`;
        if(out)out.textContent=value===null||value===undefined?'—':`${Number(value||0).toFixed(2)}%`;
        row.title=value===null||value===undefined?(truth.total?`POD ${truth.pod}票，其中 ${truth.unknownPod||0}票尚无可验证派次证据`:'本区域无票'):`${index+1}派 ${truth.counts?.[index]||0}票 / 总票 ${truth.total}`;
      });
      block.dataset.v149DispatchSource='CROSS_DAY_REAL_POD_AND_DISPATCH_EVIDENCE';
    }
  }

  async function apply(){
    if(running){rerun=true;return;}const home=document.getElementById('homePage');const date=selectedDate();if(!home||home.hidden||!singleDay(date))return;
    running=true;rerun=false;
    try{
      const data=await load(date);if(!data?.available)return;
      patchTop(data);patchCore(data);patchSpecial(data);patchDispatch(data);
      document.documentElement.dataset.v149HomeTruth=VERSION;
      document.documentElement.dataset.v149HomeSnapshotStatus=String(data.snapshotStatus||'');
    }catch(error){console.warn('[CE-QC][V149_HOME_TRUTH_UI]',error);}
    finally{running=false;if(rerun){rerun=false;setTimeout(()=>void apply(),0);}}
  }
  function schedule(delay=30,invalidate=false){if(invalidate)cache.clear();clearTimeout(timer);timer=setTimeout(()=>void apply(),delay);}

  const prior=global.renderAll;if(typeof prior==='function'&&!prior.__v149HomeTruthWrapped){const wrapped=function(){const result=prior.apply(this,arguments);schedule(0);return result;};wrapped.__v149HomeTruthWrapped=true;global.renderAll=wrapped;}
  document.addEventListener('click',event=>{if(event.target?.closest?.('#topRangeQuery,#dashboardRangeQuery,[data-page="home"],.side-link'))schedule(20,true);},true);
  document.addEventListener('change',event=>{if(event.target?.matches?.('#topRangeFrom,#topRangeTo,#dashboardRangeFrom,#dashboardRangeTo'))schedule(20,true);});
  document.addEventListener('ce-qc-run-complete',()=>schedule(0,true));
  const root=document.getElementById('homePage');if(root){const observer=new MutationObserver(records=>{if(records.some(record=>record.addedNodes.length))schedule(10);});observer.observe(root,{childList:true,subtree:true});}
  setInterval(()=>{if(!document.hidden&&document.getElementById('homePage')&&!document.getElementById('homePage').hidden)schedule(0,true);},5000);
  schedule(40,true);
  global.__CE_QC_V149_HOME_TRUTH_UI__={version:VERSION,refresh:()=>schedule(0,true)};
  console.info('[CE-QC][V149_HOME_TRUTH_UI]',VERSION);
})(window);
