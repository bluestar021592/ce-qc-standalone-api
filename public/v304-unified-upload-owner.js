(function installV304UnifiedUploadOwner(global){
  if(global.__CE_QC_V304_UNIFIED_UPLOAD_OWNER__)return;
  const VERSION='2026-08-25-v304-unified-upload-owner-v1';
  let uploading=false;
  let observerTimer=null;

  const byId=id=>document.getElementById(id);
  const text=value=>String(value||'').trim();
  const mb=bytes=>`${(Number(bytes||0)/1024/1024).toFixed(2)} MB`;

  function setStatus(message,kind=''){
    const node=byId('fileStatus');
    if(!node)return;
    node.textContent=message;
    node.dataset.v304Status=kind;
    node.style.color=kind==='error'?'#b42318':kind==='success'?'#087a47':'#31587f';
  }

  function pickerLabel(input){return input?.closest?.('.file-picker')||null;}
  function pickerText(input){return pickerLabel(input)?.querySelector?.('span')||null;}

  function detectDateFromSelectedFile(file){
    const input=byId('reportDate');
    const source=byId('dateDetectionSource');
    if(!file||!input)return;
    let detected='';
    try{
      if(typeof global.parseReportDateFromFilename==='function')detected=text(global.parseReportDateFromFilename(file.name));
    }catch{}
    if(!detected){
      const match=String(file.name||'').match(/(20\d{2})[^0-9]?([01]\d)[^0-9]?([0-3]\d)/);
      if(match){
        const candidate=`${match[1]}-${match[2]}-${match[3]}`;
        const date=new Date(`${candidate}T00:00:00Z`);
        if(!Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===candidate)detected=candidate;
      }
    }
    if(detected){
      input.value=detected;
      input.readOnly=true;
      if(source)source.textContent='识别来源：文件名';
    }else if(source&&!/手动修正/.test(source.textContent||'')){
      source.textContent='导入时自动读取表内日期';
    }
  }

  function onFileChanged(input){
    const file=input?.files?.[0];
    const label=pickerText(input);
    if(file){
      if(label)label.textContent=`已选择：${file.name}`;
      setStatus(`文件已选择：${file.name} · ${mb(file.size)}，可以直接导入。`,'ready');
      detectDateFromSelectedFile(file);
    }else{
      if(label)label.textContent='选择综合日报Excel';
      setStatus('');
    }
  }

  function repairPicker(){
    const input=byId('excelFile');
    if(!input)return;
    const picker=pickerLabel(input);
    if(picker){
      picker.style.position='relative';
      picker.style.overflow='hidden';
      picker.style.cursor='pointer';
    }
    Object.assign(input.style,{
      position:'absolute',
      inset:'0',
      width:'100%',
      height:'100%',
      opacity:'0',
      pointerEvents:'auto',
      cursor:'pointer',
      zIndex:'3'
    });
    if(input.dataset.v304Bound!=='1'){
      input.dataset.v304Bound='1';
      input.addEventListener('change',()=>onFileChanged(input));
    }
    const button=document.querySelector('[data-testid="combined-daily-import"]');
    if(button&&!uploading)button.disabled=false;
  }

  async function responseJson(response){
    const raw=await response.text();
    let data={};
    try{data=raw?JSON.parse(raw):{};}catch{}
    if(!response.ok||data?.ok===false){
      const fallback=raw&&!/^\s*</.test(raw)?raw.slice(0,300):`HTTP ${response.status}`;
      const error=new Error(data?.error||data?.message||fallback||'综合日报导入失败');
      error.status=response.status;
      throw error;
    }
    return data;
  }

  async function importUnifiedExcelV304(){
    if(uploading)return;
    const input=byId('excelFile');
    const file=input?.files?.[0];
    if(!file){
      setStatus('请先选择综合日报Excel。','error');
      try{input?.click?.();}catch{}
      return;
    }
    uploading=true;
    const button=document.querySelector('[data-testid="combined-daily-import"]');
    if(button){button.disabled=true;button.dataset.v304Text=button.textContent;button.textContent='正在上传并自动分类…';}
    setStatus(`正在上传 ${file.name}（${mb(file.size)}），请保持APP打开…`,'working');
    try{
      const body=new FormData();
      body.append('file',file,file.name);
      const reportDate=byId('reportDate');
      const sourceText=text(byId('dateDetectionSource')?.textContent);
      if(reportDate?.value&&(!reportDate.readOnly||/文件名|手动修正/.test(sourceText)))body.append('reportDate',reportDate.value);
      const result=await responseJson(await fetch('/api/import/unified-daily-report',{
        method:'POST',
        body,
        credentials:'same-origin',
        cache:'no-store'
      }));
      if(result?.reportDate&&reportDate)reportDate.value=result.reportDate;
      setStatus(`导入成功：${result?.reportDate||''} · 有效唯一单号 ${Number(result?.summary?.validUniqueWaybills||result?.summary?.totalUnique||0).toLocaleString()}。正在刷新分类结果…`,'success');
      try{
        if(typeof global.refresh==='function')await global.refresh();
        else global.location.reload();
      }catch{global.location.reload();}
      return result;
    }catch(error){
      console.error('[CE-QC][V304_UPLOAD]',error);
      setStatus(`导入失败：${error?.message||error}`,'error');
      return null;
    }finally{
      uploading=false;
      if(button){button.disabled=false;button.textContent=button.dataset.v304Text||'导入综合日报并自动分类';}
      repairPicker();
    }
  }

  global.importUnifiedExcel=importUnifiedExcelV304;
  function install(){repairPicker();global.importUnifiedExcel=importUnifiedExcelV304;}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  new MutationObserver(()=>{
    clearTimeout(observerTimer);
    observerTimer=setTimeout(install,60);
  }).observe(document.body,{childList:true,subtree:true});

  global.__CE_QC_V304_UNIFIED_UPLOAD_OWNER__={version:VERSION,repair:install,importUnifiedExcel:importUnifiedExcelV304};
  console.info('[CE-QC][V304_UPLOAD]',VERSION,'native file picker restored with full clickable input surface; direct multipart upload owns combined daily import and shows visible progress/errors.');
})(window);
