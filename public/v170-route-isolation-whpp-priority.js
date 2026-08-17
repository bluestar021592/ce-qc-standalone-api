(function installRouteIsolationWhppPriorityV170(global){
  if(global.__CE_QC_V170_ROUTE_ISOLATION_WHPP_PRIORITY__)return;
  const VERSION='2026-08-17-v170-route-isolation-whpp-priority-v1';
  let repairTimer=null;
  let priorityBusy=false;

  const PATH_PAGE={
    '/':'home','/home':'home','/ce':'ce','/ceaf':'ceaf','/tbkh':'tbkh','/ali1688':'ali1688',
    '/shopeecn':'shopeecn','/shopeevn':'shopeevn','/import':'import','/tracking':'tracking',
    '/exceptions':'exceptions','/reports':'reports','/data-management':'data-management','/settings':'settings','/logs':'logs'
  };

  function pageFromLocation(){
    const path=String(location.pathname||'/').replace(/\/+$/,'')||'/';
    return PATH_PAGE[path]||'';
  }

  function whppHijacked(){
    if(location.pathname==='/whpp')return false;
    const intended=pageFromLocation();
    if(!intended)return false;
    const title=String(document.getElementById('pageTitle')?.textContent||'').trim();
    const whppSide=document.querySelector('.side-link[data-page="whpp"]');
    const whppFast=document.getElementById('whppFastPage');
    const shopeePage=document.getElementById('shopeePage');
    const shopeeWhpp=/WHPP本土看板/.test(String(shopeePage?.querySelector('h2')?.textContent||''));
    return title==='WHPP本土看板'
      || Boolean(whppSide?.classList.contains('active'))
      || Boolean(whppFast && !whppFast.hidden)
      || ((intended==='shopeecn'||intended==='shopeevn')&&shopeeWhpp);
  }

  function repairRoute(){
    if(!whppHijacked())return false;
    const intended=pageFromLocation();
    if(!intended||typeof global.navigatePage!=='function')return false;
    console.warn('[CE-QC][V170_ROUTE_ISOLATION] discarded stale WHPP render; restoring',intended);
    try{global.navigatePage(intended);return true;}catch(error){console.warn('[CE-QC][V170_ROUTE_ISOLATION] restore failed',error);return false;}
  }

  function armRouteGuard(ms=7000){
    if(repairTimer)clearInterval(repairTimer);
    const deadline=Date.now()+Math.max(1000,Number(ms||0));
    repairTimer=setInterval(()=>{
      if(Date.now()>=deadline){clearInterval(repairTimer);repairTimer=null;return;}
      repairRoute();
    },100);
    setTimeout(repairRoute,0);
  }

  document.addEventListener('click',event=>{
    const link=event.target?.closest?.('.side-link[data-page]');
    if(!link)return;
    if(String(link.dataset.page||'')!=='whpp')armRouteGuard();
  },true);
  global.addEventListener('popstate',()=>{if(location.pathname!=='/whpp')armRouteGuard();});

  function wait(ms){return new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms||0))));}
  function normalizeDate(value){const text=String(value||'').trim().replace(/\//g,'-').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
  function targetDate(){
    const base=global.__CE_QC_V67_RESILIENT_RUN_GUARD__?.targetDate;
    try{const value=normalizeDate(typeof base==='function'?base():'');if(value)return value;}catch{}
    const input=normalizeDate(document.getElementById('reportDate')?.value);if(input)return input;
    const top=normalizeDate(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value);if(top)return top;
    try{return normalizeDate(unifiedImportState?.reportDate||appState?.reportDate||shopeeState?.reportDate||'');}catch{return '';}
  }
  async function jsonFetch(url,options={}){
    const response=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});
    const text=await response.text();let payload={};try{payload=text?JSON.parse(text):{};}catch{}
    if(!response.ok||payload?.ok===false){const error=new Error(payload.error||payload.message||`HTTP ${response.status}`);error.code=payload.code||`HTTP_${response.status}`;error.status=response.status;error.payload=payload;throw error;}
    return payload;
  }
  function alreadyDone(error){return String(error?.code||'')==='RUN_ALREADY_COMPLETED'||/已经完成|already\s*(?:completed|finished)/i.test(String(error?.message||''));}
  function activeRun(error){return ['WHPP_RUN_ALREADY_ACTIVE','RUN_ALREADY_ACTIVE'].includes(String(error?.code||''))||/任务正在运行|already\s*(?:active|running)/i.test(String(error?.message||''));}
  function isAuth(error){return [401,403].includes(Number(error?.status||0))||/未授权|unauthorized|登录.*失效|token.*(?:过期|expired|invalid)/i.test(String(error?.message||''));}
  function isTransient(error){return [408,425,429,500,502,503,504].includes(Number(error?.status||0))||/timeout|timed out|failed to fetch|fetch failed|connection reset|连接中断|网络中断/i.test(String(error?.message||''));}
  function noReport(error){return ['WHPP_REPORT_MISSING','REPORT_MISSING','NO_DAILY_REPORT','REPORT_DATE_MISSING'].includes(String(error?.code||''))||/未导入.*日报|没有.*日报/i.test(String(error?.message||''));}
  function statusNode(){return document.getElementById('ccslRunStatus');}
  function setStatus(text,level='warning'){const node=statusNode();if(node)node.innerHTML=`<span class="status-pill ${level}">${String(text||'')}</span>`;}

  async function verifyWhpp(target){
    const original=global.__CE_QC_V67_RESILIENT_RUN_GUARD__?.verifyWhpp;
    if(typeof original==='function')return original(target);
    const q=target?`?reportDate=${encodeURIComponent(target)}&compact=1`:'?compact=1';
    const payload=await jsonFetch(`/api/business-state/WHPP${q}`);const state=payload?.state||{};
    const total=Number(state.total??state.dailyParseSummary?.totalRecognized??0);const snapshotStatus=String(state.snapshotStatus||'').toUpperCase();
    if(total>0&&!['COMPLETED','COMPLETED_WITH_RETRY'].includes(snapshotStatus)){const error=new Error(`WHPP本土${total}票未生成正式快照`);error.code='WHPP_STAGE_NOT_FINALIZED';throw error;}
    return {label:'WHPP本土',ok:true,verified:true,total,snapshotStatus};
  }
  async function waitForWhpp(target,timeoutMs=10*60*1000){
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      const progress=await jsonFetch('/api/whpp/progress');const p=progress?.processing||{};
      if(!p.running&&!p.paused)return verifyWhpp(target);
      setStatus(`WHPP本土已有任务，等待完成… ${Number(p.batchIndex||0)}/${Number(p.totalBatches||0)}`);await wait(1000);
    }
    throw new Error('WHPP本土任务超过10分钟未完成');
  }
  async function runStage(stage,preferResume,target){
    let lastError=null;
    for(let attempt=0;attempt<3;attempt+=1){
      const useResume=Boolean(preferResume||attempt>0);if(attempt)await wait(700*attempt);
      setStatus(`${stage.label}${attempt?`自动续跑 ${attempt+1}/3`:'处理中'}…`);
      try{
        await jsonFetch(useResume?stage.resume:stage.start,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reportDate:target||''})});
        if(stage.key==='WHPP')return await verifyWhpp(target);return {label:stage.label,ok:true};
      }catch(error){
        if(alreadyDone(error)){if(stage.key==='WHPP')return await verifyWhpp(target);return {label:stage.label,ok:true,skipped:true};}
        if(stage.key==='WHPP'&&activeRun(error)){try{return await waitForWhpp(target);}catch(waitError){lastError=waitError;break;}}
        if(isAuth(error))throw error;
        if(noReport(error)){lastError=new Error(`${stage.label}当日日报运行态缺失：${error.message||error}`);break;}
        lastError=error;if(!isTransient(error))break;
      }
    }
    return {label:stage.label,ok:false,error:lastError?.message||String(lastError||'处理失败')};
  }
  async function executePriority(mode='start'){
    if(priorityBusy)return {ok:false,busy:true};
    priorityBusy=true;const target=targetDate();const results=[];
    try{
      const stages=[
        {key:'CCSL',label:'CCSL（CE/CEAF/TBKH/ALI1688）',start:'/api/run',resume:'/api/resume'},
        {key:'WHPP',label:'WHPP本土',start:'/api/whpp/run/start',resume:'/api/whpp/run/resume'},
        {key:'SHOPEE',label:'SHOPEE CN/VN',start:'/api/shopee/run/start',resume:'/api/shopee/run/resume'}
      ];
      for(const stage of stages){setStatus(`${stage.label}正在进入当日日报处理…`);results.push(await runStage(stage,mode==='resume',target));}
      const failed=results.filter(item=>item?.ok===false);
      setStatus(failed.length?`七业务未全部完成：${failed.map(item=>`${item.label}：${item.error||'失败'}`).join('；')}`:'七业务当日日报处理完成，CCSL、WHPP、SHOPEE均已验证正式结果。',failed.length?'danger':'success');
      document.dispatchEvent(new CustomEvent('ce-qc-run-complete',{detail:{results,reportDate:target,complete:failed.length===0,v170Priority:true}}));
      try{if(typeof global.refresh==='function')await global.refresh();}catch{}
      return {ok:failed.length===0,results,reportDate:target,v170Priority:true};
    }catch(error){setStatus(`处理连接异常：${String(error.message||error)}；已完成断点不会丢失。`,'danger');return {ok:false,error:error.message||String(error),results};}
    finally{priorityBusy=false;}
  }

  function patchRunner(attempt=0){
    const guard=global.__CE_QC_V67_RESILIENT_RUN_GUARD__;
    if(!guard||typeof guard.run!=='function'){
      if(attempt<40)setTimeout(()=>patchRunner(attempt+1),100);
      return;
    }
    if(!guard.__v170OriginalRun)guard.__v170OriginalRun=guard.run;
    guard.run=executePriority;
    guard.v170Priority=true;
    console.info('[CE-QC][V170_WHPP_PRIORITY] CCSL -> WHPP -> SHOPEE');
  }

  function install(){
    patchRunner();
    if(location.pathname!=='/whpp')armRouteGuard(1500);
    global.__CE_QC_V170_ROUTE_ISOLATION_WHPP_PRIORITY__={version:VERSION,repairRoute,armRouteGuard,run:executePriority};
    console.info('[CE-QC][V170_ROUTE_ISOLATION_WHPP_PRIORITY]',VERSION);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,80),{once:true});else setTimeout(install,80);
})(window);
