(function installV141WhppRetryIsolationUi(global){
  if(global.__CE_QC_V141_WHPP_RETRY_ISOLATION_UI__)return;
  global.__CE_QC_V141_WHPP_RETRY_ISOLATION_UI__=true;
  const VERSION='2026-08-16-v141-whpp-retry-isolation-ui-v1';
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');

  function statusNode(){return document.getElementById('ccslRunStatus');}
  function renderPartial(retry){
    const count=Math.max(0,Number(retry||0));
    if(!count)return;
    const node=statusNode();
    if(node)node.innerHTML=`<span class="status-pill warning">WHPP尚未完全结束</span><p>当前快照已保存 · <b>${fmt(count)}票</b>接口待重试，断点已保留。</p><p class="muted">点击“继续处理”只重试这 ${fmt(count)} 票；已成功票不会重新查询，历史跨日也不会进入当日全自动。</p>`;
  }

  document.addEventListener('ce-qc-run-complete',event=>{
    const retry=Number(event?.detail?.whppRetryPending||0);
    if(retry>0)setTimeout(()=>renderPartial(retry),0);
  });

  // The older V135 listener may repaint its shorter legacy sentence after a refresh.
  // Reconcile once from the authoritative WHPP summary when the import page opens.
  async function reconcile(){
    if(location.pathname!=='/import')return;
    try{
      const response=await fetch('/api/v132/whpp-fast-summary',{cache:'no-store',credentials:'same-origin'});
      if(!response.ok)return;
      const value=await response.json();
      const retry=Number(value?.metrics?.retryPending||0);
      if(value?.completed&&retry>0)renderPartial(retry);
    }catch{}
  }
  document.addEventListener('click',event=>{if(event.target?.closest?.('[data-page="import"],.side-link[data-path="/import"]'))setTimeout(reconcile,150);},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(reconcile,180),{once:true});else setTimeout(reconcile,180);
  console.info('[CE-QC][V141_WHPP_RETRY_ISOLATION_UI]',VERSION);
})(window);
