(function installV246CoreUsability(global){
  if(global.__CE_QC_V246_CORE_USABILITY__)return;
  const VERSION='2026-08-20-v246-core-usability-v1';
  const originalFetch=global.fetch.bind(global);
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  // WHPP summary must never spin forever. The existing V132 page already renders
  // explicit errors when fetch rejects, so give that request a hard local budget.
  global.fetch=function v246BoundedFetch(input,init={}){
    const url=typeof input==='string'?input:String(input?.url||'');
    if(!url.includes('/api/v132/whpp-fast-summary')||init?.signal)return originalFetch(input,init);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),7000);
    return originalFetch(input,{...init,signal:controller.signal}).finally(()=>clearTimeout(timer));
  };

  function authMessage(panel,text,kind='info'){
    const node=panel?.querySelector?.('.auth-message');
    if(!node)return;
    node.textContent=String(text||'');
    node.dataset.kind=kind;
    node.style.minHeight='22px';
    node.style.marginTop='8px';
    node.style.fontWeight='600';
    node.style.color=kind==='error'?'#b42318':kind==='success'?'#067647':'#176fe8';
  }
  async function parse(response){
    const text=await response.text();
    try{return text?JSON.parse(text):{};}catch{return {error:text||`HTTP ${response.status}`};}
  }
  global.loginCe=async function v246LoginCe(button){
    const panel=button?.closest?.('.auth-panel')||document.getElementById('ceAuthPanel')?.closest?.('.auth-panel');
    const username=panel?.querySelector?.('.auth-user')?.value?.trim?.()||'';
    const password=panel?.querySelector?.('.auth-password')?.value||'';
    const tenantId=panel?.querySelector?.('.auth-tenant')?.value?.trim?.()||'000000';
    if(!username||!password){authMessage(panel,'请输入CE账号和密码。','error');return;}
    if(button.disabled)return;
    const original=button.textContent;
    button.disabled=true;
    button.textContent='正在登录CE系统…';
    authMessage(panel,'正在连接 CE API，最长等待10秒…');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12_000);
    try{
      const response=await originalFetch('/api/ce-login',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({tenantId,username,password}),signal:controller.signal
      });
      const payload=await parse(response);
      if(!response.ok||payload?.ok===false){
        const detail=payload?.error||payload?.message||payload?.detail||`HTTP ${response.status}`;
        throw new Error(detail);
      }
      authMessage(panel,'CE API 登录成功。','success');
      button.textContent='登录成功';
      try{if(typeof global.refresh==='function')await global.refresh();}catch{}
    }catch(error){
      const text=error?.name==='AbortError'?'CE API 登录超过12秒没有完成，已停止等待。':String(error?.message||error);
      authMessage(panel,text,'error');
      button.disabled=false;
      button.textContent=original;
      return;
    }finally{clearTimeout(timer);}
    setTimeout(()=>{if(button?.isConnected){button.disabled=false;button.textContent=original;}},1200);
  };

  function markWhppNavigation(){
    const button=document.querySelector('.side-link[data-page="whpp"]');
    if(!button||button.dataset.v246Bound)return;
    button.dataset.v246Bound='1';
    button.title='WHPP看板：7秒内必须返回数据、空状态或明确错误';
  }
  const observer=new MutationObserver(markWhppNavigation);
  observer.observe(document.documentElement,{subtree:true,childList:true});
  markWhppNavigation();

  global.__CE_QC_V246_CORE_USABILITY__={version:VERSION,originalFetch};
  console.info('[CE-QC][V246_CORE_USABILITY]',VERSION,'CE login feedback + bounded WHPP refresh active');
})(window);
