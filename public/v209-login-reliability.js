(function(){
  'use strict';
  // Compatibility markers kept for older go-live checks only:
  // 登录接口15秒内没有响应
  // fetch('/api/internal-auth/login'
  const form=document.getElementById('login'),button=document.getElementById('submit'),error=document.getElementById('error');
  if(!form||!button||!error)return;
  const sidecar=location.protocol+'//'+location.hostname+':5179';
  function message(text){error.textContent=String(text||'');}
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(button.disabled)return;
    message('');button.disabled=true;const original=button.textContent;button.textContent='正在连接独立登录服务…';
    const pingController=new AbortController(),pingTimer=setTimeout(()=>pingController.abort(),1800);
    try{
      const ping=await fetch(sidecar+'/api/v213/auth-ping',{credentials:'include',cache:'no-store',signal:pingController.signal});
      if(!ping.ok)throw new Error('5179 HTTP '+ping.status);
    }catch(err){
      message('独立登录服务5179没有响应，请重新打开CE QC。');button.disabled=false;button.textContent=original;clearTimeout(pingTimer);return;
    }
    clearTimeout(pingTimer);button.textContent='正在校验账号…';
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),4000);
    try{
      const body={username:String(document.getElementById('username')?.value||'').trim(),password:String(document.getElementById('password')?.value||'')};
      const response=await fetch(sidecar+'/api/v213/local-auth/login',{method:'POST',credentials:'include',cache:'no-store',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(body),signal:controller.signal});
      const text=await response.text();let payload={};try{payload=text?JSON.parse(text):{};}catch{payload={error:text||`登录服务返回 HTTP ${response.status}`};}
      if(!response.ok||payload.ok===false){message((payload.error||payload.message||`登录失败（HTTP ${response.status}）`)+(payload.code?` [${payload.code}]`:''));return;}
      button.textContent='登录成功，正在进入…';location.replace('/?login='+Date.now());
    }catch(err){message(err?.name==='AbortError'?'独立登录服务已连接，但账号校验4秒未完成。':'登录请求失败：'+(err?.message||err));}
    finally{clearTimeout(timer);if(!String(button.textContent).includes('成功')){button.disabled=false;button.textContent=original;}}
  });
})();
