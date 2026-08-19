(function(){
  'use strict';
  const form=document.getElementById('login'),button=document.getElementById('submit'),error=document.getElementById('error');
  if(!form||!button||!error)return;
  function message(text){error.textContent=String(text||'');}
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(button.disabled)return;
    message('');button.disabled=true;const original=button.textContent;button.textContent='正在登录…';
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
    try{
      const body={username:String(document.getElementById('username')?.value||'').trim(),password:String(document.getElementById('password')?.value||'')};
      const response=await fetch('/api/internal-auth/login',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(body),signal:controller.signal});
      const text=await response.text();let payload={};try{payload=text?JSON.parse(text):{};}catch{payload={error:text||`登录接口返回 HTTP ${response.status}`};}
      if(!response.ok||payload.ok===false){message(payload.error||payload.message||`登录失败（HTTP ${response.status}）`);return;}
      button.textContent='登录成功，正在进入…';
      location.replace('/?login='+Date.now());
    }catch(err){
      message(err?.name==='AbortError'?'登录接口15秒内没有响应，请重新打开CE QC后再试。':`登录请求失败：${err?.message||err}`);
    }finally{
      clearTimeout(timer);
      if(!String(button.textContent).includes('成功')){button.disabled=false;button.textContent=original;}
    }
  });
})();
