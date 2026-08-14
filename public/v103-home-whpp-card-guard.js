(function installHomeWhppCardGuardV103(global){
  if(global.__CE_QC_V103_HOME_WHPP__)return;
  const VERSION='2026-08-14-v103-home-whpp-card-guard-v2';
  const SIX=['CE','CEAF空运','TBKH','SHOPEE CN','SHOPEE VN','ALI1688'];
  let timer=null;

  const num=value=>{
    const n=Number(String(value??'').replace(/[,%\s]/g,''));
    return Number.isFinite(n)?n:0;
  };
  const fmt=value=>Number(value||0).toLocaleString('zh-CN');
  const rate=(value,total)=>total?Number(value||0)*100/Number(total):0;
  const setText=(node,text)=>{if(node&&node.textContent!==text)node.textContent=text;};

  function cardByLabel(grid,label){
    return [...(grid?.querySelectorAll?.('.v18-business-card')||[])]
      .find(card=>String(card.querySelector('span')?.textContent||'').trim()===label)||null;
  }

  function singleDaySelected(){
    const from=String(document.getElementById('topRangeFrom')?.value||'').slice(0,10);
    const to=String(document.getElementById('topRangeTo')?.value||'').slice(0,10);
    return Boolean(from&&to&&from===to);
  }

  function ensureWhpp(grid){
    let card=cardByLabel(grid,'WHPP本土');
    if(card)return card;
    card=document.createElement('button');
    card.type='button';
    card.className='v18-business-card cyan';
    card.dataset.v103Business='WHPP';
    card.onclick=()=>typeof global.navigateWhppPage==='function'
      ? global.navigateWhppPage()
      : (typeof global.navigatePage==='function'?global.navigatePage('whpp'):null);
    card.innerHTML='<span>WHPP本土</span><small>今日票数</small><b>0</b><em>占总票数 0.00%</em>';
    grid.appendChild(card);
    return card;
  }

  function patch(){
    const home=document.getElementById('homePage');
    if(!home||home.hidden||!singleDaySelected())return;
    const grid=home.querySelector('.v18-business-grid');
    if(!grid)return;
    const totalCard=cardByLabel(grid,'总览');
    if(!totalCard)return;

    const total=num(totalCard.querySelector('b')?.textContent);
    const sixTotal=SIX.reduce((sum,label)=>sum+num(cardByLabel(grid,label)?.querySelector('b')?.textContent),0);
    const residual=Math.max(0,total-sixTotal);
    const existing=cardByLabel(grid,'WHPP本土');
    if(residual<=0&&!existing)return;

    const whpp=ensureWhpp(grid);
    const existingValue=num(existing?.querySelector('b')?.textContent);
    const whppValue=residual>0?residual:existingValue;
    const finalTotal=sixTotal+whppValue;

    setText(totalCard.querySelector('b'),fmt(finalTotal));
    setText(whpp.querySelector('b'),fmt(whppValue));
    setText(whpp.querySelector('em'),`占总票数 ${rate(whppValue,finalTotal).toFixed(2)}%`);
    for(const label of SIX){
      const card=cardByLabel(grid,label);
      if(card)setText(card.querySelector('em'),`占总票数 ${rate(num(card.querySelector('b')?.textContent),finalTotal).toFixed(2)}%`);
    }
    setText(totalCard.querySelector('em'),'占总票数 100.00%');
  }

  function schedule(delay=0){
    clearTimeout(timer);
    timer=setTimeout(patch,Math.max(0,delay));
  }

  function install(){
    const originalRenderAll=global.renderAll;
    if(typeof originalRenderAll==='function'&&!originalRenderAll.__v103WhppGuardWrapped){
      const wrapped=function(){
        const result=originalRenderAll.apply(this,arguments);
        schedule(0);
        return result;
      };
      wrapped.__v103WhppGuardWrapped=true;
      global.renderAll=wrapped;
    }
    document.addEventListener('click',event=>{
      if(event.target?.closest?.('#topRangeQuery,[data-page="home"]'))schedule(20);
    },true);
    document.addEventListener('ce-qc-run-complete',()=>schedule(0));
    schedule(0);
    schedule(1000);
    global.__CE_QC_V103_HOME_WHPP__={version:VERSION,patch,schedule};
    console.info('[CE-QC][V103_HOME_WHPP]',VERSION);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})(window);
