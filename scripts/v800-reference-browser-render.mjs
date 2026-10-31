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
      assert.equal(data.totalCard,1,'real top total remains visible');
      assert.equal(data.homeCards,7,'all seven business tiles are visible');
      assert.equal(data.topChildren,4,'progress/status/quick/log four-column reference row');
      assert.ok(data.topRow&&data.bottomRow&&data.timingPanel&&data.unfinished,'all reference rows exist');
      assert.equal(data.overflow,false,'no horizontal page overflow');
      const reference=await page.evaluate(()=>{
        const box=selector=>{const n=document.querySelector(selector);
          if(!n)return null;const r=n.getBoundingClientRect();
          return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
        const show=e=>{if(!e)return false;const r=e.getBoundingClientRect();
          return r.width>0&&r.height>0};
        const panel=document.querySelector('#v801TimingDashboard');
        const metrics=[...panel.querySelectorAll('.v801-timing-summary-tile')];
        const cards=[...panel.querySelectorAll('.v625-timing-card')];
        const operationCards=[...document.querySelectorAll('.v792-home-main-row>.v625-panel')].map(e=>{
          const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,bottom:r.bottom}});
        const managementLinks=[...document.querySelectorAll('#v792HomeManagement .v792-management-tile a')]
          .map(e=>e.getAttribute('href'));
        return {business:box('.v625-home-business-panel'),
          operations:box('.v792-home-main-row'),
          operationCards,
          validation:box('.v625-home-validation'),
          validationCards:[...document.querySelectorAll('.v625-home-validation>.v625-panel')].map(e=>{
            const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width}}),
          bottom:box('.v805-reference-bottom'),
          signing:box('#v801TimingDashboard'),
          pod:box('.v626-open-pod-panel'),
          management:box('#v792HomeManagement'),
          trend:box('.v792-optional-trend'),
          visibleCards:cards.filter(show).length,
          visibleMetrics:metrics.filter(show).length,
          totalMetrics:metrics.length,
          details:box('.v805-timing-advanced'),
          readOnlyButton:show(document.getElementById('v803RetryOpenSource')),
          trackingButton:show(document.getElementById('v626RefreshOpenPod')),
          managementLinks,
          fakeTabs:document.querySelectorAll('.v804-workspace-nav').length,
          appOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2
        };
      });
      assert.equal(reference.fakeTabs,0,'V804 tabbed workbench must not be mounted');
      assert.equal(reference.appOverflow,false);
      assert.ok(reference.operationCards.length===4);
      assert.ok(reference.operationCards.every(x=>Math.abs(x.y-reference.operationCards[0].y)<4),
        'four reference work panels must be on SAME horizontal row');
      assert.ok(reference.validation?.y>=reference.operations.bottom-4,
        'classification and recognition follow 4 operational panels');
      assert.equal(reference.validationCards.length,2);
      assert.ok(reference.validationCards.every(x=>
        Math.abs(x.y-reference.validationCards[0].y)<4),'two quality panels side by side');
      assert.ok(reference.bottom?.y>=reference.validation.bottom-4);
      assert.ok(Math.abs(reference.signing.y-reference.pod.y)<4,
        'signing and unfinished POD must be SIDE-BY-SIDE');
      assert.ok(reference.signing.right<reference.pod.x+6,
        'POD should be to the RIGHT of signing, not stacked below');
      assert.ok(reference.signing.width>reference.pod.width*1.8,
        'signing section should be wider than POD section');
      assert.equal(reference.visibleCards,4,'four actual saved-source signing business cards visible');
      assert.equal(reference.visibleMetrics,4,'four priority signing indicators visible');
      assert.equal(reference.totalMetrics,8,'all original eight verified metrics retained');
      assert.equal(reference.readOnlyButton,true,'POD source verification available');
      assert.equal(reference.trackingButton,true,'separate guarded trajectory update available');
      assert.ok(reference.management.y>=reference.bottom.bottom-4,
        'data management follows signing and POD in original reference');
      assert.ok(reference.trend.y>=reference.management.bottom-4,
        'saved-source trend stays optional at bottom');
      assert.equal(reference.managementLinks.length,3);
      for(const tab of ['clear','backup','storage'])
        assert.ok(reference.managementLinks.some(x=>x.includes('tab='+tab)),
          'safe data-management deep link '+tab);
      await page.locator('.v805-timing-advanced summary').click();
      const expanded=await page.locator('.v805-timing-advanced').evaluate(e=>e.open);
      assert.equal(expanded,true,'remaining four KPIs are expandable without changing source');
      assert.equal(await page.locator('.v801-timing-summary-tile:visible').count(),8,
        'all 8 verified timing KPI tiles must be accessible when expanded');
      await page.locator('.v805-timing-advanced summary').click();
      await page.screenshot({path:path.join(out,item.file),fullPage:true});
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
