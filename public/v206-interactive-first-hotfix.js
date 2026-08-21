(function installV206InteractiveFirstHotfix(global){
  if(global.__CE_QC_V206_INTERACTIVE_FIRST_HOTFIX__)return;
  const VERSION='2026-08-21-v206-interactive-first-hotfix-v1';
  const FORCE_KEY='ce_qc_force_ce_relogin_v206';
  let applying=false;

  function esc(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
  function loginMarkup(){
    return '<label class="field-label">tenantId<input class="auth-tenant" value="000000" autocomplete="off"></label>'+
      '<label class="field-label">username<input class="auth-user" autocomplete="username"></label>'+
      '<label class="field-label">password<input class="auth-password" type="password" autocomplete="current-password"></label>'+
      '<button class="btn primary full" type="button" data-v206-ce-login>登录CE系统</button><div class="auth-message"></div>';
  }
  function forceLoginForms(){
    if(applying)return;
    applying=true;
    try{
      document.querySelectorAll('#ceAuthPanel,#shopeeAuthPanel').forEach(panel=>{
        if(!panel.querySelector('[data-v206-ce-login]'))panel.innerHTML=loginMarkup();
      });
    }finally{applying=false;}
  }
  function beginRelogin(){
    try{sessionStorage.setItem(FORCE_KEY,'1');}catch{}
    forceLoginForms();
    const first=document.querySelector('#ceAuthPanel .auth-user,#shopeeAuthPanel .auth-user');
    first?.focus?.();
  }
  async function submitLogin(button){
    const panel=button.closest('.auth-panel')||button.parentElement;
    const username=panel?.querySelector('.auth-user')?.value?.trim()||'';
    const password=panel?.querySelector('.auth-password')?.value||'';
    const tenantId=panel?.querySelector('.auth-tenant')?.value?.trim()||'000000';
    const message=panel?.querySelector('.auth-message');
    if(!username||!password){if(message)message.textContent='请输入CE账号和密码';return;}
    button.disabled=true;
    button.textContent='登录中…';
    if(message)message.textContent='正在登录CE系统…';
    try{
      const response=await fetch('/api/ce-login',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({tenantId,username,password,grant_type:'password',scope:'all',type:'account'})
      });
      const raw=await response.text();
      let payload={};try{payload=raw?JSON.parse(raw):{};}catch{}
      if(!response.ok||payload?.ok===false)throw new Error(payload?.error||payload?.message||`HTTP ${response.status}`);
      try{sessionStorage.removeItem(FORCE_KEY);}catch{}
      if(message)message.textContent=`CE系统登录成功：${esc(payload?.authStatus?.account||username)}`;
      setTimeout(()=>location.reload(),120);
    }catch(error){
      if(message)message.textContent=`CE登录失败：${error?.message||error}`;
      const pwd=panel?.querySelector('.auth-password');if(pwd)pwd.value='';
      button.disabled=false;button.textContent='登录CE系统';
    }
  }

  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('button');
    if(!button)return;
    const label=String(button.textContent||'').trim();
    if(label==='重新登录'&&button.closest('.auth-panel')){
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
      beginRelogin();
      return;
    }
    if(button.matches('[data-v206-ce-login]')){
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
      void submitLogin(button);
    }
  },true);

  const observer=new MutationObserver(()=>{
    let forced=false;try{forced=sessionStorage.getItem(FORCE_KEY)==='1';}catch{}
    if(forced)queueMicrotask(forceLoginForms);
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});
  let forced=false;try{forced=sessionStorage.getItem(FORCE_KEY)==='1';}catch{}
  if(forced)queueMicrotask(forceLoginForms);

  global.__CE_QC_V206_INTERACTIVE_FIRST_HOTFIX__={version:VERSION,beginRelogin,forceLoginForms};
  console.info('[CE-QC][V206_INTERACTIVE_FIRST_HOTFIX]',VERSION);
})(window);
