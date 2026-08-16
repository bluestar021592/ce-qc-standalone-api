(function installV164UnifiedPauseRouter(global){
  if(global.__CE_QC_V164_UNIFIED_PAUSE_ROUTER__)return;
  const VERSION='2026-08-16-v164-unified-pause-router-v1';

  async function requestJson(url,options={}){
    const response=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});
    const text=await response.text();
    let payload={};
    try{payload=text?JSON.parse(text):{};}catch{}
    if(!response.ok||payload?.ok===false){
      const error=new Error(payload?.error||payload?.message||`HTTP ${response.status}`);
      error.status=response.status;
      error.payload=payload;
      throw error;
    }
    return payload;
  }

  async function progress(type){
    try{return await requestJson(`/api/v33/run-progress?businessType=${encodeURIComponent(type)}`);}
    catch{return null;}
  }

  function statusTarget(){return document.getElementById('ccslRunStatus');}
  function renderPauseMessage(text,kind='warning'){
    const target=statusTarget();
    if(!target)return;
    target.innerHTML=`<span class="status-pill ${kind}">${text}</span><p class="muted">暂停只允许当前已经发出的CE接口批次收尾；不会再进入下一批。</p>`;
  }

  function detectActiveFromDom(){
    const text=String(statusTarget()?.textContent||'');
    if(/SHOPEE[\s\S]*正在处理|SHOPEE[\s\S]*(?:shipment-event|exception-item)/i.test(text))return ['SHOPEE'];
    if(/CCSL[\s\S]*正在处理|CCSL[\s\S]*(?:扫描|轨迹)/i.test(text))return ['CCSL'];
    return [];
  }

  async function pauseType(type){
    const url=type==='SHOPEE'?'/api/shopee/run/pause':'/api/pause';
    return requestJson(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  }

  async function pauseUnified(){
    const button=document.querySelector('button[onclick="pauseUnified()"]');
    const previousText=button?.textContent||'暂停';
    if(button){button.disabled=true;button.textContent='正在暂停…';}
    try{
      const [ccsl,shopee]=await Promise.all([progress('CCSL'),progress('SHOPEE')]);
      let active=[];
      if(shopee?.running===true)active.push('SHOPEE');
      if(ccsl?.running===true)active.push('CCSL');
      if(!active.length)active=detectActiveFromDom();
      if(!active.length){
        renderPauseMessage('当前没有正在运行的任务','muted');
        return;
      }

      renderPauseMessage(`正在向 ${active.join(' + ')} 发送暂停指令`,'warning');
      const results=[];
      for(const type of active){
        try{results.push([type,await pauseType(type)]);}
        catch(error){
          // A task can finish between the progress read and the pause request. That
          // is not a pause failure for the unified control; keep checking the other
          // active pipeline instead of routing the click to the wrong business.
          if(Number(error?.status)!==409)throw error;
          results.push([type,{ok:true,alreadyFinished:true}]);
        }
      }
      renderPauseMessage(`${active.join(' + ')} 暂停指令已生效`,'warning');
      setTimeout(()=>{ try{ if(typeof global.refresh==='function') global.refresh(); }catch{} },150);
    }catch(error){
      console.error('[CE-QC][V164] unified pause failed',error);
      renderPauseMessage(`暂停失败：${String(error?.message||error)}`,'danger');
    }finally{
      setTimeout(()=>{if(button){button.disabled=false;button.textContent=previousText;}},800);
    }
  }

  // The legacy unified button always called pauseProcess(), which only targets
  // CCSL. Replace only the unified entry point; the dedicated CCSL/SHOPEE buttons
  // keep their existing functions.
  global.pauseUnified=pauseUnified;
  global.__CE_QC_V164_UNIFIED_PAUSE_ROUTER__={version:VERSION,progress,pauseType};
  console.info('[CE-QC][V164_UNIFIED_PAUSE_ROUTER]',VERSION);
})(window);
