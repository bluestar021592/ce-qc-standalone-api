(function (global) {
  const svgNs = 'http://www.w3.org/2000/svg';
  const fmt = (value, type) => value === null ? '—' : type === 'rate' ? `${Number(value).toFixed(2)}%` : Math.round(value).toLocaleString('zh-CN');
  const lastTwo = values => values.filter(value => value !== null).slice(-2);

  function createSvg(tag, attrs = {}) {
    const node = document.createElementNS(svgNs, tag);
    Object.entries(attrs).forEach(([key,value]) => node.setAttribute(key, value));
    return node;
  }

  function render(container, chart) {
    container.innerHTML = `<div class="v18-chart-head"><h3>${chart.title}</h3><span>近7天⌄</span></div><div class="v18-chart-legend"></div><div class="v18-chart-plot"></div><div class="v18-chart-current"></div><p class="v18-chart-note">当前值与曲线最后有效节点保持一致</p>`;
    const legend = container.querySelector('.v18-chart-legend');
    chart.series.forEach(series => legend.insertAdjacentHTML('beforeend', `<span><i style="background:${series.color}"></i>${series.name}</span>`));
    const width=330,height=142,pad={l:38,r:38,t:12,b:25};
    const plot=container.querySelector('.v18-chart-plot');
    const svg=createSvg('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':chart.title});
    const clipId=`v18clip-${Math.random().toString(36).slice(2)}`;
    const defs=createSvg('defs'),clip=createSvg('clipPath',{id:clipId});
    clip.appendChild(createSvg('rect',{x:pad.l,y:pad.t,width:width-pad.l-pad.r,height:height-pad.t-pad.b}));defs.appendChild(clip);svg.appendChild(defs);
    const all=chart.series.flatMap(series=>series.values).filter(value=>value!==null);
    const maxData=Math.max(...all,1); const max=chart.type==='rate'?(chart.oc?Math.max(3,maxData*1.25):100):Math.ceil(maxData/1000)*1000;
    for(let i=0;i<=3;i++){const y=pad.t+(height-pad.t-pad.b)*i/3;svg.appendChild(createSvg('line',{x1:pad.l,x2:width-pad.r,y1:y,y2:y,class:'v18-grid'}));const text=createSvg('text',{x:pad.l-6,y:y+4,'text-anchor':'end',class:'v18-axis'});text.textContent=fmt(max*(1-i/3),chart.type);svg.appendChild(text);}
    chart.dates.forEach((date,index)=>{const x=pad.l+(width-pad.l-pad.r)*(index/Math.max(1,chart.dates.length-1));const text=createSvg('text',{x,y:height-5,'text-anchor':'middle',class:'v18-axis'});text.textContent=date;text.setAttribute('x',x);svg.appendChild(text);});
    chart.series.forEach(series=>{
      let segment=[];const flush=()=>{if(segment.length<2){segment=[];return;}const poly=createSvg('polyline',{points:segment.map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:series.color,'stroke-width':'2.2','clip-path':`url(#${clipId})`});svg.appendChild(poly);segment=[];};
      let lastPoint=null;
      series.values.forEach((value,index)=>{if(value===null){flush();return;}const x=pad.l+(width-pad.l-pad.r)*(index/Math.max(1,chart.dates.length-1));const y=pad.t+(height-pad.t-pad.b)*(1-value/max);segment.push({x,y});lastPoint={x,y,value,index};const dot=createSvg('circle',{cx:x,cy:y,r:3,fill:series.color,'clip-path':`url(#${clipId})`});const title=createSvg('title');const n=series.numerators[index],d=series.denominators[index];title.textContent=`${chart.dates[index]} · ${series.name} · ${Number.isFinite(n)&&Number.isFinite(d)?`${n}/${d} · `:''}${fmt(value,chart.type)}`;dot.appendChild(title);svg.appendChild(dot);});flush();
      if(lastPoint){const label=createSvg('text',{x:Math.min(width-3,lastPoint.x+5),y:Math.max(13,lastPoint.y-6),fill:series.color,class:'v18-last-label','text-anchor':lastPoint.x>width-70?'end':'start'});label.textContent=fmt(lastPoint.value,chart.type);svg.appendChild(label);}
    });
    plot.appendChild(svg);
    const current=container.querySelector('.v18-chart-current');
    chart.series.forEach(series=>{const valid=lastTwo(series.values);const value=valid.at(-1)??null,previous=valid.at(-2)??null;const delta=value===null||previous===null?null:value-previous;current.insertAdjacentHTML('beforeend',`<div data-series="${series.name}"><span>${series.name} 当前</span><b style="color:${series.color}">${fmt(value,chart.type)}</b><small>${delta===null?'较昨日 —':`较昨日 ${delta>=0?'↑':'↓'}${Math.abs(delta).toFixed(2)}${chart.type==='rate'?'个百分点':''}`}</small></div>`);if(value!==global.DashboardDataAdapterV18.last(series.values)){container.dataset.bindingError='true';console.error('V18 chart current value mismatch',chart.title,series.name);}});
  }
  global.RateTrendCardV18={render};
})(window);
