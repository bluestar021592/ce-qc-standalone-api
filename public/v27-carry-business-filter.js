(function installV27CarryBusinessFilter(global){
  if (new URLSearchParams(location.search).has('visualTest')) return;
  const BUSINESS=[
    {type:'ALL',label:'全部业务',page:''},
    {type:'CE',label:'CE',page:'ce'},
    {type:'TBKH',label:'TBKH',page:'tbkh'},
    {type:'ALI1688',label:'ALI1688',page:'ali1688'},
    {type:'SHOPEECN',label:'SHOPEE CN',page:'shopeecn'},
    {type:'SHOPEEVN',label:'SHOPEE VN',page:'shopeevn'}
  ];
  let selected='ALL';
  let status='OPEN';
  let summary={};
  let decorating=false;

  const css=document.createElement('style');
  css.textContent=`
    .v27-carry-page>.page-heading{display:none!important}
    .v27-carry-business-wrap{padding:0 14px 14px}.v27-carry-business-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.v27-carry-business-card{border:1px solid #d8e5f4;background:#fff;border-radius:9px;padding:11px 12px;cursor:pointer;text-align:left;transition:.15s ease}.v27-carry-business-card:hover{border-color:#8fbbf7;box-shadow:0 3px 12px rgba(22,119,255,.08)}.v27-carry-business-card.active{background:#edf5ff;border-color:#1677ff;box-shadow:inset 0 0 0 1px #1677ff}.v27-carry-business-card strong{display:block;color:#173d68;font-size:14px}.v27-carry-business-card b{display:block;margin-top:5px;color:#0b315b;font-size:22px}.v27-carry-business-card small{display:inline-block;margin-top:5px;color:#1677ff;font-size:12px}.v27-carry-business-card.all small{color:#7a8da7}.v27-carry-business-cell{border:0;background:transparent;color:#1677ff;font:inherit;font-weight:600;padding:0;cursor:pointer}.v27-carry-business-cell:hover{text-decoration:underline}
    @media(max-width:1200px){.v27-carry-business-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:760px){.v27-carry-business-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.appendChild(css);

  function esc(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
  function fmt(value){return Number(value||0).toLocaleString('zh-CN');}
  function info(type){return BUSINESS.find(item=>item.type===String(type||'').toUpperCase());}
  function go(type){const item=info(type);if(item?.page&&typeof navigatePage==='function')navigatePage(item.page);}
  global.v27CarrySelectBusiness=function(type){selected=BUSINESS.some(item=>item.type===type)?type:'ALL';if(typeof global.v27SetCarryStatus==='function')global.v27SetCarryStatus(status);};
  global.v27CarryGoBusiness=go;

  function selectorHtml(){return `<div class="v27-carry-business-wrap"><div class="v27-carry-business-grid">${BUSINESS.map(item=>`<button class="v27-carry-business-card ${item.type==='ALL'?'all':''} ${selected===item.type?'active':''}" onclick="window.v27CarrySelectBusiness('${item.type}')"><strong>${esc(item.label)}</strong><b>${fmt(summary[item.type])}</b>${item.page?`<small onclick="event.stopPropagation();window.v27CarryGoBusiness('${item.type}')">进入${esc(item.label)}看板 →</small>`:'<small>当前筛选汇总</small>'}</button>`).join('')}</div></div>`;}

  function decorate(){
    if(decorating)return;const host=document.getElementById('v27CarryContent');if(!host)return;
    decorating=true;
    try{
      let wrap=host.querySelector('.v27-carry-business-wrap');
      const toolbar=host.querySelector('.v27-carry-toolbar');
      if(!wrap&&toolbar){toolbar.insertAdjacentHTML('afterend',selectorHtml());wrap=host.querySelector('.v27-carry-business-wrap');}
      else if(wrap)wrap.outerHTML=selectorHtml();
      host.querySelectorAll('.v27-detail-table tbody tr').forEach(row=>{
        const cell=row.children?.[1];if(!cell||cell.querySelector('.v27-carry-business-cell'))return;
        const type=String(cell.textContent||'').trim().toUpperCase();const item=info(type);if(!item?.page)return;
        cell.innerHTML=`<button class="v27-carry-business-cell" onclick="window.v27CarryGoBusiness('${item.type}')">${esc(item.label)}</button>`;
      });
    }finally{decorating=false;}
  }

  function install(){
    if(typeof api==='function'&&!global.__V27_CARRY_API_WRAPPED__){
      const originalApi=api;
      api=async function v27CarryBusinessApi(url,options={}){
        const text=String(url||'');
        if(text.startsWith('/api/v27/carry-monitor?')){
          const parsed=new URL(text,location.origin);status=String(parsed.searchParams.get('status')||status||'OPEN').toUpperCase();
          parsed.pathname='/api/v27/carry-monitor-business';parsed.searchParams.set('businessType',selected);
          const data=await originalApi(parsed.pathname+parsed.search,options);summary=data?.businessSummary||summary;queueMicrotask(decorate);return data;
        }
        return originalApi(url,options);
      };
      global.__V27_CARRY_API_WRAPPED__=true;
    }
    if(typeof global.v27SetCarryStatus==='function'&&!global.__V27_CARRY_STATUS_WRAPPED__){
      const original=global.v27SetCarryStatus;global.v27SetCarryStatus=function(next){status=String(next||'OPEN').toUpperCase();return original(next);};global.__V27_CARRY_STATUS_WRAPPED__=true;
    }
    const host=document.getElementById('v27CarryContent');if(host&&!host.__v27CarryObserved){new MutationObserver(()=>queueMicrotask(decorate)).observe(host,{childList:true,subtree:true});host.__v27CarryObserved=true;decorate();}
  }

  let tries=0;const ready=setInterval(()=>{tries+=1;install();if(global.__V27_CARRY_API_WRAPPED__&&document.getElementById('v27CarryContent'))clearInterval(ready);else if(tries>150)clearInterval(ready);},100);
})(window);
