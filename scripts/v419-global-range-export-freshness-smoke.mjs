import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const root=process.cwd();
const guardSource=fs.readFileSync(path.join(root,'public/v237-dashboard-owner-guard.js'),'utf8');
const exportSource=fs.readFileSync(path.join(root,'src/v84AsyncExportPatch.js'),'utf8');
const historicalExportSource=fs.readFileSync(path.join(root,'src/v320HistoricalExportRows.js'),'utf8');
const exportWorkerSource=fs.readFileSync(path.join(root,'src/v84ExportJobWorker.js'),'utf8');

// 1) One global custom range must own topbar, home range and report export range.
assert.match(guardSource,/V419-one-global-date-range-all-boards-export|v419-one-global-date-range-all-boards-export/i);
for(const id of ['topRangeFrom','topRangeTo','dashboardRangeFrom','dashboardRangeTo','periodExportFrom','periodExportTo'])assert.ok(guardSource.includes(id),`global range owner missing ${id}`);
for(const route of ['/home','/ce','/ceaf','/tbkh','/ali1688','/shopeecn','/shopeevn','/whpp','/reports'])assert.ok(guardSource.includes(`'${route}'`),`global range owner missing route ${route}`);
assert.match(guardSource,/loadCustomDashboardRange\(canonicalRange\.from,canonicalRange\.to,false\)/,'report range changes must synchronize the canonical app range without repainting the reports page');
assert.match(guardSource,/ensure\('CEAF','CEAF','CE'\)/,'export UI must expose CEAF');
assert.match(guardSource,/ensure\('WHPP','WHPP','SHOPEEVN'\)/,'export UI must expose WHPP');
assert.match(guardSource,/管理汇总 \+ 七业务/,'ALL export label must be seven-business');

class FakeInput{
  constructor(id,value=''){this.id=id;this.value=value;this.nodeType=1;this.textContent='';}
  matches(){return false;}
  closest(){return this;}
  querySelector(){return null;}
}
const elements={
  topRangeFrom:new FakeInput('topRangeFrom','2026-08-01'),topRangeTo:new FakeInput('topRangeTo','2026-08-07'),
  dashboardRangeFrom:new FakeInput('dashboardRangeFrom',''),dashboardRangeTo:new FakeInput('dashboardRangeTo',''),
  periodExportFrom:new FakeInput('periodExportFrom',''),periodExportTo:new FakeInput('periodExportTo','')
};
const listeners={};
const appSyncCalls=[];
const fakeDocument={
  readyState:'complete',documentElement:{},activeElement:null,
  getElementById:id=>elements[id]||null,
  querySelectorAll:()=>[],
  addEventListener:(type,handler)=>{(listeners[type]||=[]).push(handler);}
};
class FakeMutationObserver{constructor(cb){this.cb=cb;}observe(){}disconnect(){}}
class FakeResponse{constructor(body,init={}){this.body=body;this.status=init.status||200;this.headers=init.headers||{};}}
const fakeWindow={
  document:fakeDocument,location:{pathname:'/home'},fetch:async()=>({}),MutationObserver:FakeMutationObserver,Response:FakeResponse,
  setTimeout,clearTimeout,queueMicrotask,console,
  addEventListener:()=>{},
  loadCustomDashboardRange:(from,to,shouldRender)=>{appSyncCalls.push({from,to,shouldRender});return Promise.resolve({ok:true});}
};
fakeWindow.window=fakeWindow;
const context=vm.createContext({...fakeWindow,window:fakeWindow,globalThis:fakeWindow,document:fakeDocument,location:fakeWindow.location,MutationObserver:FakeMutationObserver,Response:FakeResponse,fetch:fakeWindow.fetch,setTimeout,clearTimeout,queueMicrotask,console});
vm.runInContext(guardSource,context,{filename:'v237-dashboard-owner-guard.js'});
const rangeOwner=fakeWindow.__CE_QC_GLOBAL_PERIOD_RANGE__;
assert.ok(rangeOwner,'global period range owner must be installed');
assert.deepEqual({from:rangeOwner.get().from,to:rangeOwner.get().to},{from:'2026-08-01',to:'2026-08-07'});
for(const id of ['dashboardRangeFrom','periodExportFrom'])assert.equal(elements[id].value,'2026-08-01',`${id} must mirror top range from`);
for(const id of ['dashboardRangeTo','periodExportTo'])assert.equal(elements[id].value,'2026-08-07',`${id} must mirror top range to`);

elements.periodExportFrom.value='2026-08-03';
elements.periodExportTo.value='2026-08-06';
for(const handler of listeners.change||[])handler({target:elements.periodExportTo});
await new Promise(resolve=>setTimeout(resolve,100));
assert.deepEqual({from:rangeOwner.get().from,to:rangeOwner.get().to},{from:'2026-08-03',to:'2026-08-06'});
for(const id of ['topRangeFrom','dashboardRangeFrom','periodExportFrom'])assert.equal(elements[id].value,'2026-08-03',`${id} must share export-edited from date`);
for(const id of ['topRangeTo','dashboardRangeTo','periodExportTo'])assert.equal(elements[id].value,'2026-08-06',`${id} must share export-edited to date`);
assert.ok(appSyncCalls.some(call=>call.from==='2026-08-03'&&call.to==='2026-08-06'&&call.shouldRender===false),'reports-page range edit must synchronize the app dashboardPeriodRange owner');

// 2) Same export conditions may be reused only while persisted SQLite truth is unchanged.
assert.match(exportSource,/TRUTH_REUSE_ID\s*=\s*'2026-09-03-v419-export-reuse-persisted-truth-watermark-v1'/);
assert.match(exportSource,/\[dbFile, `\$\{dbFile\}-wal`\]/,'truth watermark must include SQLite WAL writes, not only checkpointed DB mtime');
assert.match(exportSource,/truthWatermarkMs\s*\}\)\)\.digest\('hex'\)/,'persisted truth watermark must participate in the export payload key');
assert.match(exportSource,/const truthWatermarkMs = persistedTruthWatermarkMs\(\);[\s\S]*payloadKey\(payload, truthWatermarkMs\)/,'each prepare request must freeze one truth watermark into its reuse key');
assert.match(exportSource,/String\(job\.truthReuseId \|\| ''\) !== TRUTH_REUSE_ID/,'legacy completed jobs without truth revision must never be reused');
for(const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'])assert.ok(exportWorkerSource.includes(`'${type}'`),`ALL export worker missing ${type}`);

// 3) Historical membership remains on the source day, but current persisted truth must overlay later carryover closure.
assert.match(historicalExportSource,/function enrichCurrentTruth/,'historical export must have a current-state overlay');
assert.match(historicalExportSource,/FROM shipment_current_state WHERE UPPER\(TRIM\(shipmentCode\)\) IN/,'current-state overlay must be keyed by shipment identity, not current snapshot id');
assert.match(historicalExportSource,/enrichFinals\(db,businessType,map\);enrichCurrentTruth\(db,businessType,map\)/,'latest current truth must overlay persisted finals before export rows are returned');
assert.match(historicalExportSource,/CURRENT_STATE_OVERLAY/,'export diagnostics must expose current-state overlay ownership');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v419-export-'));
process.env.DATA_DIR=temp;
process.env.DB_FILE=path.join(temp,'ce_qc_monitor.db');
process.env.EXPORTS_DIR=path.join(temp,'exports');
const {getDb,closeDb}=await import('../src/db.js');
const {collectV320HistoricalExportRows}=await import('../src/v320HistoricalExportRows.js');
const db=getDb();
const now='2026-08-01T01:00:00.000Z';
function insert(table,values){
  const columns=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name));
  const entries=Object.entries(values).filter(([key])=>columns.has(key));
  const names=entries.map(([key])=>key);const marks=names.map(()=>'?').join(',');
  db.prepare(`INSERT INTO ${table}(${names.join(',')}) VALUES(${marks})`).run(...entries.map(([,value])=>value));
}
insert('unified_import_batches',{batchId:'B1',snapshotId:'S1',reportDate:'2026-08-01',sourceName:'8-1.xls',fileHash:'fixture',status:'VALID',summaryJson:'{}',warningsJson:'[]',createdAt:now});
insert('unified_snapshots',{snapshotId:'S1',batchId:'B1',reportDate:'2026-08-01',status:'COMPLETED',payloadJson:'{}',createdAt:now});
insert('unified_import_rows',{batchId:'B1',snapshotId:'S1',reportDate:'2026-08-01',businessType:'CE',shipmentCode:'CE-V419-1',regionCode:'PP',recipientRaw:'TEST',recipientNormalized:'TEST',sheetName:'日报',rowNumber:2,classificationReason:'fixture',rowJson:JSON.stringify({运单号:'CE-V419-1',区域分类:'PP'}),createdAt:now});
insert('shipment_current_state',{shipmentCode:'CE-V419-1',businessType:'CE',reportDate:'2026-08-02',snapshotId:'S2',state:'POD',apiStatus:'SUCCESS',lastEventTime:'2026-08-02T10:00:00+07:00',stateJson:JSON.stringify({运单号:'CE-V419-1',currentState:'POD',是否POD:'是',POD时间:'2026-08-02T10:00:00+07:00'}),updatedAt:'2026-08-02T10:01:00+07:00'});
const rows=await collectV320HistoricalExportRows('CE',{from:'2026-08-01',to:'2026-08-01'});
assert.equal(rows.length,1,'8/1 membership must remain exactly one row');
assert.deepEqual(rows[0].dailyMembershipDates,['2026-08-01'],'next-day refresh must not move the shipment into 8/2 membership');
assert.equal(rows[0].pod,true,'8/2 carryover/current-state POD must appear when exporting the original 8/1 membership');
assert.equal(rows[0].podDate,'2026-08-02','latest POD date must come from the next-day persisted terminal truth');
assert.ok(rows[0].evidence instanceof Set&&rows[0].evidence.has('当前持久化终态'),'export row must disclose current persisted truth overlay evidence');
closeDb();
fs.rmSync(temp,{recursive:true,force:true});

console.log('[V419 RANGE+EXPORT] PASS one global 08-03~08-06 range across HOME/business/export controls · seven-business export scope · DB/WAL truth-aware export reuse · 08-01 member refreshed to 08-02 POD without changing source-day membership');
