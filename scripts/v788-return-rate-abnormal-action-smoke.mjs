import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const js=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
assert.match(html,/<article id="kpiReturnRateCard"[^>]*class="kpi red v628-kpi-click"[^>]*data-kpi-detail="returned"[^>]*role="button"[^>]*tabindex="0"/,
  'WHPP/CN/VN return rate must click to the matching returned-waybill member list');
assert.match(js,/qa\('\[data-kpi-detail\]'\)\.forEach\(card=>/,
  'rate card must share existing click/keyboard drilldown wiring');
assert.match(js,/v788BusinessAbnormalRow\(row,reportDate,targetBusiness\)/,
  'business anomaly rows must be traceable rather than ending in plain text');
assert.match(html,/v625-shell\.js\?v=20261019-v788-action-1&patch=788/,
  'changed interaction JS must not remain in old browser cache');

const start=js.indexOf('function rowTr(values){');
const end=js.indexOf('\nlet runBusy=false;',start);
assert.ok(start>=0&&end>start,'test actual shipped row/link builder');
function element(tag){
  return {
    tagName:tag,children:[],textContent:'',href:'',
    appendChild(node){this.children.push(node);this.lastElementChild=node;return node}
  };
}
const c={
  document:{createElement:element},
  detailCode:row=>String(row.shipmentCode||row.waybill||'').trim().toUpperCase(),
  encodeURIComponent
};
vm.createContext(c);
vm.runInContext(js.slice(start,end),c,{timeout:2000});
const run=(row,date='2026-07-02',business='SHOPEECN')=>{
  c.row=row;c.day=date;c.kind=business;
  return vm.runInContext('v788BusinessAbnormalRow(row,day,kind)',c,{timeout:2000});
};
const r=run({shipmentCode:'SPE260702012345',businessType:'SHOPEECN',currentState:'PENDING',category:'Pending'});
assert.equal(r.children.length,7);
assert.equal(r.children[0].textContent,'SPE260702012345');
assert.equal(r.children[6].children.length,1);
assert.equal(r.children[6].children[0].href,'/tracking?auth=v625&code=SPE260702012345&reportDate=2026-07-02&businessType=SHOPEECN');
assert.equal(run({waybill:'CE01072600001'},'2026-07-01','WHPP').children[6].children.length,1,
  'WHPP alternate waybill source must remain clickable');
for(const row of [{},{shipmentCode:''}]){
  const tr=run(row);
  assert.equal(tr.children[6].children.length,0,'empty waybill cannot generate tracking link');
  assert.match(tr.children[6].textContent,/待核验/);
}
const badDate=run({shipmentCode:'SPE260702012345'},'','SHOPEECN');
assert.equal(badDate.children[6].children.length,0,'missing date cannot silently query today instead');
assert.equal(run({shipmentCode:'SPE260702012345'},'2026-07-02','UNKNOWN').children[6].children.length,0,
  'unknown business cannot send waybill to wrong board');
assert.equal(run({shipmentCode:'SPE260702012345'},'2026-07-02','SHOPEEVN').children[6].children[0].href.includes('businessType=SHOPEEVN'),true);
console.log('[V788 RETURN RATE & ANOMALY] PASS clickable rate, per-waybill selected date/type URL, missing-evidence guard');
