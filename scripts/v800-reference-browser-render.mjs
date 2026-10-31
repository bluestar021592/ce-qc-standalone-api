// V800: browser-rendered visual gate on the actual V625+V792 HTML/CSS/JS.
// This uses a private in-memory, API-free fixture, NEVER the live CE database.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=path.resolve(fileURLToPath(new URL('../public/',import.meta.url)));
const out=path.resolve(process.env.V800_SCREENSHOT_DIR||'artifacts/v800-visual');
await fs.mkdir(out,{recursive:true});
const contentTypes={'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml',
  '.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.json':'application/json'};
const server=createServer(async (req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname.startsWith('/api/')){
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({ok:true,fixture:'NO_REAL_BUSINESS_DATA'}));return;
  }
  if(url.pathname==='/'||url.pathname==='/whpp'){
    let html=await fs.readFile(path.join(root,'v625-shell.html'),'utf8');
    const isWhpp=url.pathname==='/whpp';
    html=html.replaceAll('__V625_PAGE_KEY__',isWhpp?'whpp':'home')
      .replaceAll('__V625_BUSINESS_TYPE__',isWhpp?'WHPP':'')
      .replaceAll('__V625_PAGE_TITLE__',isWhpp?'WHPP本土看板':'首页总看板');
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    res.end(html);return;
  }
  const rel=decodeURIComponent(url.pathname).replace(/^\/+/,'');
  const filename=path.resolve(root,rel);
  if(!filename.startsWith(root+path.sep)){
    res.writeHead(403);res.end();return;
  }
  try{
    const body=await fs.readFile(filename);
    res.writeHead(200,{'Content-Type':contentTypes[path.extname(filename)]||'application/octet-stream',
      'Cache-Control':'no-store'});res.end(body);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
  browser=await chromium.launch({headless:true});
  for(const item of [
    {route:'/',key:'home',file:'home-1536x1024.png',width:1536,height:1024},
    {route:'/whpp',key:'whpp',file:'whpp-1672x941.png',width:1672,height:941}
  ]){
    const page=await browser.newPage({viewport:{width:item.width,height:item.height},deviceScaleFactor:1,
      locale:'zh-CN'});
    await page.goto(origin+item.route+'?auth=v625',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.body.classList.contains('v792-reference'),
      null,{timeout:15000});
    const data=await page.evaluate((key)=>{
      const current=document.getElementById(key==='home'?'v625Home':'v625Business');
      if(current)current.hidden=false; // isolated fixture lacks real API session
      if(key==='whpp'){
        for(const id of ['kpiReturnedCard','kpiReturnRateCard','v792WhppAnalysis','v792WhppTables']){
          const node=document.getElementById(id);if(node)node.hidden=false;
        }
      }
      const r=sel=>document.querySelector(sel)?.getBoundingClientRect();
      const box=sel=>{const b=r(sel);return b?{top:b.top,left:b.left,right:b.right,bottom:b.bottom,width:b.width}:null};
      const visible=sel=>[...document.querySelectorAll(sel)].filter(e=>{
        const css=getComputedStyle(e);return css.display!=='none'&&css.visibility!=='hidden';
      }).length;
      return {page:key,
        topRow:box('.v792-home-main-row'),topChildren:visible('.v792-home-main-row>.v625-panel'),
        homeCards:visible('.v625-home-business-panel .v625-business-card:not(.v632-total-card)'),
        totalCard:visible('.v625-home-business-panel .v632-total-card.v792-total-summary'),
        bottomRow:box('.v792-home-bottom-row'),
        management:box('#v792HomeManagement'),optionalTrend:box('.v792-optional-trend'),
        unfinished:box('.v626-open-pod-panel'),
        timingPanel:box('.v625-signing-panel'),
        timingCards:visible('.v625-signing-panel .v625-timing-card'),
        timingMetrics:visible('.v801-timing-summary .v801-timing-summary-tile'),
        timingPanelOverflow:(()=>{const e=document.querySelector('.v625-signing-panel');
          return Boolean(e&&e.scrollHeight>e.clientHeight+4&&getComputedStyle(e).overflowY!=='visible')})(),
        analysis:box('#v792WhppAnalysis'),tables:box('#v792WhppTables'),
        kpis:visible('#v625Business .v625-kpi-row>article:not([hidden])'),
        kpiIcons:visible('#v625Business .v625-kpi-row>article .v792-kpi-symbol'),
        sidebar:box('.v625-sidebar'),pagebar:box('.v625-pagebar'),
        overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2};
    },item.key);
    if(item.key==='home'){
      assert.equal(data.topChildren,4,'home top row must contain progress/status/quick/log');
      assert.ok(data.topRow?.width>600,'home top row must be rendered');
      assert.ok(data.bottomRow?.width>600,'home signing/open POD row must exist');
      assert.ok(data.unfinished?.top>=data.bottomRow.bottom-3,
        'unfinished POD must be a separate full-width panel after signing');
      assert.ok(data.management?.top>=data.unfinished.bottom-3
        &&data.management?.top<data.optionalTrend?.top,
        'home data management must follow unfinished POD and precede optional trend');
      assert.ok(data.timingPanel?.width>850,'signing board must use full available content width');
      assert.equal(data.timingCards,4,'all four signing business cards must be visible');
      assert.equal(data.timingMetrics,8,'all eight evidence-only signing summary metrics must be visible');
      assert.equal(data.timingPanelOverflow,false,'signing board may not become an internal scroll-box');
      assert.equal(data.totalCard,1,'grand-total card must not be discarded to mimic 7-card screenshot');
      assert.equal(data.homeCards,7,'home must render 7 business tiles');
    } else {
      assert.ok(data.analysis?.width>600,'WHPP signing and returns analysis must render');
      assert.ok(data.tables?.width>600,'WHPP anomaly and return tables must render');
      assert.equal(data.kpis,8,'WHPP 8 reference KPI tiles must be visible');
      assert.equal(data.kpiIcons,8,'WHPP 8 KPI icons must be visible in the browser');
    }
    assert.ok(!data.overflow,'horizontal clipping/overflow at screenshot width');
    await page.screenshot({path:path.join(out,item.file),fullPage:true});
    console.log('[V800] '+item.key+' screenshot/geometry PASS: '+JSON.stringify(data));
    await page.close();
  }
  console.log('[V800] Browser rendering geometry and 1536x1024 screenshots PASS');
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
