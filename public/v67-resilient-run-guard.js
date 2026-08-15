(function installResilientRunGuardV67(global) {
  if (global.__CE_QC_V67_RESILIENT_RUN_GUARD__) return;

  const VERSION = '2026-08-15-v148-unified-processing-evidence-v9';
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
  function noReport(error){return /REPORT.*MISSING|NO_DAILY_REPORT|EMPTY_DAILY_REPORT/i.test(String(error?.code||''))||/未导入.*日报|没有.*日报|有效运单数为0|请先导入当日日报/i.test(String(error?.message||''));}
  function statusNode(){return document.getElementById('ccslRunStatus');}
  function runButton(){return document.querySelector('[data-testid="global-auto-process"]');}
  function setStatus(text,level='warning'){const node=statusNode();if(node)node.innerHTML=`<span class="status-pill ${level}">${String(text||'')}</span>`;}
  function setBusy(value,text=''){busy=Boolean(value);const button=runButton();if(button){button.disabled=busy;button.textContent=busy?(text||'当日日报处理中…'):'开始全自动处理';}}
  function isoDate(value){const v=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:'';}
  function n(value){const parsed=Number(value);return Number.isFinite(parsed)?parsed:0;}
  function fmt(value){return n(value).toLocaleString('zh-CN');}

  async function readStates(){
    const results=await Promise.allSettled([
      jsonFetch('/api/state?compact=1'),
      jsonFetch('/api/shopee/state?compact=1'),
      jsonFetch('/api/import/unified-latest?compact=1')
    ]);
    const states={
      CCSL:results[0].status==='fulfilled'?results[0].value:{},
      SHOPEE:results[1].status==='fulfilled'?results[1].value:{},
      UNIFIED:results[2].status==='fulfilled'?results[2].value:null
    };
    const unifiedDate=isoDate(states.UNIFIED?.import?.reportDate);
    const shopeeStateDate=isoDate(stateOf(states.SHOPEE)?.reportDate);
    const reportDate=unifiedDate||shopeeStateDate;
    states.CURRENT_REPORT_DATE=reportDate;
    try{
      const q=reportDate?`?reportDate=${encodeURIComponent(reportDate)}`:'';
      states.READINESS=await jsonFetch(`/api/v146/processing-readiness${q}`);
    }catch(error){
      console.warn('[CE-QC][V148_RUNNER] processing readiness unavailable, using legacy state',error);
      states.READINESS=null;
    }
    return states;
  }
  async function runStage(stage,mode,state,readiness,currentReportDate){
    if(stage.key==='SHOPEE'){
      if(readiness){
        if(!readiness.imported||n(readiness.sourceCount)===0)return {label:stage.label,ok:true,skipped:true,noRows:true};
        if(mode==='start'&&readiness.processingComplete)return {label:stage.label,ok:true,skipped:true,alreadyCompleted:true};
      }else if(!hasReport(state))return {label:stage.label,ok:true,skipped:true};
    }else{
      const stateDate=isoDate(stateOf(state)?.reportDate);
      if(currentReportDate&&stateDate&&stateDate!==currentReportDate)return {label:stage.label,ok:true,skipped:true,olderState:true};
      if(!hasReport(state))return {label:stage.label,ok:true,skipped:true};
      if(mode==='start'&&completed(state))return {label:stage.label,ok:true,skipped:true,alreadyCompleted:true};
    }
    const url=mode==='resume'?stage.resume:stage.start;
    setStatus(`${stage.label}：正在处理 ${currentReportDate||'当日'} 日报，请保持页面开启。`);
    try{
      const result=await jsonFetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reportDate:currentReportDate||''})});
      return {label:stage.label,ok:true,result};
    }catch(error){
      if(alreadyDone(error)||noReport(error))return {label:stage.label,ok:true,skipped:true};
      if(isAuth(error))throw error;
      return {label:stage.label,ok:false,error:error?.message||String(error),code:error?.code||'',retryRequired:Boolean(error?.payload?.retryRequired)};
    }
  }

  function renderEvidenceStatus(reportDate,sh,failed=[]){
    if(failed.length){
      setStatus(`${failed.map(item=>item.label).join('、')}仍有当日失败票；断点已保存。请点击“继续处理”再次重试。`,'warning');
      return;
    }
    if(!sh||n(sh.sourceCount)===0){
      setStatus(`${reportDate} 当日日报处理完成；SHOPEE当日0票，已自动跳过。`,'success');
      return;
    }
    const source=n(sh.sourceCount),apiScan=n(sh.apiScanCount),locks=n(sh.podLockCount),covered=n(sh.scanCoveredCount),finals=n(sh.finalCount);
    if(!sh.processingComplete){
      setStatus(`${reportDate} SHOPEE尚未完成：处理覆盖 ${fmt(covered)} / ${fmt(source)}（API扫描 ${fmt(apiScan)}，POD锁复用 ${fmt(locks)}），最终结果 ${fmt(finals)} / ${fmt(source)}。`,'warning');
      return;
    }
    const lockNote=locks>0?`，POD锁复用 ${fmt(locks)}票（按规则不重复查已POD）`:'';
    const unknownTime=n(sh.podLockUnknownTimeCount);
    const timeNote=unknownTime>0?`；其中 ${fmt(unknownTime)} 票POD锁缺少签收时间，只能闭环，不能硬算1/2/3派`:'';
    setStatus(`${reportDate} SHOPEE处理完成：日报 ${fmt(source)}票，API扫描 ${fmt(apiScan)}票${lockNote}，最终结果 ${fmt(finals)}票${timeNote}。`,'success');
  }

  async function execute(mode='start'){
    if(busy)return {ok:false,busy:true};
    setBusy(true,'正在检查当前导入日报…');const results=[];
    try{
      const states=await readStates();
      const currentReportDate=states.CURRENT_REPORT_DATE;
      if(!currentReportDate){setStatus('当前没有已导入日报，请先导入综合日报。','warning');return {ok:false,noReport:true};}
      const readiness=states.READINESS?.SHOPEE||null;
      if(readiness&&n(readiness.sourceCount)>0&&!readiness.processingComplete){
        setStatus(`${currentReportDate} SHOPEE待处理：覆盖 ${fmt(readiness.scanCoveredCount)} / ${fmt(readiness.sourceCount)}（API扫描 ${fmt(readiness.apiScanCount)}，POD锁 ${fmt(readiness.podLockCount)}），正在启动处理…`,'warning');
      }
      const stages=[
        {key:'CCSL',label:'CE + CEAF + TBKH + ALI1688',start:'/api/run/start',resume:'/api/run/resume'},
        {key:'SHOPEE',label:'SHOPEE CN + SHOPEE VN',start:'/api/shopee/run/start',resume:'/api/shopee/run/resume'}
      ];
      for(const stage of stages)results.push(await runStage(stage,mode,states[stage.key]||{},stage.key==='SHOPEE'?readiness:null,currentReportDate));
      const failed=results.filter(item=>item.ok===false);
      let after=null;
      try{after=await jsonFetch(`/api/v146/processing-readiness?reportDate=${encodeURIComponent(currentReportDate)}&_=${Date.now()}`);}catch{}
      global.__CE_QC_LAST_PROCESSING_EVIDENCE__={reportDate:currentReportDate,at:Date.now(),payload:after};
      // Refresh page models first; legacy renderCcslOperations writes the zero-ticket
      // CCSL status into the unified panel. Re-apply the canonical combined status
      // after that refresh so users never see the misleading "0/0 completed" again.
      try{if(typeof global.refresh==='function')await global.refresh();}catch{}
      renderEvidenceStatus(currentReportDate,after?.SHOPEE,failed);
      return {ok:failed.length===0,results,readiness:states.READINESS,after,reportDate:currentReportDate};
    }catch(error){
      setStatus(isAuth(error)?'CE登录已失效，请重新登录后点击继续处理；断点不会丢失。':`处理失败：${String(error.message||error)}。请确认后点击继续处理。`,'danger');
      return {ok:false,error:error?.message||String(error),results};
    }finally{setBusy(false);}
  }
  function install(){global.runUnified=()=>execute('start');global.resumeUnified=()=>execute('resume');global.__CE_QC_V67_RESILIENT_RUN_GUARD__={version:VERSION,run:execute,autoRetry:false,foregroundPolicy:'LATEST_UNIFIED_REPORT_DATE_PLUS_API_OR_POD_LOCK_EVIDENCE'};console.info('[CE-QC][V148_UNIFIED_PROCESSING_EVIDENCE]',VERSION);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,0),{once:true});else setTimeout(install,0);
})(window);
