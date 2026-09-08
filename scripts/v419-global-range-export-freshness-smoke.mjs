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
const currentRouteSource=fs.readFileSync(path.join(root,'src/v236DashboardCurrentRoutePatch.js'),'utf8');
const whppBoardSource=fs.readFileSync(path.join(root,'public/v132-whpp-seven-business-fast.js'),'utf8');
const whppExactUiSource=fs.readFileSync(path.join(root,'public/v249-whpp-detail-owner.js'),'utf8');
const whppDetailSource=fs.readFileSync(path.join(root,'src/v172WhppDetailParityPatch.js'),'utf8');
const injectionSource=fs.readFileSync(path.join(root,'src/v231MetricTruthUiInjectionPatch.js'),'utf8');

// 1) One global custom range owns topbar, every board and report export controls.
assert.match(guardSource,/V419-one-global-date-range-all-boards-export|v419-one-global-date-range-all-boards-export/i);
for(const id of ['topRangeFrom','topRangeTo','dashboardRangeFrom','dashboardRangeTo','periodExportFrom','periodExportTo'])assert.ok(guardSource.includes(id),`global range owner missing ${id}`);
for(const route of ['/home','/ce','/ceaf','/tbkh','/ali1688','/shopeecn','/shopeevn','/whpp','/reports'])assert.ok(guardSource.includes(`'${route}'`),`global range owner missing route ${route}`);
assert.match(guardSource,/loadCustomDashboardRange\(canonicalRange\.from,canonicalRange\.to,false\)/,'report range changes must synchronize canonical app range');
assert.match(guardSource,/ensure\('CEAF','CEAF','CE'\)/,'export UI must expose CEAF');
assert.match(guardSource,/ensure\('WHPP','WHPP','SHOPEEVN'\)/,'export UI must expose WHPP');
assert.match(guardSource,/管理汇总 \+ 七业务/,'ALL export label must be seven-business');
assert.match(injectionSource,/['"]v237-home-dashboard-owner\.js['"]/,'legacy V237 home DOM writer must be stripped from delivered HTML');
assert.match(injectionSource,/V253_FAST_MARKER/,'V253 selected-range owner must be delivered');

class FakeInput{constructor(id,value=''){this.id=id;this.value=value;this.nodeType=1;this.textContent='';}matches(){return false;}closest(){return this;}querySelector(){return null;}}
const elements={topRangeFrom:new FakeInput('topRangeFrom','2026-08-01'),topRangeTo:new FakeInput('topRangeTo','2026-08-07'),dashboardRangeFrom:new FakeInput('dashboardRangeFrom',''),dashboardRangeTo:new FakeInput('dashboardRangeTo',''),periodExportFrom:new FakeInput('periodExportFrom',''),periodExportTo:new FakeInput('periodExportTo','')};
const listeners={},appSyncCalls=[];
const fakeDocument={readyState:'complete',documentElement:{},activeElement:null,getElementById:id=>elements[id]||null,querySelectorAll:()=>[],addEventListener:(type,handler)=>{(listeners[type]||=[]).push(handler);}};
class FakeMutationObserver{constructor(cb){this.cb=cb;}observe(){}disconnect(){}}
class FakeResponse{constructor(body,init={}){this.body=body;this.status=init.status||200;this.headers=init.headers||{};}}
const fakeWindow={document:fakeDocument,location:{pathname:'/home'},fetch:async()=>({}),MutationObserver:FakeMutationObserver,Response:FakeResponse,setTimeout,clearTimeout,queueMicrotask,console,addEventListener:()=>{},loadCustomDashboardRange:(from,to,shouldRender)=>{appSyncCalls.push({from,to,shouldRender});return Promise.resolve({ok:true});}};
fakeWindow.window=fakeWindow;
const context=vm.createContext({...fakeWindow,window:fakeWindow,globalThis:fakeWindow,document:fakeDocument,location:fakeWindow.location,MutationObserver:FakeMutationObserver,Response:FakeResponse,fetch:fakeWindow.fetch,setTimeout,clearTimeout,queueMicrotask,console});
vm.runInContext(guardSource,context,{filename:'v237-dashboard-owner-guard.js'});
const rangeOwner=fakeWindow.__CE_QC_GLOBAL_PERIOD_RANGE__;
assert.ok(rangeOwner,'global period range owner must be installed');
assert.deepEqual({from:rangeOwner.get().from,to:rangeOwner.get().to},{from:'2026-08-01',to:'2026-08-07'});
for(const id of ['dashboardRangeFrom','periodExportFrom'])assert.equal(elements[id].value,'2026-08-01',`${id} must mirror top range from`);
for(const id of ['dashboardRangeTo','periodExportTo'])assert.equal(elements[id].value,'2026-08-07',`${id} must mirror top range to`);
elements.periodExportFrom.value='2026-08-03';elements.periodExportTo.value='2026-08-06';for(const handler of listeners.change||[])handler({target:elements.periodExportTo});await new Promise(resolve=>setTimeout(resolve,100));
assert.deepEqual({from:rangeOwner.get().from,to:rangeOwner.get().to},{from:'2026-08-03',to:'2026-08-06'});
for(const id of ['topRangeFrom','dashboardRangeFrom','periodExportFrom'])assert.equal(elements[id].value,'2026-08-03',`${id} must share export-edited from date`);
for(const id of ['topRangeTo','dashboardRangeTo','periodExportTo'])assert.equal(elements[id].value,'2026-08-06',`${id} must share export-edited to date`);
assert.ok(appSyncCalls.some(call=>call.from==='2026-08-03'&&call.to==='2026-08-06'&&call.shouldRender===false),'reports range edit must synchronize dashboardPeriodRange');

// 2) Multi-day current cards and WHPP UI must consume exactly the same canonical range.
assert.match(currentRouteSource,/loadRangeDashboard\(from,to\)/,'multi-day current cards must use canonical period dashboard');
assert.match(currentRouteSource,/V419_CANONICAL_PERIOD_DASHBOARD_RANGE/,'range current cards must expose canonical range source');
assert.match(currentRouteSource,/const singleDayRequest=!from\|\|from===to/,'from=to must retain single-day WHPP safety');
assert.match(currentRouteSource,/singleDayRequest&&data\.whpp\?\.membershipIncomplete/,'single-day WHPP membership damage must remain fail-closed');
for(const source of [whppBoardSource,whppExactUiSource])assert.doesNotThrow(()=>new Function(source),'WHPP browser range owner must compile');
assert.match(whppBoardSource,/__CE_QC_GLOBAL_PERIOD_RANGE__/,'WHPP board must read the shared range owner first');
assert.match(whppBoardSource,/\/api\/v234\/current-summary\?from=/,'WHPP multi-day cards/regions must use range current summary');
assert.match(whppBoardSource,/\/api\/v234\/trends\?businessType=WHPP&from=/,'WHPP trends must use same from/to');
assert.match(whppBoardSource,/new URLSearchParams\(\{from:range\.from,to:range\.to/,'WHPP V132 direct detail path must send same from/to');
assert.match(whppExactUiSource,/new URLSearchParams\(\{from:range\.from,to:range\.to/,'V249 exact click owner must send same from/to');
assert.match(whppExactUiSource,/`\$\{membership\}\|\$\{code\}`/,'WHPP closed detail must preserve daily membership occurrence rather than cross-day bill dedupe');
assert.match(whppDetailSource,/2026-09-03-v419-whpp-completion-certified-detail-v7/,'WHPP detail must use completion-certified immutable daily membership owner');
assert.match(whppDetailSource,/function certifiedCompletedSnapshotState\(reportDate\)/,'WHPP rotated history must use certified completion authority');
assert.match(whppDetailSource,/BUSINESS_EXPORT_SNAPSHOT_VALID_COMPLETED/,'WHPP standalone rotated snapshot must be explicit VALID+COMPLETED');
assert.match(whppDetailSource,/function restrictStateToImmutableMembership/,'WHPP detail must restrict final rows to admitted daily members');
assert.match(whppDetailSource,/function memberDates\(from,to\)/,'WHPP detail backend must enumerate daily memberships inside selected range');
assert.match(whppDetailSource,/SHIPMENT_CURRENT_STATE/,'WHPP historical daily memberships must overlay latest persisted current truth');
assert.match(whppDetailSource,/reportMembershipDate:reportDate/,'WHPP detail must disclose immutable daily membership date');

// 3) Same export conditions may be reused only while persisted SQLite truth is unchanged.
assert.match(exportSource,/TRUTH_REUSE_ID\s*=\s*'2026-09-03-v419-export-reuse-persisted-truth-watermark-v1'/);
assert.match(exportSource,/\[dbFile, `\$\{dbFile\}-wal`\]/,'truth watermark must include SQLite WAL writes');
assert.match(exportSource,/truthWatermarkMs\s*\}\)\)\.digest\('hex'\)/,'persisted truth watermark must participate in export key');
assert.match(exportSource,/const truthWatermarkMs = persistedTruthWatermarkMs\(\);[\s\S]*payloadKey\(payload, truthWatermarkMs\)/,'prepare request must freeze one truth watermark');
assert.match(exportSource,/String\(job\.truthReuseId \|\| ''\) !== TRUTH_REUSE_ID/,'legacy completed jobs without truth revision must never be reused');
for(const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'])assert.ok(exportWorkerSource.includes(`'${type}'`),`ALL export worker missing ${type}`);

// 4) Historical membership remains on source day while current persisted truth overlays later carryover closure.
assert.match(historicalExportSource,/function enrichCurrentTruth/,'historical export must have current-state overlay');
assert.match(historicalExportSource,/FROM shipment_current_state WHERE shipmentCode IN/,'V474 current-state overlay must use bare indexed shipment identity');
assert.doesNotMatch(historicalExportSource,/FROM shipment_current_state WHERE UPPER\(TRIM\(shipmentCode\)\) IN/,'current-state overlay must never disable the shipmentCode primary-key index');
assert.match(historicalExportSource,/enrichFinals\(db,businessType,map,onProgress\);\s*enrichCurrentTruth\(db,businessType,map,onProgress\)/,'latest current truth must overlay finals before export while preserving V474 child progress');
assert.match(historicalExportSource,/phase:'hydrateFinalRows'/,'V474 final-row hydration progress must remain observable');
assert.match(historicalExportSource,/phase:'hydrateCurrentTruth'/,'V474 current-state hydration progress must remain observable');
assert.match(historicalExportSource,/CURRENT_STATE_OVERLAY/,'export diagnostics must disclose current-state ownership');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v419-export-'));
process.env.DATA_DIR=temp;process.env.DB_FILE=path.join(temp,'ce_qc_monitor.db');process.env.EXPORTS_DIR=path.join(temp,'exports');
const {getDb,closeDb}=await import('../src/db.js');
const {collectV320HistoricalExportRows}=await import('../src/v320HistoricalExportRows.js');
const {inspectV172WhppDetail}=await import('../src/v172WhppDetailParityPatch.js');
const db=getDb(),now='2026-08-01T01:00:00.000Z';
function insert(table,values){const columns=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name));const entries=Object.entries(values).filter(([key])=>columns.has(key));const names=entries.map(([key])=>key),marks=names.map(()=>'?').join(',');db.prepare(`INSERT INTO ${table}(${names.join(',')}) VALUES(${marks})`).run(...entries.map(([,value])=>value));}
insert('unified_import_batches',{batchId:'B1',snapshotId:'S1',reportDate:'2026-08-01',sourceName:'8-1.xls',fileHash:'fixture',status:'VALID',summaryJson:'{}',warningsJson:'[]',createdAt:now});
insert('unified_snapshots',{snapshotId:'S1',batchId:'B1',reportDate:'2026-08-01',status:'COMPLETED',payloadJson:'{}',createdAt:now});
insert('unified_import_rows',{batchId:'B1',snapshotId:'S1',reportDate:'2026-08-01',businessType:'CE',shipmentCode:'CE-V419-1',regionCode:'PP',recipientRaw:'TEST',recipientNormalized:'TEST',sheetName:'日报',rowNumber:2,classificationReason:'fixture',rowJson:JSON.stringify({运单号:'CE-V419-1',区域分类:'PP'}),createdAt:now});
insert('shipment_current_state',{shipmentCode:'CE-V419-1',businessType:'CE',reportDate:'2026-08-02',snapshotId:'S2',state:'POD',apiStatus:'SUCCESS',lastEventTime:'2026-08-02T10:00:00+07:00',stateJson:JSON.stringify({运单号:'CE-V419-1',currentState:'POD',是否POD:'是',POD时间:'2026-08-02T10:00:00+07:00'}),updatedAt:'2026-08-02T10:01:00+07:00'});
const rows=await collectV320HistoricalExportRows('CE',{from:'2026-08-01',to:'2026-08-01'});
assert.equal(rows.length,1,'8/1 membership must remain exactly one row');
assert.deepEqual(rows[0].dailyMembershipDates,['2026-08-01'],'next-day refresh must not move shipment into 8/2 membership');
assert.equal(rows[0].pod,true,'8/2 current-state POD must appear when exporting original 8/1 membership');
assert.equal(rows[0].podDate,'2026-08-02','latest POD date must come from next-day persisted terminal truth');
assert.ok(rows[0].evidence instanceof Set&&rows[0].evidence.has('当前持久化终态'),'export row must disclose current persisted overlay evidence');

const whppBill='WH-V419-1';
for(const reportDate of ['2026-08-01','2026-08-02']){
  const state={businessType:'WHPP',reportDate,pnhBills:[whppBill],dailyParseRows:[{shipmentCode:whppBill,运单号:whppBill,regionCode:'PP',日报日期:reportDate}],finalRows:[{shipmentCode:whppBill,运单号:whppBill,regionCode:'PP',是否POD:'否',currentState:'OPEN',primaryCategory:'Pending'}]};
  insert('business_export_snapshots',{snapshotId:`WS-${reportDate}`,businessType:'WHPP',reportDate,runId:`WR-${reportDate}`,payloadJson:JSON.stringify({state}),generatedAt:`${reportDate}T12:00:00.000Z`,createdAt:`${reportDate}T12:00:00.000Z`,status:'VALID',reconciliationStatus:'COMPLETED',invalidReason:''});
}
insert('shipment_current_state',{shipmentCode:whppBill,businessType:'WHPP',reportDate:'2026-08-02',snapshotId:'WS-2026-08-02',state:'POD',apiStatus:'SUCCESS',lastEventTime:'2026-08-02T18:00:00+07:00',stateJson:JSON.stringify({shipmentCode:whppBill,运单号:whppBill,regionCode:'PP',currentState:'POD',是否POD:'是',POD状态:'POD',POD时间:'2026-08-02T18:00:00+07:00'}),updatedAt:'2026-08-02T18:01:00+07:00'});
const whpp=inspectV172WhppDetail({from:'2026-08-01',to:'2026-08-02',tab:'pod',page:'1',pageSize:'500'});
assert.equal(whpp.total,2,'WHPP range detail must preserve one occurrence for each daily membership');
assert.deepEqual(whpp.rows.map(row=>row.reportMembershipDate),['2026-08-01','2026-08-02'],'WHPP daily membership dates must remain immutable and ordered');
assert.ok(whpp.rows.every(row=>row.是否POD==='是'||row.POD状态==='POD'||String(row.currentState||'').toUpperCase()==='POD'),'latest next-day POD truth must overlay both historical daily memberships');
assert.equal(whpp.truthSource,'IMMUTABLE_DAILY_MEMBERSHIP_PLUS_LATEST_SHIPMENT_CURRENT_STATE');
closeDb();fs.rmSync(temp,{recursive:true,force:true});

console.log('[V475/V419 RANGE+EXPORT+WHPP] PASS one global range across HOME/7 business boards/export · V474 indexed current-state overlay + child progress preserved · WHPP cards+trends+details share from/to · completion-certified immutable daily WHPP membership preserved with latest carryover POD · DB/WAL truth-aware export reuse');
