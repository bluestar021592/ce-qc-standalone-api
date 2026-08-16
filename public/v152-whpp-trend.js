(function installV152WhppTrend(global){
  if(global.__CE_QC_V152_WHPP_TREND__)return;
  const VERSION='2026-08-16-v152-whpp-trend-v1';
  let timer=null,lastKey='',lastAt=0,lastPayload=null;
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const dateNow=()=>String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||new Date().toISOString().slice(0,10)).slice(0,10);

  function points(values,w=520,h=150,p=22){
    const nums=values.map(v=>Number(v||0));
    if(!nums.length)return '';
    const min=Math.min(...nums),max=Math.max(...nums),span=Math.max(1,max-min);
    return nums.map((v,i)=>{
      const x=nums.length===1?w/2:p+(w-p*2)*(i/(nums.length-1));
      const y=max===min?h/2:p+(h-p*2)*(1-(v-min)/span);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }
  function chart(title,dates,values,{percent=false}={}){
    const vals=values.map(v=>Number(v||0));
    const latest=vals.length?vals.at(-1):0;
    const poly=points(vals);
    const firstDate=dates[0]||'—',lastDate=dates.at(-1)||'—';
    return `<article class="v152-whpp-chart"><div class="v152-whpp-chart-head"><span>${esc(title)}</span><b>${percent?`${latest.toFixed(2)}%`:fmt(latest)}</b></div><svg viewBox="0 0 520 150" preserveAspectRatio="none" role="img" aria-label="${esc(title)}"><line x1="22" y1="128" x2="498" y2="128" class="axis"></line>${poly?`<polyline points="${poly}" class="line"></polyline>`:''}</svg><div class="v152-whpp-chart-foot"><span>${esc(firstDate)}</span><span>${esc(lastDate)}</span></div></article>`;
  }
  function ensureStyle(){
    if(document.getElementById('v152WhppTrendStyle'))return;
    const style=document.createElement('style');style.id='v152WhppTrendStyle';style.textContent=`
      #v152WhppTrend{margin-top:14px}.v152-whpp-trend-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:14px}
      .v152-whpp-chart{border:1px solid #d9e5f3;border-radius:10px;background:#fff;padding:12px;min-width:0}.v152-whpp-chart-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.v152-whpp-chart-head span{font-weight:700;color:#12365c}.v152-whpp-chart-head b{font-size:20px;color:#12365c}.v152-whpp-chart svg{display:block;width:100%;height:150px;margin-top:6px;overflow:visible}.v152-whpp-chart .axis{stroke:#dbe6f2;stroke-width:1}.v152-whpp-chart .line{fill:none;stroke:#1677ff;stroke-width:4;stroke-linecap:round;stroke-linejoin:round}.v152-whpp-chart-foot{display:flex;justify-content:space-between;color:#7890aa;font-size:12px}.v152-whpp-empty{padding:28px;text-align:center;color:#6d829a}
      @media(max-width:1100px){.v152-whpp-trend-grid{grid-template-columns:1fr}}
    `;document.head.appendChild(style);
  }
  async function load(){
    const date=dateNow(),key=date;
    if(lastPayload&&lastKey===key&&Date.now()-lastAt<10000)return lastPayload;
    const q=new URLSearchParams({businessType:'WHPP',from:date,to:date});
    const response=await fetch(`/api/v27/trends?${q}`,{cache:'no-store',credentials:'same-origin'});
    const text=await response.text();let body={};try{body=text?JSON.parse(text):{};}catch{}
    if(!response.ok||body.ok===false)throw new Error(body.error||body.message||`HTTP ${response.status}`);
    lastKey=key;lastAt=Date.now();lastPayload=body;return body;
  }
  function host(){return document.getElementById('whppFastPage');}
  function upsert(data){
    const page=host();if(!page||page.hidden)return;
    ensureStyle();
    let section=document.getElementById('v152WhppTrend');
    if(!section){section=document.createElement('section');section.id='v152WhppTrend';section.className='v18-panel';page.appendChild(section);}
    const dates=Array.isArray(data?.dates)?data.dates:[];
    if(dates.length<2){section.innerHTML=`<h2>趋势图表</h2><div class="v152-whpp-empty">当前找到 ${dates.length} 个WHPP有效日报日期。至少2个日期后显示真实趋势，不补造历史数据。</div>`;return;}
    section.innerHTML=`<h2>趋势图表 <small style="font-weight:400;color:#7890aa">最近${dates.length}个有效日报日</small></h2><div class="v152-whpp-trend-grid">${chart('日报票数趋势',dates,data.ticket||[])}${chart('POD率趋势',dates,data.podRate||[],{percent:true})}${chart('OC率趋势',dates,data.ocRate||[],{percent:true})}</div>`;
  }
  async function refreshTrend(){
    if(location.pathname!=='/whpp')return;
    try{upsert(await load());}catch(error){const page=host();if(!page||page.hidden)return;let section=document.getElementById('v152WhppTrend');if(!section){section=document.createElement('section');section.id='v152WhppTrend';section.className='v18-panel';page.appendChild(section);}section.innerHTML=`<h2>趋势图表</h2><div class="v152-whpp-empty">趋势读取失败：${esc(error.message)}</div>`;}
  }
  function schedule(ms=120){clearTimeout(timer);timer=setTimeout(refreshTrend,ms);}
  const observer=new MutationObserver(records=>{
    if(location.pathname!=='/whpp')return;
    const relevant=records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1&&node.id!=='v152WhppTrend'&&!node.closest?.('#v152WhppTrend')));
    if(relevant)schedule(160);
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  global.addEventListener('popstate',()=>schedule(180));
  document.addEventListener('click',event=>{if(event.target?.closest?.('[data-page="whpp"],#topRangeQuery,#dashboardRangeQuery'))schedule(220);});
  document.addEventListener('ce-qc-run-complete',()=>{lastAt=0;schedule(180);});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>schedule(200),{once:true});else schedule(200);
  global.__CE_QC_V152_WHPP_TREND__={version:VERSION,refresh:refreshTrend};
  console.info('[CE-QC][V152_WHPP_TREND]',VERSION);
})(window);
