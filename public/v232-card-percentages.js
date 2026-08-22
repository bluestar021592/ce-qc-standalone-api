(function installV232CardPercentages(global){
  if(global.__CE_QC_V232_CARD_PERCENTAGES__)return;
  global.__CE_QC_V232_CARD_PERCENTAGES__=true;
  const VERSION='2026-08-22-v232-card-percentages-v1';
  let timer=null;
  const number=value=>{const n=Number(String(value||'').replace(/[,\s%]/g,''));return Number.isFinite(n)?n:0;};
  const percent=(value,total)=>total?`${(number(value)*100/total).toFixed(2)}%`:'0.00%';

  function businessDenominator(root){
    const first=root.querySelector('.v18-business-card b');
    return number(first?.textContent);
  }
  function homeDenominator(root){
    let sum=0;
    root.querySelectorAll('.v18-business-card').forEach(card=>{
      const label=String(card.querySelector('span')?.textContent||'').trim().toUpperCase().replace(/\s+/g,'');
      if(!label||label.includes('总览')||label==='TOTAL'||label.includes('SHOPEECN')||label.includes('SHOPEEVN'))return;
      sum+=number(card.querySelector('b')?.textContent);
    });
    return sum||number(root.querySelector('.v18-business-card b')?.textContent);
  }
  function applyRoot(root){
    if(!root||!root.isConnected)return;
    const total=root.classList.contains('v18-business-page')?businessDenominator(root):homeDenominator(root);
    if(!total)return;
    root.querySelectorAll('.v18-core-grid .v18-metric-card').forEach(card=>{
      const valueNode=card.querySelector('b'),note=card.querySelector('small');
      if(!valueNode||!note)return;
      const displayed=String(valueNode.textContent||'');
      if(displayed.includes('%')){
        if(!String(note.textContent||'').includes('%'))note.textContent=`当前比率 ${displayed.trim()}`;
        return;
      }
      note.textContent=`占本业务 ${percent(displayed,total)} · 点击查看明细`;
    });
  }
  function apply(){
    applyRoot(document.getElementById('homePage'));
    applyRoot(document.getElementById('ccslPage'));
    applyRoot(document.getElementById('shopeePage'));
  }
  function schedule(delay=80){clearTimeout(timer);timer=setTimeout(apply,delay);}
  const observer=new MutationObserver(records=>{
    if(records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1&&(node.matches?.('.v18-dashboard-page,.v18-core-grid,.v18-metric-card')||node.querySelector?.('.v18-core-grid,.v18-metric-card')))))schedule();
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('click',event=>{if(event.target?.closest?.('#topRangeQuery,.top-range-query,#dashboardRangeQuery,.side-link'))schedule(160);});
  global.addEventListener('popstate',()=>schedule(120));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>schedule(),{once:true});else schedule();
  console.info('[CE-QC][V232_CARD_PERCENTAGES]',VERSION);
})(window);
