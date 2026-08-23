(function(){
  'use strict';
  const ID='2026-08-23-v267-report-export-clarity-v1';
  const ANOMALY_RE=/(Pending|OC|入库无扫描|工单|盘点|门店滞留|严重异常|异常未闭环|未闭环)/i;
  const SCOPE_RE=/(全部数据|全部明细|核心异常|外省未完结POD|已签收|POD|退回|派送中|本省|外省|PP|PV|收件人冲突)/i;
  const byId=id=>document.getElementById(id);
  const text=el=>String(el?.textContent||'').trim();

  function currentRange(){
    const range=(typeof dashboardPeriodRange!=='undefined'&&dashboardPeriodRange)||null;
    const state=(typeof previewState!=='undefined'&&previewState?.reports?.business==='SHOPEE')
      ? (typeof shopeeState!=='undefined'?shopeeState:{})
      : (typeof appState!=='undefined'?appState:{});
    const fallback=String(state?.reportDate||'');
    return {from:String(range?.fromDate||fallback||''),to:String(range?.toDate||fallback||'')};
  }

  function ensureDateControls(grid){
    const legacy=byId('reportDateRange');
    if(!legacy)return;
    const label=legacy.closest('label');
    if(!label)return;
    legacy.type='hidden';
    legacy.hidden=true;
    if(!byId('reportRangeFrom')){
      label.innerHTML='开始日期<input id="reportRangeFrom" type="date" aria-label="报表预览开始日期"><input id="reportDateRange" type="hidden">';
      const end=document.createElement('label');
      end.innerHTML='结束日期<input id="reportRangeTo" type="date" aria-label="报表预览结束日期">';
      label.insertAdjacentElement('afterend',end);
    }
    const r=currentRange();
    const from=byId('reportRangeFrom'),to=byId('reportRangeTo');
    if(from&&!from.value)from.value=r.from;
    if(to&&!to.value)to.value=r.to;
  }

  function optionRecords(){
    const legacy=byId('reportCategory');
    return legacy?[...legacy.options].map(o=>({value:o.value,label:String(o.textContent||'').trim(),selected:o.selected})):[];
  }

  function setCategory(value){
    if(!value)return;
    const legacy=byId('reportCategory');
    if(legacy)legacy.value=value;
    if(typeof setReportCategory==='function')setReportCategory(value);
  }

  function fillSelect(select,records,placeholder){
    if(!select)return;
    const old=select.value;
    select.innerHTML=`<option value="">${placeholder}</option>`+records.map(r=>`<option value="${String(r.value).replace(/"/g,'&quot;')}">${String(r.label).replace(/</g,'&lt;')}</option>`).join('');
    if(records.some(r=>r.value===old))select.value=old;
  }

  function ensureSemanticFilters(grid){
    const legacy=byId('reportCategory');
    if(!legacy)return;
    const legacyLabel=legacy.closest('label');
    if(legacyLabel)legacyLabel.hidden=true;

    let scope=byId('reportDataScope');
    let anomaly=byId('reportAnomalyType');
    if(!scope){
      scope=document.createElement('select');scope.id='reportDataScope';scope.setAttribute('aria-label','数据范围');
      const label=document.createElement('label');label.innerHTML='数据范围';label.appendChild(scope);
      legacyLabel?.insertAdjacentElement('beforebegin',label);
      scope.addEventListener('change',()=>{if(scope.value){anomaly.value='';setCategory(scope.value);}});
    }
    if(!anomaly){
      anomaly=document.createElement('select');anomaly.id='reportAnomalyType';anomaly.setAttribute('aria-label','具体异常');
      const label=document.createElement('label');label.innerHTML='具体异常';label.appendChild(anomaly);
      legacyLabel?.insertAdjacentElement('beforebegin',label);
      anomaly.addEventListener('change',()=>{if(anomaly.value){scope.value='';setCategory(anomaly.value);}});
    }
    const records=optionRecords();
    const scopes=records.filter(r=>SCOPE_RE.test(r.label)&&!ANOMALY_RE.test(r.label));
    const anomalies=records.filter(r=>ANOMALY_RE.test(r.label)&&!/核心异常/.test(r.label));
    // Core exception is a scope/collection, not one anomaly type.
    const core=records.filter(r=>/核心异常/.test(r.label));
    const unique=(list)=>{const seen=new Set();return list.filter(r=>r.value&&!seen.has(r.value)&&(seen.add(r.value),true));};
    fillSelect(scope,unique([...scopes,...core]),'全部数据范围');
    fillSelect(anomaly,unique(anomalies),'全部具体异常');
    const selected=records.find(r=>r.selected);
    if(selected){
      if(ANOMALY_RE.test(selected.label)&&!/核心异常/.test(selected.label))anomaly.value=selected.value;
      else scope.value=selected.value;
    }
  }

  function removeFakeClosureAndDuplicateExport(grid){
    [...grid.querySelectorAll('label')].forEach(label=>{
      if(/^是否闭环/.test(text(label))){label.hidden=true;label.dataset.v267Retired='no-op-closure-filter';}
    });
    [...grid.querySelectorAll('button')].forEach(button=>{
      if(/下载Excel/.test(text(button))){button.hidden=true;button.dataset.v267Retired='duplicate-single-snapshot-export';}
    });
  }

  function relabelControls(){
    const business=byId('reportBusiness');
    if(business){const label=business.closest('label');if(label&&/^渠道/.test(text(label)))label.childNodes[0].textContent='预览对象';}
    const region=byId('reportRegion');
    const recipient=byId('reportRecipientGroup');
    const isShopee=business?.value==='SHOPEE';
    if(region)region.disabled=!isShopee;
    if(recipient)recipient.disabled=!isShopee;
  }

  function ensureQueryButton(grid){
    const buttons=[...grid.querySelectorAll('button')];
    const refresh=buttons.find(b=>/刷新预览/.test(text(b))||/查询预览/.test(text(b)));
    if(refresh){
      refresh.innerHTML='查询预览';
      refresh.onclick=()=>void window.applyV267ReportRange();
    }
  }

  function ensureNote(panel){
    let note=panel.querySelector('.v267-report-explain');
    if(!note){
      note=document.createElement('p');note.className='report-note v267-report-explain';
      panel.querySelector('.report-filter-grid')?.insertAdjacentElement('afterend',note);
    }
    note.textContent='ⓘ 这里用于按已保存日报/快照筛选明细预览，不重新调用CE API。日期可自由选择；“数据范围”是全部/核心异常/外省未完结等集合，“具体异常”只放Pending、OC、入库无扫描、工单、盘点、门店滞留等真实异常。Excel统一使用上方“日报 / 周报 / 月报 / 自定义日期”导出。';
  }

  function enhance(){
    const panel=document.querySelector('#reportsPage .report-filter-panel');
    const grid=panel?.querySelector('.report-filter-grid');
    if(!panel||!grid)return;
    ensureDateControls(grid);
    ensureSemanticFilters(grid);
    removeFakeClosureAndDuplicateExport(grid);
    relabelControls();
    ensureQueryButton(grid);
    ensureNote(panel);
    panel.dataset.v267Owner=ID;
  }

  window.applyV267ReportRange=async function(){
    const from=byId('reportRangeFrom')?.value||'';
    const to=byId('reportRangeTo')?.value||'';
    if(!from||!to){alert('请选择开始日期和结束日期');return;}
    if(from>to){alert('开始日期不能晚于结束日期');return;}
    const topFrom=byId('topRangeFrom'),topTo=byId('topRangeTo');if(topFrom)topFrom.value=from;if(topTo)topTo.value=to;
    const periodFrom=byId('periodExportFrom'),periodTo=byId('periodExportTo');if(periodFrom)periodFrom.value=from;if(periodTo)periodTo.value=to;
    const custom=[...document.querySelectorAll('.period-tab')].find(b=>b.dataset.period==='custom');
    if(typeof setExportPeriod==='function'&&custom)setExportPeriod('custom',custom);
    if(typeof loadCustomDashboardRange==='function'){
      await loadCustomDashboardRange(from,to,true);
    }else if(typeof renderReportsPage==='function')renderReportsPage();
  };

  const original=typeof renderReportsPage==='function'?renderReportsPage:null;
  if(original&&!original.__v267Wrapped){
    const wrapped=function(){const result=original.apply(this,arguments);queueMicrotask(enhance);return result;};
    wrapped.__v267Wrapped=true;
    renderReportsPage=wrapped;
  }
  queueMicrotask(enhance);
  console.info('[CE-QC][V267_REPORT_EXPORT]',ID,'date range selectable; data scope separated from concrete anomaly; no-op closure and duplicate export controls retired.');
})();
