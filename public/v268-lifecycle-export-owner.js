(function installV268LifecycleExportOwner(global){
  if(global.__CE_QC_V268_LIFECYCLE_EXPORT__)return;
  global.__CE_QC_V268_LIFECYCLE_EXPORT__=true;
  const ID='2026-08-23-v268-auto-lifecycle-export-freshness-v1';
  const TYPES=['ALL','CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'];
  let exportBusy=false;
  let observer=null;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const text=n=>String(n?.textContent||'').trim();
  const byId=id=>document.getElementById(id);
  function khDate(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
  function dateKey(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):'';}
  async function api(url,options={}){const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});const raw=await r.text();let j={};try{j=raw?JSON.parse(raw):{};}catch{}if(!r.ok||j.ok===false)throw new Error(j.error||j.message||`HTTP ${r.status}`);return j;}

  function selectedExportRange(){
    const period=document.querySelector('.period-tab.active')?.dataset?.period||'daily';
    const base=dateKey(byId('periodExportDate')?.value||'');
    let from=dateKey(byId('periodExportFrom')?.value||'');
    let to=dateKey(byId('periodExportTo')?.value||'');
    if(period==='daily')from=to=base;
    if((period==='weekly'||period==='monthly')&&base){
      const d=new Date(`${base}T12:00:00+07:00`);
      if(period==='weekly'){
        const day=(d.getDay()+6)%7;
        const a=new Date(d);a.setDate(d.getDate()-day);
        const b=new Date(a);b.setDate(a.getDate()+6);
        from=khDate(a);to=khDate(b);
      }else{
        from=khDate(new Date(d.getFullYear(),d.getMonth(),1,12));
        to=khDate(new Date(d.getFullYear(),d.getMonth()+1,0,12));
      }
    }
    return {period,fromDate:from,toDate:to};
  }
  function selectedBusiness(){
    const raw=String(byId('periodExportBusiness')?.value||'ALL').toUpperCase();
    return TYPES.includes(raw)?raw:'ALL';
  }
  function progressMessage(message,tone=''){
    const n=byId('exportProgress');if(!n)return;
    n.textContent=message;n.dataset.v268Tone=tone;
  }

  async function reconcileBeforeExport(selection){
    const payload={businessType:selection.businessType,fromDate:selection.fromDate,toDate:selection.toDate};
    progressMessage(`导出前自动刷新：正在核对 ${payload.businessType} ${payload.fromDate} 至 ${payload.toDate} 的非终态票…`,'working');
    const started=await api('/api/v246/tracking/reconcile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const jobId=started?.job?.jobId;
    if(!jobId)throw new Error('自动刷新任务没有返回任务编号');
    const deadline=Date.now()+30*60*1000;
    while(Date.now()<deadline){
      const result=await api(`/api/v246/tracking/job/${encodeURIComponent(jobId)}`);
      const job=result?.job||{};
      const status=String(job.status||'').toUpperCase();
      progressMessage(job.message||`导出前自动刷新 ${Number(job.progress||0)}%`,'working');
      if(status==='COMPLETED'){
        const r=job.result||{};
        const failed=Number(r.failed??job.failed??0);
        const refreshed=Number(r.refreshed??job.refreshed??0);
        const candidates=Number(r.candidates??job.total??0);
        if(failed>0){
          const e=new Error(`仍有 ${failed.toLocaleString('zh-CN')} 票接口刷新失败；为避免导出旧状态，本次暂不生成Excel。系统会继续自动重试，稍后再次导出即可。`);
          e.code='V268_REFRESH_INCOMPLETE';throw e;
        }
        progressMessage(`状态已更新：核对 ${candidates.toLocaleString('zh-CN')} 票，刷新 ${refreshed.toLocaleString('zh-CN')} 票；正在生成最新Excel…`,'ok');
        return job;
      }
      if(status==='FAILED'||status==='CANCELLED')throw new Error(job.message||'导出前自动刷新失败');
      await sleep(1500);
    }
    throw new Error('导出前自动刷新超过30分钟，未生成Excel；后台任务仍可继续运行。');
  }

  function ensureSevenBusinessOptions(){
    const select=byId('periodExportBusiness');if(!select||select.dataset.v268Seven==='1')return;
    const labels={ALL:'全部7业务',CE:'CE',CEAF:'CEAF空运',TBKH:'TBKH',ALI1688:'ALI1688',WHPP:'WHPP本土',SHOPEECN:'SHOPEE CN',SHOPEEVN:'SHOPEE VN'};
    const old=String(select.value||'ALL').toUpperCase();
    select.innerHTML=TYPES.map(v=>`<option value="${v}">${labels[v]}</option>`).join('');
    select.value=TYPES.includes(old)?old:'ALL';
    select.dataset.v268Seven='1';
  }

  function retireDuplicatePanels(){
    const old=byId('v183HistoryRefreshPanel');if(old){old.hidden=true;old.dataset.v268Retired='duplicate-history-refresh';}
    const importPage=byId('importPage')||document.querySelector('[data-page-root="import"]');
    const scope=importPage||document;
    [...scope.querySelectorAll('section,.panel,article')].forEach(panel=>{
      const heading=panel.querySelector('h2,h3,.panel-title');
      if(heading&&/跨日遗留独立处理/.test(text(heading))){panel.hidden=true;panel.dataset.v268Retired='duplicate-carryover-manual';}
    });
  }

  function simplifyTrackingPanel(){
    const panel=byId('v246TrackingPanel');if(!panel)return;
    const h=panel.querySelector('h3');if(h)h.textContent='自动持续追踪 / 导出数据保鲜';
    const p=panel.querySelector('.v246-head p');if(p)p.textContent='日报第一次出现即锁定进QC追踪账本；未POD、未完成退回、未取消的票会持续自动刷新。每2小时刷新OPEN票，02:00复核最近30天；漏跑会在开机后补跑。正式导出时系统会再自动刷新所选区间的非终态票，成功后才生成Excel。';
    const b7=byId('v2467'),b30=byId('v24630');if(b7)b7.hidden=true;if(b30)b30.hidden=true;
    const run=byId('v246Run');if(run){run.textContent='立即补核一次';run.classList.remove('primary');}
    const read=byId('v246Read');if(read)read.textContent='查看追踪状态';
    const status=byId('v246Status');if(status&&!panel.dataset.v268Initialized){status.textContent='正常情况下无需手动操作：昨天遗留的OPEN票会继续自动追踪；导出也会自动做最后一次状态刷新。只有排查异常时才需要“查看追踪状态/立即补核一次”。';}
    panel.dataset.v268Initialized='1';
  }

  function addUnifiedNote(){
    const importPage=byId('importPage');if(!importPage||byId('v268ImportLifecycleNote'))return;
    const note=document.createElement('div');note.id='v268ImportLifecycleNote';note.style.cssText='margin:12px 0;padding:11px 14px;border:1px solid #d8e7f6;border-radius:8px;background:#f6faff;color:#365a7d;font-size:12px;line-height:1.65';
    note.innerHTML='<b>跨日遗留已并入自动持续追踪：</b> 每日日报只负责把新单锁定进QC池；昨天及更早仍未终态的单号不会因为新日报而丢失，会继续按2小时/02:00机制自动刷新。无需再单独手工“跨日遗留复查”。';
    const target=importPage.querySelector('.page-heading')||importPage.firstElementChild;target?.insertAdjacentElement('afterend',note);
  }

  function enhance(){ensureSevenBusinessOptions();retireDuplicatePanels();simplifyTrackingPanel();addUnifiedNote();}

  const original=typeof global.exportPeriodReport==='function'?global.exportPeriodReport:null;
  if(original&&!original.__v268Wrapped){
    const wrapped=async function(){
      if(exportBusy)return;
      const range=selectedExportRange();
      const businessType=selectedBusiness();
      if(!range.fromDate||!range.toDate){progressMessage('请选择有效的导出日期范围。','warn');return;}
      if(range.fromDate>range.toDate){progressMessage('开始日期不能晚于结束日期。','warn');return;}
      exportBusy=true;
      try{
        await reconcileBeforeExport({businessType,fromDate:range.fromDate,toDate:range.toDate});
        return await original.apply(this,arguments);
      }catch(e){progressMessage(`未导出：${e.message||e}`,'danger');console.error('[CE-QC][V268_EXPORT_FRESHNESS]',e);}
      finally{exportBusy=false;}
    };
    wrapped.__v268Wrapped=true;wrapped.__v268Original=original;global.exportPeriodReport=wrapped;
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',enhance,{once:true});else queueMicrotask(enhance);
  observer=new MutationObserver(()=>enhance());observer.observe(document.documentElement,{subtree:true,childList:true});
  console.info('[CE-QC][V268_LIFECYCLE_EXPORT]',ID,'manual carryover + duplicate history-refresh UI consolidated; period export auto-reconciles OPEN shipments before workbook generation.');
})(window);
