import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {DatabaseSync} from 'node:sqlite';
import {createShopeeTemplateWorkbook} from '../src/shopeeTemplateExporter.js';

// Actual Excel workbook generation/readback. Assert export members rather
// than relying solely on a source-array length or SQL row-count estimate.
const types=['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'];
const day1=types.map((businessType,i)=>({
  businessType,reportDate:'2026-07-01',shipmentCode:'V788EXPORT'+String(i+1).padStart(5,'0'),
  isPod:1,是否POD:'是',currentState:'POD',regionCode:i%2===0?'PP':'PV',
  signingDays:2,podDate:'2026-07-02'
}));
const day2=[
  {...day1[0],reportDate:'2026-07-02',isPod:0,是否POD:'否',currentState:'PENDING_SCAN',podDate:'',signingDays:null},
  {...day1[6],reportDate:'2026-07-02',podDate:'2026-07-03',signingDays:2}
];
const snapshots=[
  {snapshotId:'S-2026-07-01',reportDate:'2026-07-01',payload:{finalRows:day1}},
  {snapshotId:'S-2026-07-02',reportDate:'2026-07-02',payload:{finalRows:day2}}
];
// The production snapshot list must include WHPP-only reporting dates.
const sourceText=await fs.readFile(new URL('../src/lightweightDashboardStore.js',import.meta.url),'utf8');
const listStart=sourceText.indexOf('export function listLightweightCompletedUnifiedSnapshots(');
const listEnd=sourceText.indexOf('function loadLightweightExportRows(',listStart);
assert.ok(listStart>=0&&listEnd>listStart);
const sourceDb=new DatabaseSync(':memory:');
sourceDb.exec("CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT)");
sourceDb.prepare("INSERT INTO business_daily_parse_rows VALUES('WHPP',?,?)").run('2026-07-01','V788WHPPDAY01');
sourceDb.prepare("INSERT INTO business_daily_parse_rows VALUES('WHPP',?,?)").run('2026-07-02','V788WHPPDAY02');
const readSnapshots=new Function('getDb','validateDateRange','EXPORT_BUSINESS_TYPES',
  'listLatestValidRangeBatches','loadLightweightExportRows',
  sourceText.slice(listStart,listEnd).replace('export function','function')+
  '\nreturn listLightweightCompletedUnifiedSnapshots;')(
  ()=>sourceDb,(from,to)=>({from,to}),types,
  ()=>[{snapshotId:'S-2026-07-01',reportDate:'2026-07-01',createdAt:'2026-07-01T12:00:00Z'}],
  (snapshotId,reportDate,businessType)=>{
    if(businessType!=='WHPP'&&reportDate==='2026-07-02')
      throw new Error('WHPP-only day cannot invoke other business export without source');
    return [{businessType,reportDate,
      shipmentCode:businessType==='WHPP'?'V788WHPPDAY'+reportDate.slice(-2):
        'V788ONLY'+businessType,
      currentState:'POD',isPod:1,是否POD:'是',regionCode:'PP'}];
  });
const whppOnlySnapshots=readSnapshots('2026-07-01','2026-07-02',['WHPP']);
assert.deepEqual(whppOnlySnapshots.map(x=>x.reportDate),['2026-07-01','2026-07-02']);
assert.deepEqual(whppOnlySnapshots.map(x=>x.payload.finalRows.length),[1,1]);
const sixOnlySnapshots=readSnapshots('2026-07-01','2026-07-02',['CE']);
assert.deepEqual(sixOnlySnapshots.map(x=>x.reportDate),['2026-07-01'],
  'no independent WHPP-only date may leak into a CE-only report');
const mergedSnapshots=readSnapshots('2026-07-01','2026-07-02',types);
assert.equal(mergedSnapshots.length,2,'ALL export must include independent WHPP-only day');
assert.deepEqual(mergedSnapshots.map(x=>x.payload.finalRows.length),[7,1],
  'only WHPP contributes members on the WHPP-only day');
const whppDuringUnifiedProcessing=new Function(
  'getDb','validateDateRange','EXPORT_BUSINESS_TYPES',
  'listLatestValidRangeBatches','loadLightweightExportRows',
  sourceText.slice(listStart,listEnd).replace('export function','function')+
    '\nreturn listLightweightCompletedUnifiedSnapshots;')(
  ()=>sourceDb,(from,to)=>({from,to}),types,
  ()=>{throw new Error('UNIFIED_STILL_PROCESSING')},
  (snapshotId,reportDate,businessType)=>[{
    shipmentCode:'V788INDEPENDENT'+reportDate.slice(-2),
    businessType,reportDate,currentState:'POD',isPod:1
  }]);
assert.deepEqual(whppDuringUnifiedProcessing('2026-07-01','2026-07-02',['WHPP'])
  .map(item=>item.payload.finalRows.length),[1,1],
  'independent WHPP-only export must not require an unrelated unified batch to finish');
assert.throws(()=>whppDuringUnifiedProcessing('2026-07-01','2026-07-02',types),
  /UNIFIED_STILL_PROCESSING/,
  'ALL seven-business export must still fail closed when its unified source is unfinished');

sourceDb.close();
// The latest VALID upload must be selected first. A newer PROCESSING batch
// must block export; the older COMPLETED version is not a safe substitute.
const batchesStart=sourceText.indexOf('function listLatestValidRangeBatches(');
const batchesEnd=sourceText.indexOf('function validateDateRange(',batchesStart);
assert.ok(batchesStart>=0&&batchesEnd>batchesStart);
let availableBatches=[
 {reportDate:'2026-07-01',snapshotId:'NEW-RUNNING',batchId:'B2',
  createdAt:'2026-07-01T14:00:00Z',snapshotStatus:'PROCESSING'},
 {reportDate:'2026-07-01',snapshotId:'OLD-COMPLETE',batchId:'B1',
  createdAt:'2026-07-01T12:00:00Z',snapshotStatus:'COMPLETED'}
];
const latestBatch=new Function('getDb',
  sourceText.slice(batchesStart,batchesEnd)+'\nreturn listLatestValidRangeBatches;')(
  ()=>({prepare:()=>({all:()=>availableBatches})}));
assert.equal(latestBatch('2026-07-01','2026-07-01',false)[0].snapshotId,'NEW-RUNNING');
assert.deepEqual(latestBatch('2026-07-01','2026-07-01',true),[],
  'historical dashboard must skip unfinished latest day, not show old completed source');
assert.throws(()=>latestBatch('2026-07-01','2026-07-01',true,true),
  /最新有效日报尚未处理完成/,
  'export must reject new processing batch, never substitute older completed source');
availableBatches[0]={...availableBatches[0],snapshotStatus:'COMPLETED'};
assert.equal(latestBatch('2026-07-01','2026-07-01',true)[0].snapshotId,'NEW-RUNNING',
  'completed latest batch must win over older completed');
assert.equal(latestBatch('2026-07-01','2026-07-01',true,true)[0].snapshotId,'NEW-RUNNING',
  'strict export accepts a finished newest source');


const temp=await fs.mkdtemp(path.join(os.tmpdir(),'v788-excel-members-'));
const range={from:'2026-07-01',to:'2026-07-02'};
function getSheetBills(workbook,name){
  const sheet=workbook.getWorksheet(name);
  assert.ok(sheet,'missing '+name);
  const rows=[];
  for(let i=2;i<=sheet.rowCount;i++){
    const day=String(sheet.getRow(i).getCell(1).value||'');
    const value=sheet.getRow(i).getCell(2).value;
    const bill=typeof value==='object'?String(value?.text||value?.result||''):String(value||'');
    if(day&&bill)rows.push({date:day,bill});
  }
  return rows;
}
try{
  const independentResult=await createShopeeTemplateWorkbook({
    type:'ALL',periodType:'custom',range,snapshots:mergedSnapshots,outputDir:temp
  });
  assert.equal(independentResult.audit.rows,8);
  const independentBook=new ExcelJS.Workbook();
  await independentBook.xlsx.readFile(independentResult.file);
  const independentBills=getSheetBills(independentBook,'全部明细');
  assert.equal(independentBills.length,8);
  assert.equal(independentBills.filter(x=>x.date==='2026-07-02').length,1,
    'WHPP-only day should be present once, not skipped or filled with fake unified rows');
  assert.equal(independentBills.find(x=>x.date==='2026-07-02').bill,'V788WHPPDAY02');
  const out=await createShopeeTemplateWorkbook({
    type:'ALL',periodType:'custom',range,snapshots,outputDir:temp
  });
  assert.equal(out.audit.rows,9,'seven groups on first day plus two repeated-source members on second day');
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.readFile(out.file);
  const all=getSheetBills(workbook,'全部明细');
  assert.equal(all.length,9,'actual generated Excel must preserve 9 date-scoped members');
  assert.equal(all.filter(x=>x.date==='2026-07-01').length,7);
  assert.equal(all.filter(x=>x.date==='2026-07-02').length,2);
  const firstBill=day1[0].shipmentCode;
  assert.equal(all.filter(x=>x.bill===firstBill).length,2,
    'same CE shipment in two source dates must remain two Excel detail rows');
  const pod=getSheetBills(workbook,'POD明细');
  assert.equal(pod.length,8,'POD detail must retain all seven first-day and one second-day completed member');
  assert.equal(getSheetBills(workbook,'退回明细').length,0);
  const ce=await createShopeeTemplateWorkbook({
    type:'CE',periodType:'custom',range,snapshots,outputDir:temp
  });
  const ceBook=new ExcelJS.Workbook();
  await ceBook.xlsx.readFile(ce.file);
  assert.equal(getSheetBills(ceBook,'全部明细').length,2,
    'per-business export must preserve selected daily source ownership');
  assert.equal(getSheetBills(ceBook,'POD明细').length,1);
  // The user's detail master has 19 columns, not 15. Source data may
  // contain fewer rows than the template; no stale field 16-19 may survive.
  const source=await fs.readFile(new URL('../src/shopeeTemplateExporter.js',import.meta.url),'utf8');
  const begin=source.indexOf('function clearDataRows(sheet, startRow) {');
  const end=source.indexOf('function detailValues(row) {',begin);
  assert.ok(begin>=0&&end>begin);
  const clearDataRows=new Function('DETAIL_HEADERS',
    source.slice(begin,end)+'\nreturn clearDataRows;')(
      Array.from({length:19},(_,i)=>'Column '+i));
  const mockBook=new ExcelJS.Workbook();
  const mock=mockBook.addWorksheet('DETAILS');
  for(let column=1;column<=19;column++)mock.getRow(2).getCell(column).value='STALE';
  clearDataRows(mock,2);
  for(let column=1;column<=19;column++)
    assert.equal(mock.getRow(2).getCell(column).value,null,
      'export template column '+column+' must be cleared, including 16-19');
  // An overlay CONFLICT must be nonterminal in the *actual XLSX*, even
  // when raw row fields still contain original scan POD or TMS=81.
  const conflicted=[
    {businessType:'WHPP',shipmentCode:'V788CONFLICTPOD',reportDate:'2026-07-02',
      isPod:0,是否POD:'否',currentState:'PENDING_VERIFICATION',
      shipmentStatus:'60',truthEvidence:{pod:true,returned:false},
      terminalEvidenceStatus:'CONFLICT'},
    {businessType:'WHPP',shipmentCode:'V788CONFLICTRET',reportDate:'2026-07-02',
      isPod:0,是否POD:'否',是否退回:'否',currentState:'PENDING_VERIFICATION',
      shipmentStatus:'81',truthEvidence:{pod:false,returned:true},
      terminalEvidenceStatus:'CONFLICT'}
  ];
  const conflictedFile=await createShopeeTemplateWorkbook({
    type:'WHPP',periodType:'daily',
    range:{from:'2026-07-02',to:'2026-07-02'},
    snapshots:[{snapshotId:'C-2026-07-02',reportDate:'2026-07-02',payload:{finalRows:conflicted}}],
    outputDir:temp
  });
  const conflictedBook=new ExcelJS.Workbook();
  await conflictedBook.xlsx.readFile(conflictedFile.file);
  assert.equal(getSheetBills(conflictedBook,'全部明细').length,2);
  assert.equal(getSheetBills(conflictedBook,'POD明细').length,0,
    'saved contradictory status 60 must not leak into POD sheet');
  assert.equal(getSheetBills(conflictedBook,'退回明细').length,0,
    'saved contradictory status 81 must not leak into returned sheet');
  assert.equal(getSheetBills(conflictedBook,'未POD明细').length,2,
    'all conflicted records must remain visible as unresolved');
  const staleFlags=[
    {businessType:'WHPP',shipmentCode:'V788STALEPODNOWRETURN',reportDate:'2026-07-02',
      isPod:0,是否POD:'否',是否退回:'是',退回状态:'已退回',
      currentState:'RETURNED',shipmentStatus:'60',orderStatus:'85',statusCode:'Y',statusDesc:'已退回',
      truthEvidence:{pod:true,returned:false},terminalEvidenceStatus:'STRICT_TMS'},
    {businessType:'WHPP',shipmentCode:'V788STALERETURNOWPOD',reportDate:'2026-07-02',
      isPod:1,是否POD:'是',是否退回:'否',
      currentState:'POD',shipmentStatus:'81',statusCode:'R',statusDesc:'POD闭环',
      truthEvidence:{pod:false,returned:true},
      terminalEvidenceStatus:'STRICT_TMS'}
  ];
  const staleWorkbook=await createShopeeTemplateWorkbook({
    type:'WHPP',periodType:'daily',range:{from:'2026-07-02',to:'2026-07-02'},
    snapshots:[{snapshotId:'STALE-2026-07-02',reportDate:'2026-07-02',
      payload:{finalRows:staleFlags}}],outputDir:temp
  });
  const staleBook=new ExcelJS.Workbook();
  await staleBook.xlsx.readFile(staleWorkbook.file);
  assert.equal(getSheetBills(staleBook,'全部明细').length,2);
  assert.equal(getSheetBills(staleBook,'POD明细')[0].bill,'V788STALERETURNOWPOD',
    'the newer strictly confirmed POD must override an old source 81 field');
  assert.equal(getSheetBills(staleBook,'退回明细')[0].bill,'V788STALEPODNOWRETURN',
    'the newer strictly confirmed return must override an old source POD85 flag');
  assert.equal(getSheetBills(staleBook,'未POD明细').length,0,
    'both corrected terminal members must leave unresolved rows');
  assert.equal(staleBook.getWorksheet('POD明细').getRow(2).getCell(4).value,'Y',
    'final POD detail must not print an obsolete R status marker');
  assert.equal(staleBook.getWorksheet('退回明细').getRow(2).getCell(4).value,'R',
    'final returned detail must not print an obsolete Y status marker');
  const collision=[
    {...day1[0]},
    {...day1[0],businessType:'SHOPEECN'}
  ];
  await assert.rejects(
    ()=>createShopeeTemplateWorkbook({
      type:'ALL',periodType:'daily',
      range:{from:'2026-07-01',to:'2026-07-01'},
      snapshots:[{snapshotId:'COLLISION',reportDate:'2026-07-01',payload:{finalRows:collision}}],
      outputDir:temp
    }),
    /七业务导出冲突/,
    'same-day cross-business duplicate must fail instead of silently discarding a shipment'
  );
  await assert.rejects(
    ()=>createShopeeTemplateWorkbook({
      type:'CE',periodType:'daily',
      range:{from:'2026-07-01',to:'2026-07-01'},
      snapshots:[{snapshotId:'DUPLICATE',reportDate:'2026-07-01',
        payload:{finalRows:[day1[0],{...day1[0]}]}}],
      outputDir:temp
    }),
    /报表来源重复/,
    'two identical same-day business memberships cannot silently collapse into one Excel row'
  );
  // Six unified businesses must be checked at the raw source-to-final merge,
  // before a per-bill Map or Excel uniqueRows can hide a missing member.
  const loadStart=sourceText.indexOf('function loadLightweightExportRows(');
  const loadEnd=sourceText.indexOf('// Read-only export overlay.',loadStart);
  assert.ok(loadStart>=0&&loadEnd>loadStart);
  let rawSource=[
    {shipmentCode:'V788SOURCE01',rowJson:'{}',regionCode:'PP',recipientRaw:'',recipientNormalized:''},
    {shipmentCode:'V788SOURCE02',rowJson:'{}',regionCode:'PV',recipientRaw:'',recipientNormalized:''}
  ];
  let finals=[
    {shipmentCode:'V788SOURCE01',businessType:'CE',currentState:'POD'},
    {shipmentCode:'V788SOURCE02',businessType:'CE',currentState:'PENDING_SCAN'}
  ];
  const readUnified=new Function('getDb','loadWhppCanonicalTruth','billOf',
    'overlaySavedTerminalExportTruth','compactSourceRow','loadLightweightUnifiedBusinessState',
    sourceText.slice(loadStart,loadEnd)+'\nreturn loadLightweightExportRows;')(
    ()=>({prepare:()=>({all:()=>rawSource})}),()=>({}),
    row=>String(row.shipmentCode||'').trim().toUpperCase(),
    rows=>rows,row=>row,()=>({finalRows:finals}));
  assert.equal(readUnified('UNIFIED-S1','2026-07-01','CE').length,2);
  finals=finals.slice(0,1);
  assert.throws(()=>readUnified('UNIFIED-S1','2026-07-01','CE'),
    /导出来源与最终明细运单不一致/,
    'final row missing one source bill must not silently export fewer rows');
  finals=[
    {shipmentCode:'V788SOURCE01',businessType:'CE'},
    {shipmentCode:'V788SOURCE03',businessType:'CE'}
  ];
  assert.throws(()=>readUnified('UNIFIED-S1','2026-07-01','CE'),
    /导出来源与最终明细运单不一致/,
    'equal total counts cannot hide a replaced source member');
  finals=[
    {shipmentCode:'V788SOURCE01',businessType:'CE'},
    {shipmentCode:'V788SOURCE02',businessType:'CE'}
  ];
  rawSource=[rawSource[0],{...rawSource[0]}];
  assert.throws(()=>readUnified('UNIFIED-S1','2026-07-01','CE'),
    /导出来源与最终明细运单不一致/,
    'duplicate source bills must be rejected before Map deduplication');

  // Check export-record history against the generated workbook audit, not
  // the unrelated ALL total. A single-business export must also be recorded.
  const periodSource=await fs.readFile(new URL('../src/periodExporter.js',import.meta.url),'utf8');
  const periodStart=periodSource.indexOf('export async function exportPeriodReports(');
  const periodEnd=periodSource.indexOf('async function createManagementWorkbook(',periodStart);
  assert.ok(periodStart>=0&&periodEnd>periodStart);
  const records=[];
  let managementOffset=0;
  const reportSource=mergedSnapshots;
  const exportPeriod=new Function('BUSINESSES','customPeriodRange','periodRange',
    'listLightweightCompletedUnifiedSnapshots','normalizeBusiness','getRuntimeConfig',
    'fs','path','createBusinessWorkbook','createManagementWorkbook','zipFiles',
    'recordExport','fileHash','stamp',
    periodSource.slice(periodStart,periodEnd).replace('export async function','async function')+
      '\nreturn exportPeriodReports;')(
    types,()=>range,()=>range,()=>reportSource,x=>x,()=>({exportsDir:'/virtual'}),
    {mkdir:async()=>{}},path,
    async ({type})=>({
      file:'/virtual/'+type+'.xlsx',
      audit:{rows:reportSource.reduce((sum,item)=>sum+
        item.payload.finalRows.filter(row=>row.businessType===type).length,0)}
    }),
    async ()=>({
      file:'/virtual/ALL.xlsx',
      audit:{rows:reportSource.reduce((sum,item)=>sum+item.payload.finalRows.length,0)+managementOffset}
    }),
    async()=>{},record=>records.push(record),()=> 'MOCK_HASH',()=> 'STATIC'
  );
  const allPeriod=await exportPeriod({periodType:'custom',businessType:'ALL'});
  assert.equal(allPeriod.files.length,8,'ALL report has seven business workbooks and a management book');
  assert.equal(records.length,9,'ALL export must record seven business files, management file and ZIP');
  assert.equal(records.find(row=>row.summary.businessType==='WHPP').rowCount,2,
    'WHPP-only extra source day must be reflected in its own export history');
  assert.equal(records.find(row=>row.summary.businessType==='CE').rowCount,1,
    'individual CE file cannot be logged as seven-business total');
  assert.equal(records.find(row=>row.exportType==='custom:all-zip').rowCount,8,
    'ZIP record must reflect distinct day-owned source members');
  records.length=0;
  const whppPeriod=await exportPeriod({periodType:'custom',businessType:'WHPP'});
  assert.equal(whppPeriod.files.length,1);
  assert.equal(records.length,1,'single-business Excel must create a recorded export entry');
  assert.equal(records[0].rowCount,2);
  assert.equal(records[0].summary.businessType,'WHPP');
  records.length=0;
  managementOffset=-1;
  await assert.rejects(()=>exportPeriod({periodType:'custom',businessType:'ALL'}),
    /七业务综合导出与来源成员总数不一致/,
    'a mismatched aggregate workbook must block ZIP publish');
  assert.equal(records.length,0,'rejected aggregate publish must not log PASSED export records');

  console.log('[V788 XLSX] seven businesses, 2 daily sources, same bill across dates and conflicting owner fail-closed PASS');
}finally{await fs.rm(temp,{recursive:true,force:true});}
