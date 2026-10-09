import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const loader=fs.readFileSync(new URL('../src/lightweightDashboardStore.js',import.meta.url),'utf8').replace(/\r\n?/g,'\n');
const exporter=fs.readFileSync(new URL('../src/shopeeTemplateExporter.js',import.meta.url),'utf8').replace(/\r\n?/g,'\n');
const between=(src,a,b)=>{
  const start=src.indexOf(a),end=src.indexOf(b,start+a.length);
  assert.ok(start>=0&&end>start,'production section missing: '+a);
  return src.slice(start,end);
};
assert.match(loader,/const EXPORT_BUSINESS_TYPES = Object\.freeze\(\[\.\.\.BUSINESS_TYPES,'WHPP'\]\)/);
const db=new DatabaseSync(':memory:');
try{
  db.exec(`
    CREATE TABLE qc_tracking_ledger(shipmentCode TEXT,businessType TEXT,trackingStatus TEXT,
      terminalReason TEXT,podDate TEXT,lastEventTime TEXT);
    CREATE TABLE shipment_current_state(shipmentCode TEXT,businessType TEXT,state TEXT,
      stateJson TEXT,lastEventTime TEXT);
  `);
  const day='2026-07-02', snap='SNAP-v786';
  const bills=Array.from({length:156},(_,i)=>'CE020726'+String(i+1).padStart(5,'0'));
  const raw=bills.map(shipmentCode=>({
    shipmentCode,regionCode:'PP',reportDate:day,
    isPod:0,truthEvidence:{scan:true,final:true,pod:false,returned:false},currentState:'PENDING'
  }));
  const finalized=()=>{
    const rows=raw.map(r=>({...r,truthEvidence:{...r.truthEvidence}}));
    const proof=(code)=>{
      const state=db.prepare('SELECT * FROM qc_tracking_ledger WHERE shipmentCode=?').get(code);
      if(state?.terminalReason==='POD')return {pod:true,returned:false};
      if(state?.terminalReason==='RETURNED')return {pod:false,returned:true};
      return {pod:false,returned:false};
    };
    for(const row of rows){const p=proof(row.shipmentCode);row.truthEvidence.pod=p.pod;row.truthEvidence.returned=p.returned}
    return {total:156,rows,evidence:{scanRows:156,finalRows:156}};
  };
  const billOf=row=>String(row.shipmentCode||row.运单号||'').toUpperCase();
  const overlayBody=between(loader,'function overlaySavedTerminalExportTruth(', 'function listLatestValidRangeBatches(');
  const overlay=(new Function('getDb','billOf',overlayBody+'\nreturn overlaySavedTerminalExportTruth;'))(()=>db,billOf);
  const sourceBody=between(loader,'function loadLightweightExportRows(', '// Read-only export overlay.');
  const source=(new Function('getDb','loadWhppCanonicalTruth','billOf','overlaySavedTerminalExportTruth','loadLightweightUnifiedBusinessState',
    sourceBody+'\nreturn loadLightweightExportRows;'))(()=>db,()=>finalized(),billOf,overlay,()=>({finalRows:[]}));
  const rows=source(snap,day,'WHPP');
  assert.equal(rows.length,156,'all 156 independent WHPP members must be formally exported');
  assert.equal(rows[0].reportDate,day);
  assert.equal(rows[0].businessType,'WHPP');

  db.prepare('INSERT INTO qc_tracking_ledger VALUES(?,?,?,?,?,?)').run(bills[0],'WHPP','TERMINAL','POD','2026-07-05','2026-07-05');
  db.prepare('INSERT INTO qc_tracking_ledger VALUES(?,?,?,?,?,?)').run(bills[1],'WHPP','TERMINAL','RETURNED','','2026-07-05');
  db.prepare('INSERT INTO shipment_current_state VALUES(?,?,?,?,?)').run(
    bills[2],'WHPP','OPEN',JSON.stringify({shipmentStatus:'80',eventCode:'60'}),'2026-07-05');
  const updated=source(snap,day,'WHPP');
  assert.equal(updated.length,156,'terminal refreshes must not mutate historical membership');
  assert.equal(updated[0].是否POD,'是','POD evidence must hydrate completed old daily');
  assert.equal(updated[0].reportDate,day,'later terminal must not move original daily into later date');
  assert.equal(updated[1].退回状态,'已退回','returned evidence must hydrate completed old daily');
  assert.equal(updated[2].currentState,'RETURNING','shipmentStatus80 must remain a visible nonterminal return-in-progress, never POD or returned');
  assert.equal(updated[2].是否POD,'否');
  const cats=between(exporter,'function isPod(row = {})', 'function isDelivery(row = {})');
  const predicates=new Function(cats+'\nreturn {isPod,isReturned,isCancelled};')();
  assert.equal(predicates.isPod(updated[0]),true);
  assert.equal(predicates.isReturned(updated[1]),true);
  assert.equal(predicates.isPod(updated[2]),false);
  assert.equal(predicates.isReturned(updated[2]),false);
  assert.equal(predicates.isPod({shipmentStatus:'60'}),true);
  assert.equal(predicates.isReturned({shipmentStatus:'81'}),true);
  assert.equal(predicates.isReturned({shipmentStatus:'80',退回状态:'已退回'}),false);

  const emptyBuckets=rows=>({all:rows,pp:[],pv:[],store:[],pod:[],notPod:[],delivery:[],pending:[],returned:[],
    pvDelivery:[],pvStoreRetention:[],pvStoreInboundNoScan:[],pvOtherUnresolved:[]});
  const partBody=between(exporter,'function partitionRows(rows = [])', 'function metricsFromBuckets(');
  const partition=new Function('emptyBuckets','region','isPod','isReturned','isCancelled','isDelivery','pendingDays','pvDisposition',
    partBody+'\nreturn partitionRows;')(emptyBuckets,()=> 'PP',predicates.isPod,predicates.isReturned,
      predicates.isCancelled,()=>false,()=>0,()=> '');
  const buckets=partition(updated);
  assert.equal(buckets.all.length,156);
  assert.equal(buckets.pod.length,1);
  assert.equal(buckets.returned.length,1);
  assert.equal(buckets.notPod.length,154);
  assert.equal(buckets.notPod.some(r=>r.shipmentCode===bills[0]),false);
  assert.equal(buckets.notPod.some(r=>r.shipmentCode===bills[1]),false);
  assert.equal(buckets.notPod.some(r=>r.shipmentCode===bills[2]),true,'return-in-progress remains unfinished');
  assert.equal(partition([{shipmentCode:'cancel',currentState:'ORDER_CANCELLED'}]).notPod.length,0,
    'cancelled shipments are not live unfinished POD');

  // Missing processing proof must fail BEFORE emitting a falsely complete
  // workbook. A source 156 is not itself a completed WHPP run.
  const incompleteSource=new Function('getDb','loadWhppCanonicalTruth','billOf',
    'overlaySavedTerminalExportTruth','loadLightweightUnifiedBusinessState',
    sourceBody+'\nreturn loadLightweightExportRows;')(()=>db,()=>({total:156,rows:raw,evidence:{scanRows:156,finalRows:0}}),
      billOf,overlay,()=>({finalRows:[]}));
  assert.throws(()=>incompleteSource(snap,day,'WHPP'),/仍缺扫描或最终记录/);

  const listBody=between(loader,'export function listLightweightCompletedUnifiedSnapshots(', 'function loadLightweightExportRows(')
    .replace('export function','function');
  const getList=new Function('EXPORT_BUSINESS_TYPES','validateDateRange','listLatestValidRangeBatches',
    'loadLightweightExportRows',listBody+'\nreturn listLightweightCompletedUnifiedSnapshots;')(
    ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'],
    ()=>({from:day,to:day}),
    ()=>[{reportDate:day,snapshotId:snap,createdAt:''}],
    (snapshot,date,type)=>type==='WHPP'?source(snapshot,date,type):[]);
  const accepted=getList(day,day,['WHPP']);
  assert.equal(accepted[0].payload.finalRows.length,156,
    'WHPP-only formal report must accept WHPP as a business and include all 156');
  assert.equal(getList(day,day).at(0).payload.finalRows.length,156,
    'ALL report must not silently omit independent WHPP');
  console.log('[V786 EXPORT WHPP] 156 canonical independent members in ALL/WHPP reports, post-refresh 60 POD and 81 returned leave unfinished, 80 stays open, cancellation excluded, incomplete processing blocks XLSX PASS');
}finally{db.close()}
