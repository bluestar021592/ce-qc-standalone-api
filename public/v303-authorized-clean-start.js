(function installV303AuthorizedCleanStart(global){
  if(global.__CE_QC_V303_AUTHORIZED_CLEAN_START__)return;
  const VERSION='2026-08-25-v303-authorized-clean-start-ui-v1';
  const AUTHORIZATION='V303_USER_AUTHORIZED_FULL_CLEAN_20260825';
  let running=false;

  function overlay(message,sub='请保持APP打开，完成后会自动刷新。'){
    let node=document.getElementById('v303CleanStartOverlay');
    if(!node){
      node=document.createElement('div');node.id='v303CleanStartOverlay';
      node.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#f7faff;display:grid;place-items:center;font-family:Microsoft YaHei,system-ui,sans-serif;color:#17324d';
      node.innerHTML='<div style="width:min(560px,calc(100% - 48px));background:#fff;border:1px solid #d9e6f5;border-radius:10px;padding:34px;box-shadow:0 18px 48px #17324d20;text-align:center"><div style="font-size:22px;font-weight:700;margin-bottom:12px" id="v303CleanTitle"></div><div style="font-size:14px;color:#61758a" id="v303CleanSub"></div><div style="height:4px;background:#e9f1fa;margin-top:24px;overflow:hidden;border-radius:4px"><i style="display:block;width:45%;height:100%;background:#126ee8;animation:v303move 1.1s ease-in-out infinite alternate"></i></div></div>';
      const style=document.createElement('style');style.textContent='@keyframes v303move{from{transform:translateX(-20%)}to{transform:translateX(140%)}}';document.head.appendChild(style);
      document.body.appendChild(node);
    }
    node.querySelector('#v303CleanTitle').textContent=message;
    node.querySelector('#v303CleanSub').textContent=sub;
    node.hidden=false;
    return node;
  }
  function removeOverlay(){document.getElementById('v303CleanStartOverlay')?.remove();}

  async function jsonFetch(url,options={}){
    const response=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});
    let data={};try{data=await response.json();}catch{}
    if(!response.ok||data.ok===false){const error=new Error(data.error||`HTTP ${response.status}`);error.status=response.status;throw error;}
    return data;
  }

  async function run(){
    if(running)return;running=true;
    try{
      const session=await jsonFetch('/api/session');
      if(String(session?.user?.role||'').toUpperCase()!=='ADMIN'){running=false;return;}
      overlay('正在完成这次更新并清空旧业务数据');
      const result=await jsonFetch('/api/v303/authorized-clean-start',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({authorization:AUTHORIZATION})
      });
      if(result?.alreadyDone){removeOverlay();running=false;return;}
      if(result?.cleared){
        try{localStorage.clear();sessionStorage.clear();}catch{}
        overlay('旧业务数据已清空，正在重新打开APP',result.vacuum&&String(result.vacuum).startsWith('warning:')?'业务数据已清空；磁盘空间回收会由SQLite继续整理。':'数据库空间已回收，新的资料将按C/D分盘保存。');
        setTimeout(()=>location.replace('/'),900);
        return;
      }
      removeOverlay();running=false;
    }catch(error){
      console.error('[CE-QC][V303_CLEAN_START]',error);
      const node=overlay('一次性清空正在等待后台完成',`后台返回：${error?.message||error}。系统会自动重试，不需要手动操作。`);
      setTimeout(()=>{node?.remove();running=false;void run();},5000);
    }
  }

  global.__CE_QC_V303_AUTHORIZED_CLEAN_START__={version:VERSION,run};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void run(),{once:true});else void run();
  console.info('[CE-QC][V303_CLEAN_START_UI]',VERSION,'authenticated ADMIN app load performs the single authorized business-data reset once, then reloads into a clean workspace.');
})(window);
