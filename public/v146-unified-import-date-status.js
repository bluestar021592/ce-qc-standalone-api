(function installV146UnifiedImportDateStatus(global){
  if(global.__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__)return;
  global.__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__=true;
  const VERSION='2026-08-16-v146-unified-import-date-status-v1';
  const ROUTE='/api/import/unified-daily-report';
  const originalFetch=global.fetch.bind(global);

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
  function targetDate(){return normalizeDate(document.getElementById('reportDate')?.value||'')||filenameDate(selectedFile()?.name||'');}
  function show(kind,title,detail=''){
    const node=status();if(!node)return;
    const palette=kind==='error'?['#fff1f1','#c43737','#f0c2c2']:kind==='success'?['#edf9f1','#16864d','#bfe7cf']:['#eef5ff','#245f9d','#c9dcf6'];
    node.innerHTML=`<div data-v146-import-status="${kind}" style="margin-top:8px;padding:10px 12px;border:1px solid ${palette[2]};border-radius:7px;background:${palette[0]};color:${palette[1]};line-height:1.55"><b>${title}</b>${detail?`<div style="margin-top:3px;font-size:12px">${detail}</div>`:''}</div>`;
  }
  function markSelected(){
    const file=selectedFile();if(!file)return;const date=targetDate();
    setTimeout(()=>show('info',date?`已选择 ${date} 日报，尚未写入数据库`:'已选择日报，等待确认日期',`文件：${file.name}。请点击“导入综合日报并自动分类”；只有导入成功后，下方当前日报才会切换到新日期。`),0);
  }

  document.addEventListener('change',event=>{if(event.target?.id==='excelFile')markSelected();},true);
  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('[data-testid="combined-daily-import"]');if(!button)return;
    const file=selectedFile();if(!file)return;const date=targetDate();
    show('info',`正在导入 ${date||'当前'} 日报…`,`正在执行日期校验、七业务分类和SQLite写入，请勿重复点击。`);
  },true);

  global.fetch=async function v146UnifiedImportFetch(input,init){
    const url=typeof input==='string'?input:String(input?.url||'');
    const isImport=url.includes(ROUTE);
    if(!isImport)return originalFetch(input,init);
    let target=targetDate();
    try{
      const body=init?.body;
      if(body instanceof FormData){
        const file=body.get('file');
        target=normalizeDate(body.get('reportDate')||'')||target||filenameDate(file?.name||'');
        if(target)body.set('reportDate',target);
      }
      show('info',`正在导入 ${target||'当前'} 日报…`,`日期已按 YYYY-MM-DD 标准提交，正在等待后台确认写入。`);
      const response=await originalFetch(input,init);
      let payload=null;try{payload=await response.clone().json();}catch{}
      if(!response.ok||payload?.ok===false){
        const message=String(payload?.error||`HTTP ${response.status}`);
        show('error',`${target||'本次'} 日报导入未完成`,`${message}。数据库仍保留上一份成功日报；本次失败不会覆盖历史数据。`);
      }else if(payload?.reportDate){
        show('success',`${payload.reportDate} 日报已成功写入`,`正在刷新七业务分类结果和当前日报状态。`);
      }
      return response;
    }catch(error){
      show('error',`${target||'本次'} 日报导入请求失败`,`${error?.message||error}。数据库未被本次失败导入覆盖。`);
      throw error;
    }
  };
  global.__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__.version=VERSION;
})(window);
