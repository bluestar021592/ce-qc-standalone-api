(function installV580VisibleShellRecovery(global){
  if(global.__CE_QC_V580_VISIBLE_SHELL__)return;
  const VERSION='2026-09-22-v580-visible-shell-recovery-v1';
  const doc=global.document;

  function pageFromPath(){
    const p=String(global.location&&global.location.pathname||'/').toLowerCase().replace(/\/+$/,'')||'/';
    const map={'/':'homePage','/ce':'ccslPage','/ceaf':'ccslPage','/tbkh':'ccslPage','/ali1688':'ccslPage','/whpp':'shopeePage','/shopeecn':'shopeePage','/shopeevn':'shopeePage','/import':'importPage','/tracking':'trackPage','/exceptions':'exceptionsPage','/reports':'reportsPage','/data-management':'data-managementPage','/settings':'settingsPage','/logs':'logsPage'};
    return map[p]||'homePage';
  }
  function forceVisible(node){
    if(!node)return;
    try{
      node.hidden=false;
      node.removeAttribute&&node.removeAttribute('aria-hidden');
      const s=node.style;
      if(s){
        for(const key of ['display','visibility','opacity','transform','clipPath','filter']) s.removeProperty(key);
        s.setProperty('visibility','visible','important');
        s.setProperty('opacity','1','important');
      }
    }catch(_){}
  }
  function recover(reason){
    try{
      const body=doc.body;
      if(!body)return false;
      const appBody=doc.querySelector('.app-body');
      const topbar=doc.querySelector('.topbar');
      const main=doc.querySelector('.main-content');
      forceVisible(appBody);forceVisible(topbar);forceVisible(main);
      if(appBody&&appBody.style){
        appBody.style.setProperty('min-height','100vh','important');
        appBody.style.setProperty('display','flex','important');
      }
      if(topbar&&topbar.style) topbar.style.setProperty('display','flex','important');
      if(main&&main.style) main.style.setProperty('display','block','important');

      const pages=[...doc.querySelectorAll('.app-page')];
      const target=doc.getElementById(pageFromPath())||doc.getElementById('homePage');
      const anyVisible=pages.some(n=>!n.hidden&&global.getComputedStyle(n).display!=='none'&&global.getComputedStyle(n).visibility!=='hidden');
      if(!anyVisible&&target) forceVisible(target);

      const br=appBody&&appBody.getBoundingClientRect?appBody.getBoundingClientRect():null;
      if(br&&(br.width<80||br.left>=global.innerWidth-20)){
        appBody.style.setProperty('margin-left','220px','important');
        appBody.style.setProperty('width','calc(100% - 220px)','important');
      }
      const tr=topbar&&topbar.getBoundingClientRect?topbar.getBoundingClientRect():null;
      if(tr&&(tr.width<80||tr.left>=global.innerWidth-20)){
        topbar.style.setProperty('left','220px','important');
        topbar.style.setProperty('right','0','important');
      }
      if(reason) global.__CE_QC_V580_LAST_RECOVERY__={reason,at:Date.now(),page:pageFromPath()};
      return true;
    }catch(error){
      try{console.warn('[CE-QC][V580_VISIBLE_SHELL] recovery failed',error);}catch(_){}
      return false;
    }
  }
  function schedule(reason){
    recover(reason);
    setTimeout(()=>recover(reason+'+250ms'),250);
    setTimeout(()=>recover(reason+'+1000ms'),1000);
    setTimeout(()=>recover(reason+'+2500ms'),2500);
  }

  global.__CE_QC_V580_VISIBLE_SHELL__={version:VERSION,recover,schedule};
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',()=>schedule('domcontentloaded'),{once:true});
  else schedule('already-ready');

  global.addEventListener('pageshow',()=>schedule('pageshow'),true);
  global.addEventListener('popstate',()=>schedule('popstate'),true);
  global.addEventListener('click',event=>{
    if(event.target&&event.target.closest&&event.target.closest('[data-page],.side-link')) setTimeout(()=>recover('navigation-click'),120);
  },true);
  setTimeout(()=>recover('startup-5s'),5000);
  console.info('[CE-QC][V580_VISIBLE_SHELL]',VERSION,'guards against sidebar-only blank shell after update/cache cleanup.');
})(window);
