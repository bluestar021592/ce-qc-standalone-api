(function installV146UnifiedImportDateStatus(global){
  if(global.__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__)return;
  global.__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__={};
  const VERSION='2026-08-30-v366-atomic-seven-business-import-ui-v1';
  const ROUTE='/api/import/unified-daily-report';
  const originalFetch=global.fetch.bind(global);
  let candidateTarget='';
  let pendingTarget='';
  let importBusy=false;

  function validDate(y,m,d){
    y=Number(y);m=Number(m);d=Number(d);
    const date=new Date(Date.UTC(y,m-1,d));
    if(!Number.isInteger(y)||!Number.isInteger(m)||!Number.isInteger(d)||date.getUTCFullYear()!==y||date.getUTCMonth()+1!==m||date.getUTCDate()!==d)return '';
    return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  function normalizeDate(value){
    const text=String(value||'').normalize('NFKC').trim().replace(/[年/.]/g,'-').replace(/月/g,'-').replace(/日/g,'').replace(/\s+/g,'');
    let match=text.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);if(match)return validDate(match[1],match[2],match[3]);
    match=text.match(/^(\d{1,2})-(\d{1,2})$/);if(match)return validDate(new Date().getFullYear(),match[1],match[2]);
    return '';
  }
  function filenameDate(name=''){
    const base=String(name||'').normalize('NFKC').replace(/\.(xlsx|xls)$/i,'');
    let match=base.match(/(?:^|[^0-9])(20\d{2})[年._\-/](\d{1,2})[月._\-/](\d{1,2})(?:日|[^0-9]|$)/);if(match)return validDate(match[1],match[2],match[3]);
    match=base.match(/(?:^|[^0-9])(\d{1,2})[._\-/](\d{1,2})(?:[^0-9]|$)/);if(match)return validDate(new Date().getFullYear(),match[1],match[2]);
    return '';
  }
  function status(){return document.getElementById('fileStatus');}
  function selectedFile(){return document.getElementById('excelFile')?.files?.[0]||null;}
  function committedImport(){
    try{return typeof unifiedImportState!=='undefined'&&unifiedImportState?unifiedImportState:null;}catch{return null;}
  }
  function committedDate(){
    try{
      return normalizeDate(typeof unifiedImportState!=='undefined'?unifiedImportState?.reportDate:'')
        ||normalizeDate(typeof appState!=='undefined'?appState?.reportDate:'')
        ||normalizeDate(typeof shopeeState!=='undefined'?shopeeState?.reportDate:'');
    }catch{return '';}
  }
  function targetDate(){return pendingTarget||candidateTarget||filenameDate(selectedFile()?.name||'')||committedDate();}
  function syncCommittedTruth(payload=null){
    const payloadDate=normalizeDate(payload?.reportDate||'');
    if(payload&&payloadDate&&payload?.importCommitted===true){
      try{if(typeof unifiedImportState!=='undefined')unifiedImportState=payload;}catch{}
      try{if(typeof appState!=='undefined'&&payload?.state)appState=payload.state;}catch{}
      try{if(typeof shopeeState!=='undefined'&&payload?.shopeeState)shopeeState=payload.shopeeState;}catch{}
      try{if(typeof historyModeDate!=='undefined')historyModeDate=payloadDate;}catch{}
    }
    const date=payloadDate||committedDate();
    const input=document.getElementById('reportDate');
    const pending=Boolean(global.__CE_QC_PENDING_IMPORT_DATE__?.active);
    if(input&&date&&(!pending||payload?.importCommitted===true)){
      input.value=date;
      input.readOnly=true;
    }
    return date;
  }
  function scheduleCommittedTruth(payload=null){
    [0,80,250,900,1800].forEach(ms=>setTimeout(()=>{
      const date=syncCommittedTruth(payload);
      if(payload?.importCommitted===true&&date){
        try{global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__?.refresh?.();}catch{}
        if(location.pathname==='/whpp'){
          try{global.__CE_QC_V132_WHPP_FAST__?.fetchSummary?.(date)?.then?.(()=>global.__CE_QC_V132_WHPP_FAST__?.navigate?.(false)).catch?.(()=>{});}catch{}
        }
      }
    },ms));
  }
  function restoreCommittedDate(){syncCommittedTruth();}
  function showCandidateSource(){
    const source=document.getElementById('dateDetectionSource');
    if(source&&candidateTarget)source.textContent=`识别来源：文件名（待导入确认 ${candidateTarget}）`;
  }
  function setImportButtonBusy(value){
    importBusy=Boolean(value);
    const button=document.querySelector('[data-testid="combined-daily-import"]');
    if(button){button.disabled=importBusy;button.textContent=importBusy?'正在导入并确认七业务…':'导入综合日报并自动分类';}
  }
  function show(kind,title,detail=''){
    const node=status();if(!node)return;
    const palette=kind==='error'?['#fff1f1','#c43737','#f0c2c2']:kind==='success'?['#edf9f1','#16864d','#bfe7cf']:['#eef5ff','#245f9d','#c9dcf6'];
    node.innerHTML=`<div data-v146-import-status="${kind}" style="margin-top:8px;padding:10px 12px;border:1px solid ${palette[2]};border-radius:7px;background:${palette[0]};color:${palette[1]};line-height:1.55"><b>${title}</b>${detail?`<div style="margin-top:3px;font-size:12px">${detail}</div>`:''}</div>`;
  }
  function syncSevenBusinessClassification(payload=committedImport()){
    const counts=payload?.classificationCounts||{};
    const grid=document.querySelector('#unifiedClassificationSummary .unified-count-grid');
    if(grid&&!grid.querySelector('[data-testid="classification-whpp"]')){
      const cell=document.createElement('div');
      cell.innerHTML=`<span>WHPP本土</span><b data-testid="classification-whpp">${Number(counts.WHPP||0).toLocaleString('zh-CN')}</b>`;
      grid.appendChild(cell);
    }else if(grid){
      const target=grid.querySelector('[data-testid="classification-whpp"]');
      if(target)target.textContent=Number(counts.WHPP||0).toLocaleString('zh-CN');
    }
    const heading=document.querySelector('#importPage .page-heading p');
    if(heading&&/五个独立业务队列|五业务/.test(heading.textContent||''))heading.textContent='一次上传综合日报，系统一次确认七业务分类并建立独立处理队列';
    const empty=document.querySelector('#unifiedClassificationSummary .unified-empty-state span');
    if(empty&&/六业务|五业务/.test(empty.textContent||''))empty.textContent='选择综合日报后，这里会显示七业务分类、PP/PV和数据质量统计。';
  }
  function scheduleSevenBusinessClassification(payload){[50,250,900].forEach(ms=>setTimeout(()=>syncSevenBusinessClassification(payload),ms));}
  function markSelected(){
    const file=selectedFile();if(!file)return;
    candidateTarget=filenameDate(file.name)||'';
    restoreCommittedDate();
    showCandidateSource();
    setTimeout(()=>show('info',candidateTarget?`已选择 ${candidateTarget} 日报，尚未写入数据库`:'已选择日报，等待后台识别日期',`文件：${file.name}。当前正式日报仍保持 ${committedDate()||'上一成功日期'}；只有七业务分类和三个处理队列全部保存成功后才切换。`),0);
  }

  document.addEventListener('change',event=>{if(event.target?.id==='excelFile')markSelected();},true);
  document.addEventListener('click',event=>{
    const detect=event.target?.closest?.('#detectFilenameDateButton');
    if(detect){
      const file=selectedFile();
      candidateTarget=filenameDate(file?.name||'')||candidateTarget;
      setTimeout(()=>{
        restoreCommittedDate();
        showCandidateSource();
        if(candidateTarget)show('info',`文件名识别到 ${candidateTarget}，等待导入确认`,`这只是待导入日期，不会提前改变当前七业务、扫描、轨迹或WHPP的正式日期。`);
      },0);
      return;
    }
    const button=event.target?.closest?.('[data-testid="combined-daily-import"]');if(!button)return;
    if(importBusy){event.preventDefault();event.stopImmediatePropagation();return;}
    const file=selectedFile();if(!file)return;
    pendingTarget=candidateTarget||filenameDate(file.name)||normalizeDate(document.getElementById('reportDate')?.value||'');
    global.__CE_QC_PENDING_IMPORT_DATE__={reportDate:pendingTarget,committedReportDate:committedDate(),startedAt:Date.now(),active:true};
    restoreCommittedDate();
    showCandidateSource();
    setImportButtonBusy(true);
    show('info',`正在导入 ${pendingTarget||'当前'} 日报…`,`正在执行日期校验、七业务分类、CCSL/SHOPEE/WHPP队列保存和最终原子提交。完成前不会替换上一份日报。`);
  },true);

  global.fetch=async function v146UnifiedImportFetch(input,init){
    const url=typeof input==='string'?input:String(input?.url||'');
    const isImport=url.includes(ROUTE);
    if(!isImport)return originalFetch(input,init);
    let target=pendingTarget||candidateTarget||filenameDate(selectedFile()?.name||'')||targetDate();
    let committed=false;
    let payload=null;
    try{
      const body=init?.body;
      if(body instanceof FormData){
        const file=body.get('file');
        target=pendingTarget||candidateTarget||filenameDate(file?.name||'')||normalizeDate(body.get('reportDate')||'')||target;
        if(target)body.set('reportDate',target);
      }
      show('info',`正在导入 ${target||'当前'} 日报…`,`新日期仍处于待确认状态；后台七业务和三个处理队列全部原子提交前，页面继续使用上一份正式日报。`);
      const response=await originalFetch(input,init);
      try{payload=await response.clone().json();}catch{}
      const responseDate=normalizeDate(payload?.reportDate||'');
      const requestedDate=normalizeDate(target||'');
      committed=Boolean(response.ok&&payload?.ok===true&&payload?.importCommitted===true&&responseDate&&(!requestedDate||responseDate===requestedDate));
      if(!committed){
        const mismatch=response.ok&&payload?.ok===true&&payload?.importCommitted===true&&requestedDate&&responseDate&&requestedDate!==responseDate;
        const message=mismatch?`后端提交日期 ${responseDate} 与待导入日期 ${requestedDate} 不一致`:String(payload?.error||`HTTP ${response.status}`);
        show('error',`${target||'本次'} 日报导入未完成`,`${message}。上一份成功日报继续生效；不会进入半分类、半扫描状态。`);
        restoreCommittedDate();
        showCandidateSource();
      }else{
        syncCommittedTruth(payload);
        candidateTarget='';
        show('success',`${responseDate} 日报已完整提交`,`七业务分类和 CCSL → SHOPEE → WHPP 三阶段处理入口均已原子切换到新日期。`);
        scheduleSevenBusinessClassification(payload);
        scheduleCommittedTruth(payload);
        try{document.dispatchEvent(new CustomEvent('ce-qc-unified-import-committed',{detail:{reportDate:responseDate,snapshotId:String(payload?.snapshotId||'')}}));}catch{}
      }
      return response;
    }catch(error){
      show('error',`${target||'本次'} 日报导入请求失败`,`${error?.message||error}。上一份正式日报继续生效。`);
      restoreCommittedDate();
      showCandidateSource();
      throw error;
    }finally{
      pendingTarget='';
      if(global.__CE_QC_PENDING_IMPORT_DATE__)global.__CE_QC_PENDING_IMPORT_DATE__.active=false;
      setImportButtonBusy(false);
      if(committed)scheduleCommittedTruth(payload);
      else scheduleCommittedTruth();
    }
  };

  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')scheduleCommittedTruth();});
  global.addEventListener('popstate',()=>scheduleCommittedTruth());
  document.addEventListener('click',event=>{if(event.target?.closest?.('.side-link[data-page]'))setTimeout(()=>scheduleCommittedTruth(),80);},true);
  [100,400,1200,3000].forEach(ms=>setTimeout(()=>syncCommittedTruth(),ms));
  [200,900,1800].forEach(ms=>setTimeout(()=>syncSevenBusinessClassification(),ms));
  global.__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__.version=VERSION;
  global.__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__.getPendingDate=()=>pendingTarget||candidateTarget;
  global.__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__.syncClassification=syncSevenBusinessClassification;
  global.__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__.syncCommittedTruth=syncCommittedTruth;
})(window);