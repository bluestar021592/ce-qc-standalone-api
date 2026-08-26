(function installV310UnifiedResumeOwner(global){
  if(global.__CE_QC_V310_UNIFIED_RESUME_OWNER__)return;
  const VERSION='2026-08-26-v310-persistent-shopee-resume-owner-v1';
  let resumeBusy=false,lastResumeAt=0,lastSeenState='';
  const text=()=>String(document.getElementById('importPage')?.textContent||'').replace(/\s+/g,' ');
  function state(){
    const t=text();
    const pending=/SHOPEE CN\/VN\s*待处理/i.test(t)&&/尚未全部完成/i.test(t);
    const active=/SHOPEE\s*正在处理/i.test(t)||/SHOPEE CN\/VN\s*处理中/i.test(t);
    const completed=/SHOPEE CN\/VN\s*已完成/i.test(t)&&!/尚未全部完成/i.test(t);
    return{t,pending,active,completed};
  }
  function patchVisibleStatus(){
    const s=state();
    if(!s.active)return;
    document.querySelectorAll('#importPage .status-pill,#importPage span,#importPage b').forEach(node=>{
      if(String(node.textContent||'').replace(/\s+/g,' ').trim()==='SHOPEE CN/VN 待处理'){
        node.textContent='SHOPEE CN/VN 处理中';
        node.dataset.v310ShopeeProcessing='1';
      }
    });
  }
  async function ensureShopeeResume(force=false){
    const s=state();
    const signature=`${s.pending}|${s.active}|${s.completed}`;
    if(signature!==lastSeenState){lastSeenState=signature;console.info('[CE-QC][V310_RESUME_STATE]',signature);}
    patchVisibleStatus();
    if(s.completed||s.active||!s.pending)return false;
    const now=Date.now();
    if(resumeBusy||(!force&&now-lastResumeAt<15000))return false;
    lastResumeAt=now;resumeBusy=true;
    try{
      console.info('[CE-QC][V310_AUTO_RESUME] persistent incomplete SHOPEE state detected; resuming from stored checkpoint.');
      if(typeof global.resumeShopee==='function')await global.resumeShopee();
      else if(typeof global.resumeUnified==='function')await global.resumeUnified();
      return true;
    }catch(error){
      console.warn('[CE-QC][V310_AUTO_RESUME]',error?.message||error);
      return false;
    }finally{
      resumeBusy=false;
      setTimeout(()=>{patchVisibleStatus();ensureShopeeResume(false);},1200);
    }
  }
  function bind(){
    [800,2500,6000].forEach(ms=>setTimeout(()=>ensureShopeeResume(true),ms));
    setInterval(()=>ensureShopeeResume(false),5000);
    document.addEventListener('click',event=>{
      if(event.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query,[data-testid="global-auto-process"]'))setTimeout(()=>ensureShopeeResume(true),900);
    },true);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(()=>ensureShopeeResume(true),300);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  global.__CE_QC_V310_UNIFIED_RESUME_OWNER__={version:VERSION,ensureShopeeResume,patchVisibleStatus,state};
  console.info('[CE-QC][V310_UNIFIED_RESUME_OWNER]',VERSION,'persistent 5s checkpoint-safe SHOPEE resume watchdog; retries after partial scan/track phase stops and updates stale pending badge while backend is active.');
})(window);
