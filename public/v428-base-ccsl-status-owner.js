(function installV428BaseCcslStatusOwner(global){
  if(global.__CE_QC_V428_BASE_CCSL_STATUS_OWNER__)return;

  const VERSION='2026-09-05-v428-retire-base-ccsl-status-writer-v1';
  const original=global.runStatusMarkup;
  if(typeof original!=='function'){
    console.warn('[CE-QC][V428_BASE_CCSL_STATUS_OWNER] runStatusMarkup unavailable; owner retirement not installed');
    return;
  }

  function activeV67Ccsl(){
    const stage=global.__CE_QC_UNIFIED_RUN_STAGE__;
    return Boolean(stage?.owner==='V67'&&stage.active===true&&String(stage.type||'').toUpperCase()==='CCSL');
  }

  function v168OwnsIdleStatus(){
    return Boolean(global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__)&&!activeV67Ccsl();
  }

  function unconfirmedMarkup(){
    return '<div data-testid="v428-base-status-owner-guard" style="padding:8px 10px;border-radius:7px;background:#fff8e8;border:1px solid #f4d79a;color:#916000;line-height:1.5">'
      +'<span class="status-pill warning">状态确认中</span>'
      +'<div style="margin-top:6px">当前阶段：状态确认中</div>'
      +'<small>当前日报状态尚未确认，基础旧状态不会再覆盖七业务状态真值。</small>'
      +'</div>';
  }

  const wrapped=function(state){
    if(v168OwnsIdleStatus()){
      const owner=global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__;
      const truth=owner?.lastTruth;
      const stages=Array.isArray(truth?.stages)?truth.stages:[];
      const unconfirmed=!truth||truth.statusFresh===false||stages.some(stage=>stage?.statusFresh===false||stage?.state==='unknown');
      if(unconfirmed)return unconfirmedMarkup();
      const node=document.getElementById('ccslRunStatus');
      if(node?.innerHTML)return node.innerHTML;
    }
    return original.apply(this,arguments);
  };
  wrapped.__v428BaseCcslStatusOwner=true;
  wrapped.__v428Original=original;
  global.runStatusMarkup=wrapped;

  global.__CE_QC_V428_BASE_CCSL_STATUS_OWNER__={
    version:VERSION,
    activeV67Ccsl,
    v168OwnsIdleStatus,
    unconfirmedMarkup
  };

  console.info('[CE-QC][V428_BASE_CCSL_STATUS_OWNER]',VERSION,'base app.js runStatusMarkup can no longer repaint stale CCSL completion while V168 owns idle status; active V67 CCSL still delegates to the live 350/50 renderer.');
})(window);
