import express from 'express';

export const QC11_DIRECT_LOGIN_UI_VERSION='2026-08-21-qc11-direct-5177-login-ui-v1';
const INSTALLED=Symbol.for('ce-qc.qc11-direct-login-ui-installed');
const originalSend=express.response.send;

function upgradeLoginHtml(body=''){
  if(typeof body!=='string'||!body.includes('CE质控系统内部登录')&&!body.includes('创建首个管理员'))return body;
  if(!body.includes('/api/internal-auth/login')&&!body.includes('/api/internal-auth/bootstrap'))return body;
  if(body.includes(QC11_DIRECT_LOGIN_UI_VERSION))return body;
  const bootstrap=body.includes('/api/internal-auth/bootstrap');
  const endpoint=bootstrap?'/api/internal-auth/bootstrap':'/api/internal-auth/login';
  const normalLabel=bootstrap?'创建管理员':'登录';
  const busyLabel=bootstrap?'正在创建管理员…':'正在校验账号…';
  let html=body
    .replace(/<button>(创建管理员|登录)<\/button><div id="error"><\/div>/,`<button id="submit" type="submit">${normalLabel}</button><div id="error" role="status"></div>`)
    .replace('</style>',`button:disabled{opacity:.65;cursor:wait}#error.ok{color:#176fe8}</style>`);
  const script=`<script data-qc11-login-ui="${QC11_DIRECT_LOGIN_UI_VERSION}">(function(){const f=document.getElementById('login'),b=document.getElementById('submit'),e=document.getElementById('error');if(!f||!b||!e)return;const normal=${JSON.stringify(normalLabel)},busy=${JSON.stringify(busyLabel)},endpoint=${JSON.stringify(endpoint)};function msg(text,ok){e.textContent=text||'';e.classList.toggle('ok',Boolean(ok));}async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return{error:t||('HTTP '+r.status)}}}f.addEventListener('submit',async ev=>{ev.preventDefault();if(b.disabled)return;b.disabled=true;b.textContent=busy;msg('正在连接内部认证服务…',true);const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);let success=false;try{const payload=Object.fromEntries(new FormData(f));const r=await fetch(endpoint,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(payload),signal:controller.signal});const j=await parse(r);if(!r.ok||j.ok===false)throw new Error(j.error||j.message||('登录失败 HTTP '+r.status));success=true;b.textContent='登录成功';msg('账号验证通过，正在进入系统…',true);location.replace('/?qc11='+Date.now());}catch(err){msg(err&&err.name==='AbortError'?'登录超过12秒没有响应，主程序未完成认证，请重新打开CE QC。':String(err&&err.message||err||'登录失败'),false);}finally{clearTimeout(timer);if(!success){b.disabled=false;b.textContent=normal;}}});})();</script>`;
  html=html.replace(/<script>document\.getElementById\('login'\)[\s\S]*?<\/script>\s*$/,script);
  return html;
}

if(!express.response[INSTALLED]){
  Object.defineProperty(express.response,INSTALLED,{value:true});
  express.response.send=function qc11DirectLoginUiSend(body){
    try{body=upgradeLoginHtml(body);}catch{}
    return originalSend.call(this,body);
  };
}

console.log('[CE-QC][QC11_LOGIN_UI] direct 5177 login page has bounded 12s browser feedback and cannot remain silently stuck.');

export const __test={upgradeLoginHtml};
