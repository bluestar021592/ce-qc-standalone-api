(function installV252SettingsRecovery(global){
  if(global.__CE_QC_V252_SETTINGS_RECOVERY__)return;
  const VERSION='2026-08-21-v253-settings-spa-activation-v1';
  const $=selector=>document.querySelector(selector);
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let lastShell=null;
  let shellPromise=null;
  let lastShellAt=0;
  async function parse(response){const text=await response.text();try{return text?JSON.parse(text):{};}catch{return{error:text||`HTTP ${response.status}`};}}
  async function timedFetch(url,options={},timeoutMs=4000){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'});}finally{clearTimeout(timer);}}
  function ensureAuthMessage(panel){let node=panel?.querySelector?.('.auth-message');if(node)return node;node=document.createElement('div');node.className='auth-message';node.style.cssText='min-height:24px;margin-top:8px;font-weight:600;color:#176fe8';const button=[...(panel?.querySelectorAll?.('button')||[])].find(b=>/登录CE系统/.test(b.textContent||''));(button?.parentNode||panel)?.appendChild(node);return node;}
  function message(panel,text,kind='info'){const node=ensureAuthMessage(panel);if(!node)return;node.textContent=String(text||'');node.style.color=kind==='error'?'#b42318':kind==='success'?'#067647':'#176fe8';}
  function renderNetwork(network={}){const target=$('#networkAccessCards');if(!target)return;const rows=[['当前访问',network.currentOrigin||location.origin],['同一局域网访问',network.lanUrl||'未检测到有效局域网IPv4'],['不同网络/外地访问',network.publicUrl||(network.publicConfigured?'已配置':'尚未配置公网地址')]];target.innerHTML=`<div data-v253-settings-ready="1" class="access-address-list">${rows.map(([label,url])=>`<div><span>${esc(label)}</span><b>${esc(url)}</b></div>`).join('')}</div><p class="operation-status">系统设置已就绪，不再等待看板主数据加载。</p>`;}
  function renderUser(user={}){const name=user.displayName||user.username||user.email||'本地用户';const role=user.role||'VIEWER';const summary=$('#currentAccountSummary');if(summary)summary.textContent=`${name} · ${role}`;const headerName=$('#headerUserName');if(headerName)headerName.textContent=name;const headerRole=$('#headerUserRole');if(headerRole)headerRole.textContent=`${user.department||'质控部'} · ${role}`;document.querySelectorAll('.admin-only').forEach(el=>{el.hidden=role!=='ADMIN';});}
  function renderCeAuth(auth={}){const panel=$('#settingsPage .auth-panel');if(!panel)return;if(auth.loggedIn)message(panel,`CE API 已登录：${auth.account||'已连接'}${auth.expiresAt?` · 有效至 ${String(auth.expiresAt).replace('T',' ').slice(0,19)}`:''}`,'success');}
  function applyShell(payload){if(!payload)return;renderUser(payload.user||{});renderNetwork(payload.network||{});renderCeAuth(payload.ceAuth||{});const top=$('#topRangeStatus');if(top)top.textContent='系统设置已就绪 · 看板数据后台加载，不影响设置';}
  async function loadShell(force=false){
    if(shellPromise)return shellPromise;
    if(!force&&lastShell&&Date.now()-lastShellAt<5000){applyShell(lastShell);return lastShell;}
    shellPromise=(async()=>{try{const r=await timedFetch('/api/v252/settings-shell',{credentials:'same-origin',headers:{accept:'application/json'}},3500);const p=await parse(r);if(!r.ok||p.ok===false)throw new Error(p.error||`HTTP ${r.status}`);lastShell=p;lastShellAt=Date.now();applyShell(p);return p;}catch(error){const target=$('#networkAccessCards');if(target)target.innerHTML=`<div data-v253-settings-ready="1" class="operation-status" style="color:#b42318">设置状态读取失败：${esc(error?.message||error)}</div>`;return null;}finally{shellPromise=null;}})();
    return shellPromise;
  }
  async function loginCeV252(button){const panel=button?.closest?.('.auth-panel')||$('#settingsPage .auth-panel');const username=panel?.querySelector?.('.auth-user')?.value?.trim?.()||'';const password=panel?.querySelector?.('.auth-password')?.value||'';const tenantId=panel?.querySelector?.('.auth-tenant')?.value?.trim?.()||'000000';if(!username||!password){message(panel,'请输入CE账号和密码。','error');return;}if(button.disabled)return;const original=button.textContent;button.disabled=true;button.textContent='正在登录CE系统…';message(panel,'正在直接连接CE登录接口，最长等待12秒…');try{const r=await timedFetch('/api/v252/ce-login',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({tenantId,username,password})},12000);const p=await parse(r);if(!r.ok||p.ok===false)throw new Error((p.error||p.message||`HTTP ${r.status}`)+(p.code?` [${p.code}]`:''));message(panel,`CE API 登录成功：${p.authStatus?.account||username}`,'success');button.textContent='登录成功';lastShell=null;void loadShell(true);setTimeout(()=>{if(button.isConnected){button.disabled=false;button.textContent=original;}},1200);}catch(error){message(panel,error?.name==='AbortError'?'CE API 登录超过12秒没有完成。':String(error?.message||error),'error');button.disabled=false;button.textContent=original;}}
  function bindCeButton(){const panel=$('#settingsPage .auth-panel');if(!panel)return;const button=[...panel.querySelectorAll('button')].find(b=>/登录CE系统/.test(b.textContent||''));if(!button||button.dataset.v253Bound)return;button.dataset.v253Bound='1';button.removeAttribute('onclick');button.addEventListener('click',event=>{event.preventDefault();void loginCeV252(button);});ensureAuthMessage(panel);}
  function settingsVisible(){const page=$('#settingsPage');return location.pathname==='/settings'||Boolean(page&&!page.hidden);}
  function activateSettings(force=false){bindCeButton();if(!settingsVisible())return;if(lastShell&&!$('#networkAccessCards [data-v253-settings-ready="1"]'))applyShell(lastShell);void loadShell(force);}
  function installNavigationHooks(){
    for(const name of ['pushState','replaceState']){const original=history[name];if(original.__v253Wrapped)continue;const wrapped=function(...args){const result=original.apply(this,args);setTimeout(()=>activateSettings(true),0);return result;};wrapped.__v253Wrapped=true;history[name]=wrapped;}
    global.addEventListener('popstate',()=>setTimeout(()=>activateSettings(true),0));
  }
  function boot(){bindCeButton();installNavigationHooks();void loadShell(true);const observer=new MutationObserver(()=>{bindCeButton();if(settingsVisible()&&lastShell&&!$('#networkAccessCards [data-v253-settings-ready="1"]'))applyShell(lastShell);});observer.observe(document.documentElement,{subtree:true,childList:true});setTimeout(()=>activateSettings(true),80);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  global.__CE_QC_V252_SETTINGS_RECOVERY__={version:VERSION,loadShell,loginCeV252,activateSettings};
  console.info('[CE-QC][V253_SETTINGS_RECOVERY]',VERSION,'settings fast path survives SPA navigation and background dashboard rerenders');
})(window);
