import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v419-whpp-valid-detail-'));
Object.assign(process.env,{DATA_DIR:root,DB_FILE:path.join(root,'whpp-valid-detail.db'),ACCESS_MODE:'LOCAL',NODE_ENV:'test',CI:'1',SQLITE_MMAP_BYTES:'0',SQLITE_CACHE_KIB:'8192'});

const {getDb,closeDb}=await import('../src/db.js');
const {inspectV172WhppDetail}=await import('../src/v172WhppDetailParityPatch.js');
const {listCompletedWhppSnapshots,countCompletedWhppRows,whppDailyCounts}=await import('../src/v87WhppExportStore.js');
const {saveWhppDailyImport}=await import('../src/whppStore.js');
const {ensureV246TrackingSchema,reconcileV246TrackingLedger}=await import('../src/v246TrackingLedgerCore.js');
const db=getDb();
ensureV246TrackingSchema(db);
const now='2026-08-01T10:00:00.000Z';
function insertMinimal(table,values){
  const info=db.prepare(`PRAGMA table_info(${table})`).all(),known=new Map(info.map(c=>[c.name,c])),data={};
  for(const [key,value] of Object.entries(values))if(known.has(key))data[key]=value;
  for(const col of info){
    if(Object.hasOwn(data,col.name)||col.dflt_value!==null)continue;
    if(col.pk&&String(col.type||'').toUpperCase().includes('INT'))continue;
    if(!col.notnull&&!col.pk)continue;
    const t=String(col.type||'').toUpperCase();
    data[col.name]=/INT|REAL|NUM|DEC|BOOL/.test(t)?0:(/AT$|TIME|DATE/i.test(col.name)?now:'');
  }
  const cols=Object.keys(data),marks=cols.map(()=>'?').join(',');
  db.prepare(`INSERT INTO ${table}(${cols.map(c=>`"${c}"`).join(',')}) VALUES(${marks})`).run(...cols.map(c=>data[c]));
}
function state(bill,category='Pending'){
  return{businessType:'WHPP',reportDate:'2026-08-01',pnhBills:[bill],dailyParseRows:[{shipmentCode:bill,运单号:bill,regionCode:'PP',日报日期:'2026-08-01'}],finalRows:[{shipmentCode:bill,运单号:bill,regionCode:'PP',是否POD:'否',currentState:'OPEN',primaryCategory:category}]};
}
try{
  const good='WH-V419-VALID',bad='WH-V419-INVALID',invalidOnly='WH-V419-INVALID-ONLY',invalidUnified='WH-V419-INVALID-UNIFIED';
  insertMinimal('business_export_snapshots',{snapshotId:'WH-VALID-0801',businessType:'WHPP',reportDate:'2026-08-01',runId:'RUN-VALID',payloadJson:JSON.stringify({state:state(good)}),generatedAt:'2026-08-01T10:00:00.000Z',createdAt:'2026-08-01T10:00:00.000Z',status:'VALID',reconciliationStatus:'COMPLETED'});
  insertMinimal('business_export_snapshots',{snapshotId:'WH-INVALID-LATE-0801',businessType:'WHPP',reportDate:'2026-08-01',runId:'RUN-INVALID',payloadJson:JSON.stringify({state:state(bad,'错误快照')}),generatedAt:'2026-08-01T12:00:00.000Z',createdAt:'2026-08-01T12:00:00.000Z',status:'INVALID',reconciliationStatus:'FAILED'});
  insertMinimal('business_export_snapshots',{snapshotId:'WH-INVALID-ONLY-0802',businessType:'WHPP',reportDate:'2026-08-02',runId:'RUN-INVALID-ONLY',payloadJson:JSON.stringify({state:{...state(invalidOnly),reportDate:'2026-08-02',dailyParseRows:[{shipmentCode:invalidOnly,运单号:invalidOnly,regionCode:'PV',日报日期:'2026-08-02'}]}}),generatedAt:'2026-08-02T12:00:00.000Z',createdAt:'2026-08-02T12:00:00.000Z',status:'INVALID',reconciliationStatus:'FAILED'});
  insertMinimal('unified_import_batches',{batchId:'B-INVALID-0802',snapshotId:'S-INVALID-0802',reportDate:'2026-08-02',sourceName:'8-2-invalid.xls',fileHash:'invalid-fixture',status:'INVALID',summaryJson:'{}',warningsJson:'[]',createdAt:'2026-08-02T13:00:00.000Z'});
  insertMinimal('unified_import_rows',{batchId:'B-INVALID-0802',snapshotId:'S-INVALID-0802',reportDate:'2026-08-02',businessType:'WHPP',shipmentCode:invalidUnified,regionCode:'PV',recipientRaw:'WHPP',recipientNormalized:'WHPP',sheetName:'日报',rowNumber:2,classificationReason:'INVALID_FIXTURE',rowJson:JSON.stringify({运单号:invalidUnified,regionCode:'PV'}),createdAt:'2026-08-02T13:00:00.000Z'});
  for(const [bill,reportDate,category] of [[good,'2026-08-01','Pending'],[bad,'2026-08-01','错误残留'],[invalidOnly,'2026-08-02','错误残留'],[invalidUnified,'2026-08-02','错误残留']]){
    insertMinimal('business_final_rows',{businessType:'WHPP',shipmentCode:bill,reportDate,isPod:0,primaryCategory:category,apiStatus:'SUCCESS',carryStatus:'OPEN',rawJson:JSON.stringify({shipmentCode:bill,运单号:bill,currentState:'OPEN',primaryCategory:category}),createdAt:now,updatedAt:now});
  }
  insertMinimal('shipment_current_state',{shipmentCode:good,businessType:'WHPP',reportDate:'2026-08-02',snapshotId:'CURRENT-1',state:'POD',apiStatus:'SUCCESS',lastEventTime:'2026-08-02T18:00:00+07:00',stateJson:JSON.stringify({shipmentCode:good,运单号:good,regionCode:'PP',currentState:'POD',是否POD:'是',POD状态:'POD',POD时间:'2026-08-02T18:00:00+07:00'}),updatedAt:'2026-08-02T18:01:00+07:00'});

  const one=inspectV172WhppDetail({reportDate:'2026-08-01',tab:'pod',page:'1',pageSize:'500'});
  assert.equal(one.total,1,'later INVALID snapshot must not replace the completed WHPP history snapshot');
  assert.equal(one.rows[0]?.shipmentCode,good);
  assert.equal(one.rows[0]?.reportMembershipDate,'2026-08-01');
  assert.equal(one.rows[0]?.detailMembershipSource,'BUSINESS_EXPORT_SNAPSHOT_VALID_COMPLETED');
  assert.ok(one.rows[0]?.是否POD==='是'||one.rows[0]?.POD状态==='POD'||String(one.rows[0]?.currentState||'').toUpperCase()==='POD','latest current POD must still overlay valid historical membership');

  const range=inspectV172WhppDetail({from:'2026-08-01',to:'2026-08-02',tab:'all',page:'1',pageSize:'500'});
  assert.deepEqual(range.dates,['2026-08-01'],'INVALID-only snapshot or INVALID unified batch must not create a historical membership date');
  assert.equal(range.total,1);
  assert.equal(range.rows[0]?.shipmentCode,good);
  assert.ok(!range.rows.some(row=>[bad,invalidOnly,invalidUnified].includes(row.shipmentCode)),'invalid snapshot/unified members must never leak into WHPP range detail');

  const exportSnapshots=listCompletedWhppSnapshots('2026-08-01','2026-08-02');
  assert.equal(exportSnapshots.length,1,'WHPP export must include only certified completed dates');
  assert.equal(exportSnapshots[0].reportDate,'2026-08-01');
  assert.deepEqual(exportSnapshots[0].payload.finalRows.map(row=>row.shipmentCode),[good],'residual final rows from invalid/non-member facts must not create WHPP export members');
  assert.equal(countCompletedWhppRows('2026-08-01','2026-08-02'),1,'WHPP completed export row count must be membership-locked');
  assert.deepEqual(whppDailyCounts('2026-08-01','2026-08-02'),[{reportDate:'2026-08-01',businessType:'WHPP',count:1}]);
  assert.equal(exportSnapshots[0].payload.finalRows[0].v419WhppExportMembershipId,'2026-09-03-v419-whpp-completion-certified-membership-export-v4');

  const partialA='WH-V419-PARTIAL-A',partialB='WH-V419-PARTIAL-B',partialSnapshot='WH-VALID-0803';
  const partialState={businessType:'WHPP',reportDate:'2026-08-03',pnhBills:[partialA,partialB],dailyParseRows:[],finalRows:[{shipmentCode:partialA,运单号:partialA},{shipmentCode:partialB,运单号:partialB}]};
  insertMinimal('business_export_snapshots',{snapshotId:partialSnapshot,businessType:'WHPP',reportDate:'2026-08-03',runId:'RUN-PARTIAL',payloadJson:JSON.stringify({state:partialState}),generatedAt:'2026-08-03T10:00:00.000Z',createdAt:'2026-08-03T10:00:00.000Z',status:'VALID',reconciliationStatus:'COMPLETED'});
  insertMinimal('business_daily_reports',{businessType:'WHPP',reportDate:'2026-08-03',sourceFile:'8-3.xls',totalCount:2,summaryJson:JSON.stringify({total:2,completed:true,snapshotStatus:'COMPLETED',reconciliationStatus:'COMPLETED',finalizedSnapshotId:partialSnapshot}),createdAt:'2026-08-03T09:00:00.000Z',updatedAt:'2026-08-03T10:00:00.000Z'});
  insertMinimal('business_daily_parse_rows',{businessType:'WHPP',reportDate:'2026-08-03',shipmentCode:partialA,sheetName:'日报',rowNumber:2,source_row_number:2,recipient_raw:'WHPP',recipient_normalized:'WHPP',recipient_group:'WHPP',recipient_group_reason:'TEST',rawText:'',rowJson:JSON.stringify({运单号:partialA}),createdAt:'2026-08-03T09:00:00.000Z'});
  const partialGuard=error=>error?.code==='WHPP_STANDARD_DAILY_INCOMPLETE'&&error.expected===2&&error.actual===1;
  assert.throws(()=>inspectV172WhppDetail({reportDate:'2026-08-03',tab:'all'}),partialGuard,'partial standard WHPP membership must block detail instead of being hidden by completed snapshot fallback');
  assert.throws(()=>whppDailyCounts('2026-08-03','2026-08-03'),error=>error?.code==='WHPP_EXPORT_DAILY_MEMBERSHIP_INCOMPLETE'&&error.expected===2&&error.actual===1,'certified completed date with partial standard WHPP membership must fail closed in export');

  // WHPP pipeline finalRows contains today + carry. When persisted daily rows are
  // fully rotated, both detail and export recovery must use immutable pnhBills
  // (or dailyParseRows), never carry-contaminated finalRows.
  const rotatedDaily='WH-V419-ROTATED-DAILY',rotatedCarry='WH-V419-ROTATED-CARRY',rotatedSnapshot='WH-VALID-0804';
  const rotatedState={businessType:'WHPP',reportDate:'2026-08-04',pnhBills:[rotatedDaily],dailyParseRows:[],carryBills:[rotatedCarry],nextCarryBills:[rotatedCarry],finalRows:[
    {shipmentCode:rotatedDaily,运单号:rotatedDaily,regionCode:'PP',currentState:'POD',是否POD:'是'},
    {shipmentCode:rotatedCarry,运单号:rotatedCarry,regionCode:'PV',currentState:'Pending',是否POD:'否'}
  ]};
  insertMinimal('business_export_snapshots',{snapshotId:rotatedSnapshot,businessType:'WHPP',reportDate:'2026-08-04',runId:'RUN-ROTATED',payloadJson:JSON.stringify({state:rotatedState}),generatedAt:'2026-08-04T10:00:00.000Z',createdAt:'2026-08-04T10:00:00.000Z',status:'VALID',reconciliationStatus:'COMPLETED'});
  insertMinimal('business_daily_reports',{businessType:'WHPP',reportDate:'2026-08-04',sourceFile:'8-4.xls',totalCount:1,summaryJson:JSON.stringify({total:1,completed:true,snapshotStatus:'COMPLETED',reconciliationStatus:'COMPLETED',finalizedSnapshotId:rotatedSnapshot}),createdAt:'2026-08-04T09:00:00.000Z',updatedAt:'2026-08-04T10:00:00.000Z'});
  for(const [bill,category,isPod] of [[rotatedDaily,'POD',1],[rotatedCarry,'Pending',0]])insertMinimal('business_final_rows',{businessType:'WHPP',shipmentCode:bill,reportDate:'2026-08-04',isPod,primaryCategory:category,apiStatus:'SUCCESS',carryStatus:isPod?'CLOSED':'OPEN',rawJson:JSON.stringify({shipmentCode:bill,运单号:bill,currentState:category,是否POD:isPod?'是':'否'}),createdAt:'2026-08-04T10:00:00.000Z',updatedAt:'2026-08-04T10:00:00.000Z'});
  const rotated=listCompletedWhppSnapshots('2026-08-04','2026-08-04');
  assert.equal(rotated.length,1);
  assert.equal(countCompletedWhppRows('2026-08-04','2026-08-04'),1);
  assert.deepEqual(rotated[0].payload.finalRows.map(row=>row.shipmentCode),[rotatedDaily],'carry saved inside snapshot finalRows must never become recovered export membership');
  assert.equal(rotated[0].payload.finalRows[0].whppExportMembershipSource,'WHPP_VALID_COMPLETED_SNAPSHOT_PNH');
  assert.ok(!rotated[0].payload.finalRows.some(row=>row.shipmentCode===rotatedCarry),'carry member must stay excluded from export even when residual final row exists for the same report date');
  const rotatedDetail=inspectV172WhppDetail({reportDate:'2026-08-04',tab:'all',page:'1',pageSize:'500'});
  assert.equal(rotatedDetail.total,1,'WHPP historical detail must use the same immutable daily membership as export');
  assert.deepEqual(rotatedDetail.rows.map(row=>row.shipmentCode),[rotatedDaily]);
  assert.ok(!rotatedDetail.rows.some(row=>row.shipmentCode===rotatedCarry),'carry saved inside snapshot finalRows must never become WHPP detail membership');
  assert.equal(rotatedDetail.truthSource,'IMMUTABLE_DAILY_MEMBERSHIP_PLUS_LATEST_SHIPMENT_CURRENT_STATE');

  // Same-day membership change is a new lifecycle. The previously completed
  // snapshot/history/finals and removed same-day OPEN carry/ledger must disappear
  // from active truth before the new cohort is visible. True earlier-day carry survives.
  const oldBill='WH-V419-REIMPORT-OLD',newBill='WH-V419-REIMPORT-NEW',historicCarry='WH-V419-HIST-CARRY',oldSnapshot='WH-VALID-0805';
  const oldState={businessType:'WHPP',reportDate:'2026-08-05',pnhBills:[oldBill],dailyParseRows:[{shipmentCode:oldBill,运单号:oldBill,regionCode:'PP',rowNumber:2}],finalRows:[{shipmentCode:oldBill,运单号:oldBill,currentState:'POD',是否POD:'是'}]};
  insertMinimal('business_export_snapshots',{snapshotId:oldSnapshot,businessType:'WHPP',reportDate:'2026-08-05',runId:'RUN-OLD-0805',payloadJson:JSON.stringify({state:oldState}),generatedAt:'2026-08-05T10:00:00.000Z',createdAt:'2026-08-05T10:00:00.000Z',status:'VALID',reconciliationStatus:'COMPLETED'});
  insertMinimal('business_daily_reports',{businessType:'WHPP',reportDate:'2026-08-05',sourceFile:'8-5-old.xls',totalCount:1,summaryJson:JSON.stringify({total:1,completed:true,snapshotStatus:'COMPLETED',finalizedSnapshotId:oldSnapshot,finalizedAt:'2026-08-05T10:00:00.000Z'}),createdAt:'2026-08-05T09:00:00.000Z',updatedAt:'2026-08-05T10:00:00.000Z'});
  insertMinimal('business_daily_parse_rows',{businessType:'WHPP',reportDate:'2026-08-05',shipmentCode:oldBill,sheetName:'日报',rowNumber:2,source_row_number:2,recipient_raw:'WHPP',recipient_normalized:'WHPP',recipient_group:'WHPP',recipient_group_reason:'TEST',rawText:'',rowJson:JSON.stringify({运单号:oldBill,regionCode:'PP'}),createdAt:'2026-08-05T09:00:00.000Z'});
  insertMinimal('business_history_summary',{businessType:'WHPP',reportDate:'2026-08-05',summaryJson:JSON.stringify({total:1,pod:1}),createdAt:'2026-08-05T10:00:00.000Z',updatedAt:'2026-08-05T10:00:00.000Z'});
  insertMinimal('business_final_rows',{businessType:'WHPP',shipmentCode:oldBill,reportDate:'2026-08-05',isPod:1,primaryCategory:'POD',apiStatus:'SUCCESS',carryStatus:'CLOSED',rawJson:JSON.stringify({shipmentCode:oldBill,运单号:oldBill,currentState:'POD',是否POD:'是'}),createdAt:'2026-08-05T10:00:00.000Z',updatedAt:'2026-08-05T10:00:00.000Z'});
  insertMinimal('carryover_open_items',{shipmentCode:oldBill,businessType:'WHPP',sourceReportDate:'2026-08-05',lastReportDate:'2026-08-05',sourceSnapshotId:'S-OLD-0805',lastSnapshotId:'S-OLD-0805',status:'OPEN',apiStatus:'SUCCESS',closeReason:'',stateJson:JSON.stringify({shipmentCode:oldBill,currentState:'Pending'}),createdAt:'2026-08-05T09:00:00.000Z',updatedAt:'2026-08-05T10:00:00.000Z'});
  insertMinimal('carryover_open_items',{shipmentCode:historicCarry,businessType:'WHPP',sourceReportDate:'2026-08-04',lastReportDate:'2026-08-05',sourceSnapshotId:'S-HIST-0804',lastSnapshotId:'S-HIST-0805',status:'OPEN',apiStatus:'SUCCESS',closeReason:'',stateJson:JSON.stringify({shipmentCode:historicCarry,currentState:'Pending'}),createdAt:'2026-08-04T09:00:00.000Z',updatedAt:'2026-08-05T10:00:00.000Z'});
  insertMinimal('qc_tracking_ledger',{shipmentCode:oldBill,businessType:'WHPP',firstReportDate:'2026-08-05',lastImportedDate:'2026-08-05',sourceSnapshotId:'S-OLD-0805',lastSnapshotId:'S-OLD-0805',trackingStatus:'OPEN',terminalReason:'',terminalAt:'',currentState:'Pending',currentCategory:'Pending',lastEventTime:'',podDate:'',attemptNo:0,attemptSource:'',signingDays:null,evidenceJson:'{}',currentStateJson:JSON.stringify({shipmentCode:oldBill,currentState:'Pending'}),lastCheckedAt:'2026-08-05T10:00:00.000Z',lastRepairReason:'TEST_OLD_MEMBER',createdAt:'2026-08-05T09:00:00.000Z',updatedAt:'2026-08-05T10:00:00.000Z'});
  const reimported=saveWhppDailyImport({reportDate:'2026-08-05',sourceName:'8-5-new.xls',rows:[{shipmentCode:newBill,运单号:newBill,regionCode:'PP',rowNumber:2}],batchId:'B-NEW-0805',snapshotId:'S-NEW-0805'});
  assert.deepEqual(reimported.pnhBills,[newBill],'changed same-day reupload must publish only the new WHPP membership');
  const invalidated=db.prepare('SELECT status,reconciliationStatus,invalidReason FROM business_export_snapshots WHERE snapshotId=?').get(oldSnapshot);
  assert.equal(invalidated.status,'INVALID');assert.equal(invalidated.reconciliationStatus,'FAILED');assert.match(String(invalidated.invalidReason||''),/WHPP_DAILY_REIMPORT_NEW_LIFECYCLE/);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM business_history_summary WHERE businessType='WHPP' AND reportDate='2026-08-05'").get().count,0,'old completed history summary must be cleared on changed reupload');
  assert.equal(db.prepare("SELECT COUNT(*) count FROM business_final_rows WHERE businessType='WHPP' AND reportDate='2026-08-05'").get().count,0,'old same-day derived final rows must be cleared before the new lifecycle runs');
  assert.equal(db.prepare("SELECT shipmentCode FROM carryover_open_items WHERE shipmentCode=?").get(oldBill),undefined,'removed same-day WHPP member must leave the active carry table entirely');
  assert.equal(db.prepare("SELECT shipmentCode FROM qc_tracking_ledger WHERE shipmentCode=?").get(oldBill),undefined,'V246 OPEN ledger created only by the removed day must be retired with that membership');
  assert.equal(db.prepare("SELECT COUNT(*) count FROM qc_tracking_audit WHERE shipmentCode=? AND action='WHPP_REIMPORT_RETIRE_REMOVED_MEMBER'").get(oldBill).count,1,'ledger retirement must remain auditable');
  const preservedCarry=db.prepare("SELECT status,sourceReportDate FROM carryover_open_items WHERE shipmentCode=?").get(historicCarry);
  assert.equal(preservedCarry.status,'OPEN','real earlier-day WHPP carry must survive a same-day correction');assert.equal(preservedCarry.sourceReportDate,'2026-08-04');
  assert.ok(!reimported.carryBills.includes(oldBill)&&!reimported.nextCarryBills.includes(oldBill),'retired same-day member must be removed from in-memory carry queues immediately');
  assert.ok(reimported.carryBills.includes(historicCarry)&&reimported.nextCarryBills.includes(historicCarry),'earlier-day carry must remain in both persisted and in-memory continuation truth');
  const postReimportReconcile=reconcileV246TrackingLedger({businessType:'WHPP',fromDate:'2026-08-05',toDate:'2026-08-05'},{db,reason:'V419_REIMPORT_REOPEN_GUARD'});
  assert.equal(postReimportReconcile.expected,1,'V246 reconcile must see only the replacement WHPP daily member for the corrected date');
  assert.equal(db.prepare("SELECT shipmentCode FROM qc_tracking_ledger WHERE shipmentCode=?").get(oldBill),undefined,'V246 reconcile must not resurrect a removed same-day WHPP member');
  assert.equal(db.prepare("SELECT shipmentCode FROM carryover_open_items WHERE shipmentCode=?").get(oldBill),undefined,'V246 reconcile must not recreate removed same-day carry');
  const reimportDaily=db.prepare("SELECT totalCount,summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate='2026-08-05'").get(),reimportSummary=JSON.parse(reimportDaily.summaryJson||'{}');
  assert.equal(Number(reimportDaily.totalCount),1);assert.notEqual(reimportSummary.completed,true);assert.equal(reimportSummary.lifecycleRevision,'2026-09-03-v419-whpp-reimport-invalidates-old-completion-v1');
  assert.deepEqual(db.prepare("SELECT shipmentCode FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate='2026-08-05' ORDER BY shipmentCode").all().map(row=>row.shipmentCode),[newBill]);
  assert.deepEqual(listCompletedWhppSnapshots('2026-08-05','2026-08-05'),[],'changed reupload must not remain export-eligible before the new WHPP run completes');
  const reimportDetail=inspectV172WhppDetail({reportDate:'2026-08-05',tab:'all'});
  assert.deepEqual(reimportDetail.rows.map(row=>row.shipmentCode),[newBill],'detail must switch immediately to the new same-day membership');

  // Exact same finalized membership is deliberately a no-op. It must retain the
  // valid completed snapshot and never force WHPP to run a second time.
  const sameBill='WH-V419-SAME-REUPLOAD',sameSnapshot='WH-VALID-0806',sameRow={shipmentCode:sameBill,运单号:sameBill,regionCode:'PP',rowNumber:2};
  const sameState={businessType:'WHPP',reportDate:'2026-08-06',pnhBills:[sameBill],dailyParseRows:[sameRow],finalRows:[{...sameRow,currentState:'POD',是否POD:'是'}],processing:{running:false,paused:false,phase:'完成'}};
  insertMinimal('business_export_snapshots',{snapshotId:sameSnapshot,businessType:'WHPP',reportDate:'2026-08-06',runId:'RUN-SAME-0806',payloadJson:JSON.stringify({state:sameState}),generatedAt:'2026-08-06T10:00:00.000Z',createdAt:'2026-08-06T10:00:00.000Z',status:'VALID',reconciliationStatus:'COMPLETED'});
  insertMinimal('business_daily_reports',{businessType:'WHPP',reportDate:'2026-08-06',sourceFile:'8-6.xls',totalCount:1,summaryJson:JSON.stringify({total:1,completed:true,snapshotStatus:'COMPLETED',finalizedSnapshotId:sameSnapshot,finalizedAt:'2026-08-06T10:00:00.000Z'}),createdAt:'2026-08-06T09:00:00.000Z',updatedAt:'2026-08-06T10:00:00.000Z'});
  insertMinimal('business_daily_parse_rows',{businessType:'WHPP',reportDate:'2026-08-06',shipmentCode:sameBill,sheetName:'日报',rowNumber:2,source_row_number:2,recipient_raw:'WHPP',recipient_normalized:'WHPP',recipient_group:'WHPP',recipient_group_reason:'TEST',rawText:'',rowJson:JSON.stringify(sameRow),createdAt:'2026-08-06T09:00:00.000Z'});
  const replay=saveWhppDailyImport({reportDate:'2026-08-06',sourceName:'8-6-replay.xls',rows:[sameRow],batchId:'B-SAME-0806',snapshotId:'S-SAME-0806'});
  assert.equal(replay.finalizedLifecyclePreserved,true);assert.equal(replay.finalizedLifecyclePreserveReason,'IDENTICAL_MEMBERSHIP_REUPLOAD');
  const replaySnapshot=db.prepare('SELECT status,reconciliationStatus FROM business_export_snapshots WHERE snapshotId=?').get(sameSnapshot);
  assert.equal(replaySnapshot.status,'VALID');assert.equal(replaySnapshot.reconciliationStatus,'COMPLETED');
  const replaySummary=JSON.parse(db.prepare("SELECT summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate='2026-08-06'").get().summaryJson||'{}');
  assert.equal(replaySummary.completed,true);assert.equal(replaySummary.finalizedSnapshotId,sameSnapshot);
  assert.equal(listCompletedWhppSnapshots('2026-08-06','2026-08-06').length,1,'identical completed reupload must remain export-eligible and must not restart WHPP');

  console.log('[V419 WHPP VALID SNAPSHOT DETAIL+EXPORT+REIMPORT] PASS invalid/failed history rejected · certified partial membership fail-closed · snapshot carry excluded · changed same-day reupload retires removed active carry+V246 ledger · V246 reconcile cannot resurrect it · real historical carry preserved · identical finalized reupload remains a no-op');
}finally{
  try{closeDb();}catch{}
  fs.rmSync(root,{recursive:true,force:true});
}
