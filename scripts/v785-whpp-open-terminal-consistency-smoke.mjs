import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8').replace(/\r\n?/g,'\n');
const shell=fs.readFileSync(new URL('../public/v625-shell.js',import.meta.url),'utf8');
const from=server.indexOf('function workspaceRows('),to=server.indexOf('function persistReconciliationDiagnostics(',from);
assert.ok(from>0&&to>from,'exact production workspace converter must be present');
const convert=new Function('billOfWorkspace','workspacePendingNonContinuous','workspaceStoreArrived','workspaceOcDays',
  server.slice(from,to)+'\nreturn workspaceRows;')(
  row=>String(row.shipmentCode||'').toUpperCase(),
  ()=>false,()=>false,()=>0
);
const date='2026-07-02';
const row=(code,extras={})=>({shipmentCode:code,businessType:'WHPP',reportDate:date,primaryCategory:'退回',truthEvidence:{pod:false,returned:false},...extras});
function one(item){return convert({businessType:'WHPP',reportDate:date,finalRows:[item]})[0]}
assert.equal(one(row('CE02072600001')).isClosed,false,'historic text "退回" alone is NOT completed return');
assert.equal(one(row('CE02072600002',{shipmentStatus:'80'})).isClosed,false,'shipmentStatus 80 is return in progress');
assert.equal(one(row('CE02072600003',{shipmentStatus:'81'})).isClosed,true,'shipmentStatus 81 is returned');
assert.equal(one(row('CE02072600004',{shipmentStatus:'60'})).isClosed,true,'shipmentStatus 60 is POD');
assert.equal(one(row('CE02072600005',{truthEvidence:{returned:true,pod:false}})).isClosed,true,'verified saved return closes');
assert.equal(one(row('CE02072600006',{currentState:'ORDER_CANCELLED',carryStatus:'CLOSED'})).isClosed,true,'verified closed cancellation excluded');
assert.equal(one(row('CE02072600007',{currentState:'ORDER_CANCELLED',carryStatus:'OPEN'})).isClosed,false,'unverified cancel remains open');
assert.equal(convert({businessType:'WHPP',reportDate:date,finalRows:Array.from({length:156},(_,i)=>row('CE'+String(i).padStart(10,'0')))}).filter(x=>!x.isClosed).length,156,'156 unverified WHPP customers must not disappear from open queue');
assert.match(shell,/WHPP独立来源/,'UI must distinguish independent 156 from core 515 count');
assert.match(shell,/扫描\/最终记录处理完成/,'processing completed vs customer terminal status explicitly distinct');
assert.match(shell,/未POD\/退回终态待查/,'customer terminal gaps remain explicit when 3\/3 task completes');
assert.match(shell,/\/api\/v246\/tracking\/reconcile/,'unfinished POD manual refresh remains wired');
console.log('[V785 WHPP] 156 nonterminal members persist in OPEN; 60 POD, 80 RETURNING, 81 RETURNED; verified cancel; WHPP task/terminal states decoupled PASS');
