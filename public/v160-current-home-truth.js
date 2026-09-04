(function installCurrentHomeTruthV160(global){
  if(global.__CE_QC_V160_CURRENT_HOME_TRUTH__)return;
  const VERSION='2026-08-16-v160-current-home-truth-v1';
  const V426_HOME_RENDER_HANDOFF='2026-09-04-v426-v160-post-render-v64-classification-handoff-v2';
  const CCSL_TYPES=['CE','CEAF','TBKH','ALI1688'];
  const SHOPEE_TYPES=['SHOPEECN','SHOPEEVN'];
  const num=value=>{const parsed=Number(value||0);return Number.isFinite(parsed)?parsed:0;};
  const dateOnly=value=>{const text=String(value||'').trim().slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';};

  function imported(){try{return typeof unifiedImportState!=='undefined'&&unifiedImportState?unifiedImportState:null;}catch{return null;}}
  function getCcsl(){try{return typeof appState!=='undefined'&&appState?appState:null;}catch{return null;}}
  function setCcsl(value){try{appState=value;return true;}catch{return false;}}
  function getShopee(){try{return typeof shopeeState!=='undefined'&&shopeeState?shopeeState:null;}catch{return null;}}
  function setShopee(value){try{shopeeState=value;return true;}catch{return false;}}
  function countOf(source,type){return Math.max(0,num(source?.classificationCounts?.[type]));}
  function expected(source,types){return types.reduce((sum,type)=>sum+countOf(source,type),0);}
  function stateTotal(state={},kind='CCSL'){
    if(kind==='SHOPEE')return Math.max(0,num(state?.dashboard?.metrics?.total),num(state?.dailyParseSummary?.totalRecognized),num(state?.sourceTotal),Array.isArray(state?.pnhBills)?state.pnhBills.length:0);
    return Math.max(0,num(state?.dashboard?.pnh),num(state?.dashboard?.totalMonitored),num(state?.dailyParseSummary?.totalRecognized),num(state?.sourceTotal),Array.isArray(state?.pnhBills)?state.pnhBills.length:0);
  }
  function statePod(state={},kind='CCSL'){
    if(kind==='SHOPEE')return Math.max(0,num(state?.dashboard?.metrics?.pod),num(state?.v55Summary?.pod));
    return Math.max(0,num(state?.dashboard?.todayPod),num(state?.v55Summary?.pod),num(state?.v55Summary?.todayPod));
  }
  function needsReset(state,source,total,kind){
    const date=dateOnly(source?.reportDate),sid=String(source?.snapshotId||'').trim();
    if(!date)return false;
    if(!state)return true;
    if(dateOnly(state.reportDate)!==date)return true;
    const currentSid=String(state.snapshotId||'').trim();
    if(sid&&currentSid&&sid!==currentSid)return true;
    if(stateTotal(state,kind)!==total)return true;
    if(statePod(state,kind)>total)return true;
    return false;
  }
  function zeroRows(total){
    return [
      ['今日PNH',total],['今日POD',0],['首投POD率',0],['Pending不连续',0],['Pending1+',0],['Pending2+',0],['Pending3+',0],['OC1+',0],['OC2+',0],['OC3+',0],
      ['门店滞留2天+',0],['工单未处理',0],['入库无扫描节点',0],['盘点2天+',0],['外省未完结POD件',0],['仓库自提件',0],['CECN滞留包裹',0],['CEZT滞留包裹',0],['580滞留包裹',0]
    ].map(([name,value])=>({项目:name,metricKey:name,数值:value,迷你走势数据:[]}));
  }
  function historyPlaceholder(oldHistory,date,total,kind='CCSL'){
    const prior=(Array.isArray(oldHistory)?oldHistory:[]).filter(row=>dateOnly(row?.reportDate)<date).slice(-6);
    if(kind==='SHOPEE'){
      const metrics={'ALL_今日总单':total,'ALL_今日POD':0,'ALL_POD率':0,'ALL_Pending1+':0,'ALL_Pending2+':0,'ALL_Pending3+':0,'ALL_OC1+':0,'ALL_OC2+':0,'ALL_OC3+':0,'ALL_入库无扫描':0,'ALL_首派成功率':0};
      return [...prior,{reportDate:date,summary:{reportDate:date,today:total,pnh:total,todayPnh:total,todayPod:0,scanPod:0,podRate:0,firstPodRate:0,ocRate:0,metrics}}];
    }
    return [...prior,{reportDate:date,summary:{reportDate:date,today:total,pnh:total,todayPnh:total,todayPod:0,scanPod:0,podRate:0,firstPodRate:0,ocRate:0,'今日PNH':total,'今日POD':0,'首投POD率':0,'Pending1+':0,'Pending2+':0,'Pending3+':0,'OC1+':0,'OC2+':0,'OC3+':0}}];
  }
  function ccslPlaceholder(state,source,total){
    const date=dateOnly(source.reportDate),sid=String(source.snapshotId||'').trim();
    const rows=zeroRows(total);
    return {
      ...(state||{}),businessType:'CCSL',reportDate:date,sourceName:source.sourceName||state?.sourceName||'',snapshotId:sid||state?.snapshotId||'',snapshotStatus:'IMPORTED',dailyReportReady:true,
      pnhBills:[],dailyParseRows:[],dailyParseSummary:{totalRecognized:total,pnh:total,nonPnh:0,excluded:0,duplicate:0},sourceTotal:total,
      scanResults:[],trackResults:[],trackEvents:[],finalRows:[],carryBills:[],nextCarryBills:[],needTrackBills:[],processing:{running:false,paused:false,phase:''},
      v55Summary:{total,pod:0,podRate:0,pending1:0,pending2:0,pending3:0,oc1:0,oc2:0,oc3:0,__source:'V160_CURRENT_IMPORT'},
      dashboard:{pnh:total,totalMonitored:total,todayPod:0,podRate:0,abnormalCount:0,categories:{pendingTotal:0,ocTotal:0},dashboardRows:rows,v55Summary:{total,pod:0,podRate:0,__source:'V160_CURRENT_IMPORT'}},
      detailTabs:{dashboard:{rows,total:rows.length},coreAbnormal:{rows:[],total:0,label:'核心异常'}},historySummary:historyPlaceholder(state?.historySummary,date,total,'CCSL'),
      __v160Provisional:true,__v160ExpectedTotal:total
    };
  }
  function shopeeMetric(total){return {total,pod:0,podRate:0,returned:0,returnRate:0,cancelled:0,unresolved:total,pendingNonContinuous:0,pending1:0,pending2:0,pending3plus:0,oc1:0,oc2:0,oc3plus:0,cycle2plus:0,inboundNoScan:0,deliveryStay:0,deliveryStayRate:0,firstAttemptRate:0,dispatchAttempt1:0,dispatchAttempt2:0,dispatchAttempt3:0,dispatchAttemptDenominator:total,dispatchAttempt1Rate:0,dispatchAttempt2Rate:0,dispatchAttempt3Rate:0};}
  function shopeePlaceholder(state,source,total){
    const date=dateOnly(source.reportDate),sid=String(source.snapshotId||'').trim();
    const cn=countOf(source,'SHOPEECN'),vn=countOf(source,'SHOPEEVN');
    const all=shopeeMetric(total),cnm=shopeeMetric(cn),vnm=shopeeMetric(vn),other=shopeeMetric(0);
    return {
      ...(state||{}),businessType:'SHOPEE',reportDate:date,sourceName:source.sourceName||state?.sourceName||'',snapshotId:sid||state?.snapshotId||'',snapshotStatus:'IMPORTED',dailyReportReady:true,
      pnhBills:[],dailyParseRows:[],dailyParseSummary:{totalRecognized:total,groupCounts:{CN:cn,VN:vn,OTHER:0},conflictCount:0},sourceTotal:total,
      scanResults:[],trackResults:[],trackEvents:[],finalRows:[],carryBills:[],nextCarryBills:[],needTrackBills:[],processing:{running:false,paused:false,phase:''},
      v55Summary:{...all,__source:'V160_CURRENT_IMPORT'},
      dashboard:{metrics:all,recipientGroups:{ALL:{metrics:all},CN:{metrics:cnm},VN:{metrics:vnm},OTHER:{metrics:other}},recipientTrends:{},regions:{PP:{},PV:{}},regionTrends:{PP:{},PV:{}},dashboardRows:[],v55Summary:{...all,__source:'V160_CURRENT_IMPORT'}},
      detailTabs:{all:{rows:[],total:0},abnormal:{rows:[],total:0},dashboard:{rows:[],total:0}},historySummary:historyPlaceholder(state?.historySummary,date,total,'SHOPEE'),
      __v160Provisional:true,__v160ExpectedTotal:total
    };
  }
  function sync(){
    const source=imported();
    if(!source||!dateOnly(source.reportDate)||!source.snapshotId)return false;
    const ccTotal=expected(source,CCSL_TYPES),shTotal=expected(source,SHOPEE_TYPES);
    let changed=false;
    const cc=getCcsl();
    if(needsReset(cc,source,ccTotal,'CCSL')){changed=setCcsl(ccslPlaceholder(cc,source,ccTotal))||changed;}
    const sh=getShopee();
    if(needsReset(sh,source,shTotal,'SHOPEE')){changed=setShopee(shopeePlaceholder(sh,source,shTotal))||changed;}
    return changed;
  }
  function handoffHomeClassification(){
    if(String(global.__CE_QC_HOME_CLASSIFICATION_OWNER__||'')!=='V64')return;
    const refreshClassification=global.__CE_QC_V64_WHPP_TOTAL_KPI__?.refreshClassification;
    if(typeof refreshClassification!=='function')return;
    const run=()=>{try{refreshClassification();}catch(error){console.warn('[CE-QC][V160_HOME_HANDOFF]',error);}};
    if(typeof queueMicrotask==='function')queueMicrotask(run);else setTimeout(run,0);
  }
  function install(){
    const oldRender=global.renderAll;
    if(typeof oldRender==='function'&&!oldRender.__v160Wrapped){
      const wrapped=function(){sync();const result=oldRender.apply(this,arguments);handoffHomeClassification();return result;};
      wrapped.__v160Wrapped=true;global.renderAll=wrapped;
    }
    const oldRefresh=global.refresh;
    if(typeof oldRefresh==='function'&&!oldRefresh.__v160Wrapped){
      const wrapped=async function(){const result=await oldRefresh.apply(this,arguments);sync();return result;};
      wrapped.__v160Wrapped=true;global.refresh=wrapped;
    }
    if(sync())global.renderAll?.();
    document.addEventListener('ce-qc-run-complete',()=>{setTimeout(()=>{try{global.refresh?.();}catch{}},50);});
    global.__CE_QC_V160_CURRENT_HOME_TRUTH__={version:VERSION,homeRenderHandoff:V426_HOME_RENDER_HANDOFF,sync,handoffHomeClassification};
    console.info('[CE-QC][V160_CURRENT_HOME_TRUTH]',VERSION,V426_HOME_RENDER_HANDOFF);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);
