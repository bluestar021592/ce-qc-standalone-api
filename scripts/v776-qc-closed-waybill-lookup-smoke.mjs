import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const js=fs.readFileSync(path.join(root,'public/v625-shell.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/v625-shell.html'),'utf8');
const detail=fs.readFileSync(path.join(root,'public/qc-action-detail.html'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
assert.match(html,/id="v776OpenAnyWaybill"[^>]*>运单直查（含已闭环）/);
assert.match(html,/id="v776DirectHelp"/);
assert.match(js,/v776OpenAnyWaybill'\)\?\.addEventListener\('click',qcOpenAnyWaybill\)/);
assert.match(js,/qcActionRows\.filter\(/,'the actionable queue stays distinct');
assert.match(js,/location\.assign\('\/qc-action-detail\?'\+url\.toString\(\)\)/);
assert.match(detail,/fetch\('\/api\/qc-action-detail\?'/);
assert.match(server,/app\.get\('\/api\/qc-action-detail'/);
const start=js.indexOf('function qcOpenAnyWaybill(){');
const end=js.indexOf('function qcActionUpdateSelection(){',start);
assert.ok(start>0&&end>start,'isolated history lookup must exist');
const fn=js.slice(start,end).trim();
const inputs={v768ExceptionKeyword:'CE04072600014',v625ExceptionBusiness:'WHPP',v625ExceptionDate:'2026-07-04'};
function testCase(changes={},scope=null) {
  const controls={...inputs,...changes},messages=[],opens=[];
  const sandbox={
    byId:id=>({value:controls[id]??''}),
    setText:(id,msg)=>messages.push({id,msg}),
    qcActionScope:scope,
    location:{assign:url=>opens.push(url)},
    URLSearchParams
  };
  vm.runInNewContext(fn+'\nqcOpenAnyWaybill();',sandbox,{timeout:2000});
  return {messages,opens};
}
const originalSnapshot='SNAP-cbfa4938-3fc1-48f7-a96b-9b29b77d7146';
const first=testCase({}, {reportDate:'2026-07-04',snapshotId:originalSnapshot});
assert.equal(first.opens.length,1,'closed 2026-07-04 WHPP waybill should open its own detail');
const params=new URL(first.opens[0],'http://127.0.0.1:5177').searchParams;
assert.equal(params.get('shipmentCode'),'CE04072600014');
assert.equal(params.get('businessType'),'WHPP');
assert.equal(params.get('reportDate'),'2026-07-04');
assert.equal(params.get('snapshotId'),originalSnapshot);
const noScope=testCase();
assert.equal(new URL(noScope.opens[0],'http://127.0.0.1:5177').searchParams.has('snapshotId'),false);
const wrongScope=testCase({}, {reportDate:'2026-07-05',snapshotId:'ANOTHER_DAY'});
assert.equal(new URL(wrongScope.opens[0],'http://127.0.0.1:5177').searchParams.has('snapshotId'),false,
  'wrong-date snapshot must never attach to historical detail');
for(const [change,expected] of [
  [{v768ExceptionKeyword:'店铺查询'},'完整运单号'],
  [{v625ExceptionBusiness:''},'单个业务'],
  [{v625ExceptionDate:''},'日报日期']
]) {
  const current=testCase(change);
  assert.equal(current.opens.length,0,'invalid exact lookup never navigates');
  assert.match(current.messages.map(x=>x.msg).join(' '),new RegExp(expected));
}
assert.match(js,/td\.textContent='当前条件暂无待核验运单。已闭环运单不会出现在此清单/);
console.log('[V776 QC HISTORY] Closed/cancelled/POD/returned shipments remain accessible by exact business+date+waybill, without changing actionable counts, remote scanning or business records PASS');
