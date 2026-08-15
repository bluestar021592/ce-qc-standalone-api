(function installResilientRunGuardV67(global) {
  if (global.__CE_QC_V67_RESILIENT_RUN_GUARD__) return;

  const VERSION = '2026-08-15-v136-explicit-foreground-runner-v6';
  let busy = false;

  async function jsonFetch(url, options = {}) {
    let response;
    try {
      response = await fetch(url, { cache:'no-store', credentials:'same-origin', ...options });
    } catch (cause) {
      const error = new Error('与后台连接中断'); error.code='NETWORK_CONNECTION_INTERRUPTED'; error.cause=cause; throw error;
    }
    const text = await response.text(); let payload={}; try{payload=text?JSON.parse(text):{};}catch{}
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || payload.message || `HTTP ${response.status}`);
      error.code = payload.code || `HTTP_${response.status}`; error.status=response.status; error.payload=payload; throw error;
    }
    return payload;
  }
  function stateOf(payload){return payload?.state||payload||{};}
  function completed(payload){
    const state=stateOf(payload);const status=String(payload?.snapshotStatus||state?.snapshotStatus||(payload?.completed?'COMPLETED':'')).toUpperCase();
    const runStatus=String(state?.currentRun?.status||state?.lastRunSummary?.runStatus||state?.lastRun?.runStatus||payload?.runStatus||'').toUpperCase();
    const phase=String(state?.processing?.phase||'').trim();
    return status==='COMPLETED'||['FINISHED','COMPLETED','COMPLETED_WITH_RETRY'].includes(runStatus)||/^(完成|处理完成)$/.test(phase);
  }
  function hasReport(payload){const state=stateOf(payload);return Boolean(state?.reportDate&&state?.dailyReportReady!==false);}
  function isAuth(error){const status=Number(error?.status||0),code=String(error?.code||'').toUpperCase(),message=String(error?.message||'');return [401,403].includes(status)||['401','403','AUTH_REQUIRED'].includes(code)||/未授权|unauthorized|登录.*失效|token.*(?:过期|expired|invalid)/i.test(message);}
  function alreadyDone(error){return String(error?.code||'')==='RUN_ALREADY_COMPLETED'||/已经完成|already\s*(?:completed|finished)/i.test(String(error?.message||''));}
  function noReport(error){return /REPORT.*MISSING|NO_DAILY_REPORT/i.test(String(error?.code||''))||/未导入.*日报|没有.*日报/i.test(String(error?.message||''));}
  function statusNode(){return document.getElementById('ccslRunStatus');}
  function runButton(){return document.querySelector('[data-testid="global-auto-process"]');}
  function setStatus(text,level='warning'){const node=statusNode();if(node)node.innerHTML=`<span class="status-pill ${level}">${String(text||'')}</span>`;}
  function setBusy(value,text=''){busy=Boolean(value);const button=runButton();if(button){button.disabled=busy;button.textContent=busy?(text||'当日日报处理中…'):'开始全自动处理';}}

  async function readStates(){
    const results=await Promise.allSettled([jsonFetch('/api/state?compact=1'),jsonFetch('/api/shopee/state?compact=1')]);
    return {CCSL:results[0].status==='fulfilled'?results[0].value:{},SHOPEE:results[1].status==='fulfilled'?results[1].value:{}};
  }
  async function runStage(stage,mode,state){
    if(!hasReport(state))return {label:stage.label,ok:true,skipped:true};
    if(mode==='start'&&completed(state))return {label:stage.label,ok:true,skipped:true,alreadyCompleted:true};
    const url=mode==='resume'?stage.resume:stage.start;
    setStatus(`${stage.label}：正在处理当日日报。历史OPEN遗留由后台每2小时独立刷新。`);
    try{
      const result=await jsonFetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      return {label:stage.label,ok:true,result};
    }catch(error){
      if(alreadyDone(error)||noReport(error))return {label:stage.label,ok:true,skipped:true};
      if(isAuth(error))throw error;
      return {label:stage.label,ok:false,error:error?.message||String(error),code:error?.code||'',retryRequired:Boolean(error?.payload?.retryRequired)};
    }
  }

  async function execute(mode='start'){
    if(busy)return {ok:false,busy:true};
    setBusy(true,'正在检查当日日报…');const results=[];
    try{
      const states=await readStates();
      // V136 base runner owns the six non-WHPP business classifications. WHPP is
      // deliberately handled once by the final V135/V136 controller afterwards.
      const stages=[
        {key:'CCSL',label:'CE + CEAF + TBKH + ALI1688',start:'/api/run/start',resume:'/api/run/resume'},
        {key:'SHOPEE',label:'SHOPEE CN + SHOPEE VN',start:'/api/shopee/run/start',resume:'/api/shopee/run/resume'}
      ];
      for(const stage of stages)results.push(await runStage(stage,mode,states[stage.key]||{}));
      const failed=results.filter(item=>item.ok===false);
      if(failed.length)setStatus(`${failed.map(item=>item.label).join('、')}仍有当日失败票；断点已保存。请点击“继续处理”再次重试，不会自动重跑历史数据。`,'warning');
      else setStatus('六个非WHPP业务的当日日报已处理；正在校验WHPP本土。','success');
      return {ok:failed.length===0,results};
    }catch(error){
      setStatus(isAuth(error)?'CE登录已失效，请重新登录后点击继续处理；断点不会丢失。':`处理失败：${String(error.message||error)}。不会自动续跑，请确认后点击继续处理。`,'danger');
      return {ok:false,error:error?.message||String(error),results};
    }finally{setBusy(false);}
  }
  function install(){global.runUnified=()=>execute('start');global.resumeUnified=()=>execute('resume');global.__CE_QC_V67_RESILIENT_RUN_GUARD__={version:VERSION,run:execute,autoRetry:false,foregroundPolicy:'CURRENT_REPORT_ONLY'};console.info('[CE-QC][V136_EXPLICIT_FOREGROUND_RUNNER]',VERSION);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,0),{once:true});else setTimeout(install,0);
})(window);