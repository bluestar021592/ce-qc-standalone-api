(function installV225AuthBootstrapGuard(global){
  'use strict';
  if(global.__CE_QC_V225_AUTH_BOOTSTRAP_GUARD__)return;
  const VERSION='2026-08-19-v225-auth-bootstrap-guard-v1';
  const nativeFetch=global.fetch.bind(global);
  let redirectScheduled=false;

  function sameOriginApi(input){
    try{
      const raw=typeof input==='string'?input:(input instanceof URL?input.href:String(input?.url||''));
      const url=new URL(raw,global.location.origin);
      return url.origin===global.location.origin?url.pathname:'';
    }catch{return'';}
  }
  function authFailure(payload,status){
    const code=String(payload?.code||'').toUpperCase();
    return Number(status)===401&&(code==='INTERNAL_AUTH_REQUIRED'||payload?.reloginRequired||/登录已过期|重新登录|sign-in is required/i.test(String(payload?.error||payload?.message||'')));
  }
  function sessionMissing(payload){
    const user=payload?.session?.user||payload?.user||null;
    if(!user)return false;
    return !(user.id||user.username||user.email||user.displayName);
  }
  function redirectToFreshAuth(reason){
    if(redirectScheduled)return;
    redirectScheduled=true;
    try{sessionStorage.setItem('ce_v225_auth_redirect_reason',String(reason||'AUTH_REQUIRED'));}catch{}
    setTimeout(()=>{
      const url=new URL('/',global.location.origin);
      url.searchParams.set('internalAuth',String(Date.now()));
      url.searchParams.set('v225','1');
      global.location.replace(url.pathname+url.search);
    },0);
  }

  global.fetch=async function v225AuthAwareFetch(input,init){
    const path=sameOriginApi(input);
    const response=await nativeFetch(input,init);
    if(path!=='/api/bootstrap'&&path!=='/api/session')return response;
    let payload={};
    try{payload=await response.clone().json();}catch{}
    if(authFailure(payload,response.status))redirectToFreshAuth(payload?.code||`HTTP_${response.status}`);
    else if(response.ok&&path==='/api/bootstrap'&&sessionMissing(payload))redirectToFreshAuth('EMPTY_SESSION');
    return response;
  };

  global.__CE_QC_V225_AUTH_BOOTSTRAP_GUARD__={version:VERSION,redirectToFreshAuth};
  console.info('[CE-QC][V225_AUTH_BOOTSTRAP_GUARD]',VERSION);
})(window);
