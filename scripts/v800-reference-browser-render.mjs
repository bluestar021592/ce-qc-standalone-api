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
      assert.equal(data.topChildren,4,'overview must preserve progress/status/quick/log');
      assert.ok(data.topRow?.width>600,'overview operational row must exist');
      assert.equal(data.totalCard,1,'grand total retained');
      assert.equal(data.homeCards,7,'all 7 business cards available');
      const intro=await page.evaluate(()=>{
        const all=[...document.querySelectorAll('[data-v804-tab]')];
        const panes=[...document.querySelectorAll('[data-v804-pane]')];
        return {tabs:all.length,panes:panes.length,
          active:all.filter(x=>x.getAttribute('aria-selected')==='true').map(x=>x.dataset.v804Tab),
          visible:panes.filter(x=>!x.hidden).map(x=>x.dataset.v804Pane)};
      });
      assert.equal(intro.tabs,4,'four real home workspaces');
      assert.equal(intro.panes,4);
      assert.deepEqual(intro.active,['overview']);
      assert.deepEqual(intro.visible,['overview']);
      await page.screenshot({path:path.join(out,item.file),fullPage:true});
      await page.locator('[data-v804-tab="signing"]').click();
      const timing=await page.evaluate(()=>{
        const panel=document.querySelector('#v801TimingDashboard');
        const cards=[...panel.querySelectorAll('.v625-timing-card')];
        const metrics=[...panel.querySelectorAll('.v801-timing-summary-tile')];
        const within=element=>{const r=element.getBoundingClientRect();return r.width>0&&r.height>0}
        const nav=document.querySelector('.v804-workspace-nav');
        return {active:document.querySelector('.v804-workspace-tab.active')?.dataset.v804Tab,
          cards:cards.filter(within).length,metrics:metrics.filter(within).length,
          panelWidth:panel.getBoundingClientRect().width,
          noInternalScroll:panel.scrollHeight<=panel.clientHeight+4
            ||getComputedStyle(panel).overflowY==='visible',
          pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2,
          scrollTarget:document.location.hash,
          navWidth:nav.getBoundingClientRect().width};
      });
      assert.equal(timing.active,'signing');
      assert.equal(timing.cards,4,'all four business signing cards visible on signing tab');
      assert.equal(timing.metrics,8,'all eight data-backed signing indicators visible');
      assert.ok(timing.panelWidth>750,'signing panel should fill workspace width');
      assert.equal(timing.noInternalScroll,true,'no hidden scroll-box for signing');
      assert.equal(timing.pageOverflow,false,'signing view must not clip horizontally');
      assert.equal(timing.scrollTarget,'#signing','tab updates actual URL view');
      await page.screenshot({path:path.join(out,'home-signing-1536x1024.png'),fullPage:true});
      await page.locator('[data-v804-tab="open-pod"]').click();
      const pod=await page.evaluate(()=>({
        active:document.querySelector('.v804-workspace-tab.active')?.dataset.v804Tab,
        podVisible:document.querySelector('.v626-open-pod-panel')?.getBoundingClientRect().height>0,
        readOnlyButton:document.getElementById('v803RetryOpenSource')?.getBoundingClientRect().height>0,
        trackingButton:document.getElementById('v626RefreshOpenPod')?.getBoundingClientRect().height>0,
        signingHidden:document.querySelector('[data-v804-pane="signing"]')?.hidden
      }));
      assert.equal(pod.active,'open-pod');
      assert.equal(pod.podVisible,true);
      assert.equal(pod.readOnlyButton,true);
      assert.equal(pod.trackingButton,true);
      assert.equal(pod.signingHidden,true,'inactive signing panel is not stacked below POD');
      await page.screenshot({path:path.join(out,'home-open-pod-1536x1024.png'),fullPage:true});
      await page.locator('[data-v804-tab="management"]').click();
      const management=await page.evaluate(()=>({
        active:document.querySelector('.v804-workspace-tab.active')?.dataset.v804Tab,
        links:[...document.querySelectorAll('[data-v804-pane="management"] .v792-management-tile a')]
          .map(x=>x.getAttribute('href'))
      }));
      assert.equal(management.active,'management');
      assert.equal(management.links.length,3,'three distinct safe operations');
      for(const tab of ['clear','backup','storage'])
        assert.ok(management.links.some(x=>x.includes('tab='+tab)),tab+' link');
      await page.locator('[data-v804-tab="overview"]').click();
      assert.equal(await page.locator('[data-v804-pane]:not([hidden])').count(),1,
        'only selected home pane is visible');
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
