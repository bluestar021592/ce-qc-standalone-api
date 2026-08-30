(function installV146UnifiedImportDateStatus(global){
  if(global.__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__)return;
  global.__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__={};
  const VERSION='2026-08-30-v363-pending-date-commit-gate-v1';
  const ROUTE='/api/import/unified-daily-report';
  const originalFetch=global.fetch.bind(global);
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
  function committedDate(){
    try{
      return normalizeDate(typeof unifiedImportState!=='undefined'?unifiedImportState?.reportDate:'')
        ||normalizeDate(typeof appState!=='undefined'?appState?.reportDate:'')
        ||normalizeDate(typeof shopeeState!=='undefined'?shopeeState?.reportDate:'');
    }catch{return '';}
  }
  function targetDate(){return pendingTarget||normalizeDate(document.getElementById('reportDate')?.value||'')||filenameDate(selectedFile()?.name||'');}
  function restoreCommittedDate(){
    const date=committedDate();
    const input=document.getElementById('reportDate');
    if(input&&date){input.value=date;input.readOnly=true;}
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
  function markSelected(){
    const file=selectedFile();if(!file)return;const date=normalizeDate(document.getElementById('reportDate')?.value||'')||filenameDate(file.name);
    setTimeout(()=>show('info',date?`已选择 ${date} 日报，尚未写入数据库`:'已选择日报，等待确认日期',`文件：${file.name}。当前正式日报仍保持 ${committedDate()||'上一成功日期'}；只有七业务分类和三个处理队列全部保存成功后才切换。`),0);
  }

  document.addEventListener('change',event=>{if(event.target?.id==='excelFile')markSelected();},true);
  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('[data-testid="combined-daily-import"]');if(!button)return;
    if(importBusy){event.preventDefault();event.stopImmediatePropagation();return;}
    const file=selectedFile();if(!file)return;
    pendingTarget=normalizeDate(document.getElementById('reportDate')?.value||'')||filenameDate(file.name);
    global.__CE_QC_PENDING_IMPORT_DATE__={reportDate:pendingTarget,committedReportDate:committedDate(),startedAt:Date.now(),active:true};
    // Do not let V67/V168/V132 treat a filename candidate as the current business
    // date while the POST is still writing. The fetch wrapper below sends the
    // captured target date in FormData, while the visible current-state owners keep
    // reading the last committed date until the backend returns importCommitted.
    restoreCommittedDate();
    setImportButtonBusy(true);
    show('info',`正在导入 ${pendingTarget||'当前'} 日报…`,`正在执行日期校验、七业务分类、CCSL/SHOPEE/WHPP队列保存和最终VALID切换。完成前不会替换上一份日报。`);
  },true);

  global.fetch=async function v146UnifiedImportFetch(input,init){
    const url=typeof input==='string'?input:String(input?.url||'');
    const isImport=url.includes(ROUTE);
    if(!isImport)return originalFetch(input,init);
    let target=pendingTarget||filenameDate(selectedFile()?.name||'')||targetDate();
    try{
      const body=init?.body;
      if(body instanceof FormData){
        const file=body.get('file');
        target=pendingTarget||filenameDate(file?.name||'')||normalizeDate(body.get('reportDate')||'')||target;
        if(target)body.set('reportDate',target);
      }
      show('info',`正在导入 ${target||'当前'} 日报…`,`新日期仍处于待确认状态；后台全部保存成功前，页面继续使用上一份正式日报。`);
      const response=await originalFetch(input,init);
      let payload=null;try{payload=await response.clone().json();}catch{}
      if(!response.ok||payload?.ok===false||payload?.importCommitted===false){
        const message=String(payload?.error||`HTTP ${response.status}`);
        show('error',`${target||'本次'} 日报导入未完成`,`${message}。上一份成功日报继续生效；不会进入半分类、半扫描状态。`);
        restoreCommittedDate();
      }else if(payload?.reportDate){
        show('success',`${payload.reportDate} 日报已完整提交`,`七业务分类和 CCSL → SHOPEE → WHPP 三阶段处理入口均已切换到新日期。`);
      }
      return response;
    }catch(error){
      show('error',`${target||'本次'} 日报导入请求失败`,`${error?.message||error}。上一份正式日报继续生效。`);
      restoreCommittedDate();
      throw error;
    }finally{
      pendingTarget='';
      if(global.__CE_QC_PENDING_IMPORT_DATE__)global.__CE_QC_PENDING_IMPORT_DATE__.active=false;
      setImportButtonBusy(false);
    }
  };
  global.__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__.version=VERSION;
  global.__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__.getPendingDate=()=>pendingTarget;
})(window);
