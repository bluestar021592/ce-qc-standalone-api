(function installV274TrendSpeedGuard(global){
  if(global.__CE_QC_V274_TREND_SPEED_GUARD__)return;
  const ID='2026-08-24-v275-fast-import-confirmation-and-trend-guard-v1';
  let scheduled=false,importBusy=false;
  const LOADING_RE=/正在读取(?:最近有效日报|趋势|派次趋势)|后台正在刷新最近有效日报/;
  function visiblePage(){return [...document.querySelectorAll('.app-page')].find(n=>!n.hidden&&getComputedStyle(n).display!=='none')||document;}
  function hasRenderedChart(node){return !!node?.querySelector?.('svg,canvas,.trend-svg,.v18-chart-svg,[data-chart-ready="1"]');}
  function cleanSection(section){
    if(!section)return;
    section.querySelectorAll('.v272-skeleton-grid').forEach(n=>n.remove());
    const grids=[...section.querySelectorAll('.v18-chart-grid,.v272-trend-grid,.v271-trend-grid')];
    const rendered=grids.filter(hasRenderedChart);
    const keep=rendered[0]||grids.find(g=>![...g.querySelectorAll('.v18-chart-card')].every(card=>LOADING_RE.test(String(card.textContent||''))))||grids[0];
    for(const grid of grids){
      if(grid===keep)continue;
      const loadingOnly=LOADING_RE.test(String(grid.textContent||''))||!hasRenderedChart(grid);
      if(loadingOnly)grid.remove();
    }
    section.querySelectorAll('.v18-chart-card').forEach(card=>{
      if(LOADING_RE.test(String(card.textContent||''))&&!hasRenderedChart(card)){
        const parent=card.parentElement;
        if(parent&&parent!==keep&&parent.querySelectorAll('.v18-chart-card').length===parent.children.length)parent.remove();
      }
    });
    const status=section.querySelector('.v272-status');
    if(keep&&hasRenderedChart(keep)&&status&&LOADING_RE.test(String(status.textContent||'')))status.textContent='已显示最近一次可用趋势，后台正在快速校准最新状态…';
    section.dataset.v274SingleRow='1';
  }
  function clean(){
    scheduled=false;
    const root=visiblePage();
    root.querySelectorAll?.('.v18-trend-section').forEach(cleanSection);
    root.querySelectorAll?.('#v272AttemptPanel,#v263DeliveryKpiPanel').forEach(panel=>{
      panel.querySelectorAll('.v272-skeleton-grid').forEach(n=>n.remove());
      panel.querySelectorAll('.v18-chart-card').forEach(card=>{if(LOADING_RE.test(String(card.textContent||''))&&!hasRenderedChart(card))card.closest('.v18-chart-grid,.v272-trend-grid,.v271-trend-grid')?.remove();});
    });
  }
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>setTimeout(clean,0));}

  function importStatusNode(){
    let node=document.getElementById('v275ImportConfirmStatus');
    if(node)return node;
    const button=[...document.querySelectorAll('button')].find(b=>/导入综合日报并自动分类/.test(String(b.textContent||''))||/importUnifiedExcel/.test(String(b.getAttribute('onclick')||'')));
    if(!button)return null;
    node=document.createElement('div');node.id='v275ImportConfirmStatus';node.style.cssText='margin:12px 0;padding:12px 14px;border-radius:10px;background:#eef7ff;color:#315d86;font-size:13px;line-height:1.6';
    button.insertAdjacentElement('afterend',node);return node;
  }
  function setImportStatus(text,tone='info'){
    const node=importStatusNode();if(!node)return;node.textContent=text;node.dataset.tone=tone;
    node.style.background=tone==='ok'?'#ecfbf3':tone==='error'?'#fff1f1':tone==='warn'?'#fff7e6':'#eef7ff';
    node.style.color=tone==='ok'?'#087a45':tone==='error'?'#a61b1b':tone==='warn'?'#8a6200':'#315d86';
  }
  async function readLatestImport(){
    const response=await fetch(`/api/import/unified-latest?compact=1&_=${Date.now()}`,{cache:'no-store',credentials:'same-origin'});
    const raw=await response.text();let json={};try{json=raw?JSON.parse(raw):{};}catch{}
    if(!response.ok||json.ok===false)throw new Error(json.error||json.message||`HTTP ${response.status}`);
    return json.import||json;
  }
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function importCount(item={}){return Number(item?.summary?.validUniqueWaybills||item?.summary?.totalRecognized||item?.validUniqueWaybills||0)||0;}
  async function waitForCommittedImport(reportDate,beforeBatchId,startedAt){
    for(let i=0;i<60;i+=1){
      await wait(i===0?900:2000);
      try{
        const latest=await readLatestImport();
        const sameDate=String(latest?.reportDate||'').slice(0,10)===reportDate;
        const newBatch=Boolean(latest?.batchId)&&String(latest.batchId)!==String(beforeBatchId||'');
        const recent=!latest?.createdAt||Date.parse(latest.createdAt)>=startedAt-5000;
        if(sameDate&&newBatch&&recent&&importCount(latest)>0)return latest;
      }catch{}
    }
    return null;
  }
  async function postUnifiedImport(body){
    const response=await fetch('/api/import/unified-daily-report',{method:'POST',body,credentials:'same-origin'});
    const raw=await response.text();let json={};try{json=raw?JSON.parse(raw):{};}catch{}
    if(!response.ok||json.ok===false){const error=new Error(json.error||json.message||raw.slice(0,240)||`HTTP ${response.status}`);error.payload=json;throw error;}
    return json;
  }
  async function importUnifiedExcelV275(){
    if(importBusy){setImportStatus('当前日报仍在处理，请不要重复点击导入。','warn');return;}
    const input=document.getElementById('excelFile'),file=input?.files?.[0];if(!file){alert('请选择综合日报Excel');return;}
    const reportDate=String(document.getElementById('reportDate')?.value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)){alert('请先确认日报日期');return;}
    importBusy=true;const button=[...document.querySelectorAll('button')].find(b=>/导入综合日报并自动分类/.test(String(b.textContent||''))||/importUnifiedExcel/.test(String(b.getAttribute('onclick')||'')));if(button)button.disabled=true;
    const startedAt=Date.now();let before={};try{before=await readLatestImport();}catch{}
    const body=new FormData();body.append('file',file);body.append('reportDate',reportDate);
    setImportStatus(`正在校验并写入 ${reportDate} 日报。源Excel防漏、七业务守恒和同日重传保护均已启用…`,'info');
    const postPromise=postUnifiedImport(body);
    const commitPromise=waitForCommittedImport(reportDate,before?.batchId||'',startedAt);
    let committed=null,postResult=null,postError=null,announced=false;
    try{
      const first=await Promise.race([
        postPromise.then(value=>({kind:'post',value})).catch(error=>({kind:'postError',error})),
        commitPromise.then(value=>({kind:'commit',value}))
      ]);
      if(first.kind==='postError')throw first.error;
      if(first.kind==='post'){postResult=first.value;committed=postResult;}
      else if(first.value){committed=first.value;setImportStatus(`${reportDate} 日报已安全写入数据库，共 ${importCount(committed).toLocaleString('zh-CN')} 个唯一运单。旧兼容状态和趋势预热继续在后台完成，你可以继续使用系统。`,'ok');announced=true;Promise.resolve(global.refresh?.()).catch(()=>{});}
      if(!postResult){try{postResult=await postPromise;}catch(error){postError=error;}}
      if(postResult){committed=postResult;setImportStatus(`${reportDate} 日报导入完成，共 ${importCount(postResult).toLocaleString('zh-CN')} 个唯一运单。防漏校验已通过，系统已开始持续追踪。`,'ok');announced=true;Promise.resolve(global.refresh?.()).catch(()=>{});}
      else if(postError&&!announced)throw postError;
      else if(postError&&announced)setImportStatus(`${reportDate} 日报已经安全入库；后续兼容处理出现提示：${postError.message}。核心日报批次不会因此丢失，系统会继续后台恢复。`,'warn');
      else if(!committed){setImportStatus('后台仍在处理，但尚未检测到新的有效日报批次。请不要重复点击；系统会继续确认写入状态。','warn');}
    }catch(error){
      const message=String(error?.message||error);setImportStatus(`日报未通过入库保护：${message}`,'error');alert(`综合日报导入失败：${message}`);
    }finally{importBusy=false;if(button)button.disabled=false;}
  }

  function installImportConfirmation(){
    if(typeof global.importUnifiedExcel==='function'&&!global.importUnifiedExcel.__v275){importUnifiedExcelV275.__v275=true;global.importUnifiedExcel=importUnifiedExcelV275;}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{schedule();installImportConfirmation();},{once:true});else{schedule();installImportConfirmation();}
  document.addEventListener('click',e=>{if(e.target?.closest?.('.side-link[data-page],#topRangeQuery'))setTimeout(()=>{schedule();installImportConfirmation();},60);},false);
  const observer=new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1))){schedule();installImportConfirmation();}});
  observer.observe(document.documentElement,{subtree:true,childList:true});
  global.__CE_QC_V274_TREND_SPEED_GUARD__={id:ID,clean,installImportConfirmation};
  console.info('[CE-QC][V275_IMPORT_TREND_GUARD]',ID,'single trend row + safe unified-import commit confirmation; page no longer waits for legacy compatibility saves before showing committed success.');
})(window);
