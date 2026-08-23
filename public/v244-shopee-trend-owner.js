(function installV244ShopeeTrendOwner(global){
  if(global.__CE_QC_V244_SHOPEE_TREND_OWNER__)return;
  global.__CE_QC_V244_SHOPEE_TREND_OWNER__=true;
  const VERSION='2026-08-23-v244-shopee-operational-trends-ui-v1';
  const PATH_TYPE={shopeecn:'SHOPEECN',shopeevn:'SHOPEEVN'};
  const cache=new Map();
  let timer=null;
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const type=()=>PATH_TYPE[String(location.pathname||'').replace(/^\//,'').toLowerCase()]||'';
  const range=()=>{const to=String(document.getElementById('topRangeTo')?.value||document.getElementById('dashboardRangeTo')?.value||'').slice(0,10);const from=String(document.getElementById('topRangeFrom')?.value||document.getElementById('dashboardRangeFrom')?.value||to).slice(0,10);return{from,to};};
  const root=()=>document.getElementById('shopeePage');
  const fmt=(value,kind)=>value===null||value===undefined?'—':kind==='days'?`${num(value).toFixed(2)}天`:Math.round(num(value)).toLocaleString('zh-CN');

  function svgNode(tag,attrs={}){const node=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,v));return node;}
  function renderCard(card,{title,kind='count',dates=[],values=[],label}){
    if(!card)return;
    const width=360,height=158,pad={l:42,r:54,t:18,b:30};
    card.innerHTML='<div class="v18-chart-head"><h3></h3><span></span></div><div class="v18-chart-legend"></div><div class="v18-chart-plot"></div><div class="v18-chart-current"></div><p class="v18-chart-note"></p>';
    card.querySelector('h3').textContent=title;
    card.querySelector('.v18-chart-head span').textContent=`${dates.length}个有效日报日`;
    const legend=card.querySelector('.v18-chart-legend');
    const item=document.createElement('span');const mark=document.createElement('i');mark.style.background='#1677ff';item.append(mark,document.createTextNode(label));legend.appendChild(item);
    const svg=svgNode('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':title});
    const valid=values.filter(v=>v!==null&&v!==undefined).map(num);
    const maxData=Math.max(...valid,1);
    const max=kind==='days'?Math.max(3,Math.ceil(maxData*1.25*10)/10):Math.max(1,Math.ceil(maxData*1.2));
    for(let i=0;i<=3;i++){
      const y=pad.t+(height-pad.t-pad.b)*i/3;
      svg.appendChild(svgNode('line',{x1:pad.l,x2:width-pad.r,y1:y,y2:y,class:'v18-grid'}));
      const text=svgNode('text',{x:pad.l-6,y:y+4,'text-anchor':'end',class:'v18-axis'});text.textContent=fmt(max*(1-i/3),kind);svg.appendChild(text);
    }
    dates.forEach((date,i)=>{const x=pad.l+(width-pad.l-pad.r)*i/Math.max(1,dates.length-1);const text=svgNode('text',{x,y:height-7,'text-anchor':'middle',class:'v18-axis v18-date-axis'});text.textContent=String(date||'').slice(5)||'—';svg.appendChild(text);});
    const points=[];
    values.forEach((value,i)=>{if(value===null||value===undefined)return;const v=num(value),x=pad.l+(width-pad.l-pad.r)*i/Math.max(1,dates.length-1),y=pad.t+(height-pad.t-pad.b)*(1-v/max);points.push({x,y,v});const dot=svgNode('circle',{cx:x,cy:y,r:3,fill:'#1677ff'});const titleNode=svgNode('title');titleNode.textContent=`${dates[i]} · ${label} · ${fmt(v,kind)}`;dot.appendChild(titleNode);svg.appendChild(dot);if(dates.length<=10){const text=svgNode('text',{x,y:Math.max(11,y-6),'text-anchor':'middle',fill:'#1677ff','font-size':'8','font-weight':'700'});text.textContent=fmt(v,kind);svg.appendChild(text);}});
    if(points.length>=2)svg.appendChild(svgNode('polyline',{points:points.map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:'#1677ff','stroke-width':'2.2','stroke-linejoin':'round','stroke-linecap':'round'}));
    card.querySelector('.v18-chart-plot').appendChild(svg);
    const last=points.at(-1)?.v??null,prev=points.at(-2)?.v??null,delta=last===null||prev===null?null:last-prev;
    const current=card.querySelector('.v18-chart-current');const box=document.createElement('div');box.innerHTML='<span></span><b></b><small></small>';box.querySelector('span').textContent=`${label} 当前`;box.querySelector('b').textContent=fmt(last,kind);box.querySelector('b').style.color='#1677ff';box.querySelector('small').textContent=delta===null?'较昨日 —':`较昨日 ${delta>=0?'↑':'↓'}${kind==='days'?Math.abs(delta).toFixed(2)+'天':Math.round(Math.abs(delta)).toLocaleString('zh-CN')}`;current.appendChild(box);
    card.querySelector('.v18-chart-note').textContent=points.length<2?`历史快照不足（${points.length}/${Math.max(2,dates.length||7)}），累计到2个有效日期后自动显示折线`:'按每日真实日报成员与POD结果计算；当前值与曲线最后有效节点保持一致';
    card.dataset.v244=VERSION;
  }

  function render(data){
    const t=type(),r=root();if(!t||!r||r.hidden)return;
    const section=r.querySelector('.v18-trend-section');if(!section)return;
    const cards=[...section.querySelectorAll('.v18-chart-card')].slice(0,4);if(cards.length<4)return;
    const dates=data.dates||[];
    renderCard(cards[0],{title:'票数趋势',label:'票数',dates,values:data.ticket||[]});
    renderCard(cards[1],{title:'POD数量趋势',label:'POD数量',dates,values:data.pod||[]});
    renderCard(cards[2],{title:'平均签收天数趋势',label:'平均签收天数',kind:'days',dates,values:data.avgPodDays||[]});
    renderCard(cards[3],{title:'OC数量趋势',label:'OC数量',dates,values:data.oc||[]});
    section.dataset.v244ShopeeTrend=VERSION;
  }

  async function refresh(force=false){
    const t=type(),rg=range();if(!t||!rg.to)return;
    const key=`${t}|${rg.from}|${rg.to}`;
    if(!force&&cache.has(key)){render(cache.get(key));return;}
    try{
      const response=await fetch(`/api/v244/shopee-trends?businessType=${encodeURIComponent(t)}&from=${encodeURIComponent(rg.from)}&to=${encodeURIComponent(rg.to)}`,{cache:'no-store',credentials:'same-origin'});
      const data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.error||`HTTP ${response.status}`);
      cache.set(key,data);render(data);
    }catch(error){console.warn('[V244 Shopee trend]',error);}
  }
  function schedule(delay=500){clearTimeout(timer);timer=setTimeout(()=>void refresh(true),delay);}
  function bind(){
    if(!type())return;
    for(const id of ['topRangeFrom','topRangeTo','dashboardRangeFrom','dashboardRangeTo'])document.getElementById(id)?.addEventListener('change',()=>schedule(700));
    schedule(900);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  const previousFetch=global.fetch?.bind(global);
  if(previousFetch){global.fetch=function v244ShopeeTrendFetchBridge(input,init){const text=typeof input==='string'?input:String(input?.url||'');const promise=previousFetch(input,init);if(type()&&text.includes('/api/v234/trends?'))promise.then(()=>schedule(350)).catch(()=>{});return promise;};}
})(window);
