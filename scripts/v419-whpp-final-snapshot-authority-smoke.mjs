import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v419-whpp-final-authority-'));
Object.assign(process.env,{DATA_DIR:root,DB_FILE:path.join(root,'whpp-final-authority.db'),ACCESS_MODE:'LOCAL',NODE_ENV:'test',CI:'1',SQLITE_MMAP_BYTES:'0',SQLITE_CACHE_KIB:'8192'});

const {getDb,closeDb}=await import('../src/db.js');
const {saveWhppDailyImport,finalizeWhppState}=await import('../src/whppStore.js');
const {listCompletedWhppSnapshots,countCompletedWhppRows}=await import('../src/v87WhppExportStore.js');
const {inspectV172WhppDetail}=await import('../src/v172WhppDetailParityPatch.js');
const db=getDb();
const now='2026-08-07T09:00:00.000Z';

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

try{
  // New V419 completion must certify the snapshot at the write owner itself.
  const date='2026-08-07',bill='WH-V419-FINAL-AUTH',dailyRow={shipmentCode:bill,运单号:bill,regionCode:'PP',rowNumber:2};
  const imported=saveWhppDailyImport({reportDate:date,sourceName:'8-7.xls',rows:[dailyRow],batchId:'B-FINAL-0807',snapshotId:'S-FINAL-0807'});
  const finalized=finalizeWhppState({
    ...imported,
    scanResults:[{shipmentCode:bill,运单号:bill,orderStatus:'85',是否POD:'是',POD状态:'POD',regionCode:'PP'}],
    trackEvents:[],exceptionItems:[],
    finalRows:[{...dailyRow,currentState:'POD',primaryCategory:'POD',主分类:'POD',异常分类:'POD',是否POD:'是',POD状态:'POD',退回状态:'未退回',API状态:'成功',carry状态:'closed_pod'}],
    lastRunSummary:{runId:'RUN-FINAL-0807'},lastRun:{runId:'RUN-FINAL-0807'},
    processing:{running:false,paused:false,phase:'完成',runId:'RUN-FINAL-0807'}
  });
  const persisted=db.prepare('SELECT status,reconciliationStatus,invalidReason,payloadJson FROM business_export_snapshots WHERE snapshotId=?').get(finalized.snapshotId);
  assert.equal(persisted.status,'VALID','new WHPP final snapshot must be VALID at insert time');
  assert.equal(persisted.reconciliationStatus,'COMPLETED','new WHPP final snapshot must be COMPLETED at insert time');
  assert.equal(String(persisted.invalidReason||''),'');
  const payload=JSON.parse(persisted.payloadJson||'{}');
  assert.equal(payload.status,'VALID');assert.equal(payload.reconciliationStatus,'COMPLETED');
  assert.equal(payload.finalSnapshotAuthority,'2026-09-03-v419-whpp-final-snapshot-valid-completed-v1');
  const dailySummary=JSON.parse(db.prepare("SELECT summaryJson FROM business_daily_reports WHERE businessType='WHPP' AND reportDate=?").get(date).summaryJson||'{}');
  assert.equal(dailySummary.completed,true);assert.equal(dailySummary.finalizedSnapshotId,finalized.snapshotId);assert.equal(dailySummary.reconciliationStatus,'COMPLETED');
  assert.equal(dailySummary.finalSnapshotAuthority,'2026-09-03-v419-whpp-final-snapshot-valid-completed-v1');
  const currentExport=listCompletedWhppSnapshots(date,date);
  assert.equal(currentExport.length,1);assert.equal(currentExport[0].snapshotId,finalized.snapshotId);assert.equal(countCompletedWhppRows(date,date),1);

  // Compatibility with snapshots created by the installed 4f53-era WHPP owner:
  // the row can still carry schema defaults LEGACY_UNVERIFIED / UNVERIFIED. It is
  // accepted only because the surviving completed daily summary points exactly
  // to this snapshot and the immutable snapshot membership equals the stored day.
  const legacyDate='2026-08-08',legacyBill='WH-V419-LEGACY-AUTH',legacySnapshot='WH-LEGACY-0808';
  const legacyRow={shipmentCode:legacyBill,运单号:legacyBill,regionCode:'PV',rowNumber:2};
  const legacyState={businessType:'WHPP',reportDate:legacyDate,pnhBills:[legacyBill],dailyParseRows:[legacyRow],finalRows:[{...legacyRow,currentState:'POD',primaryCategory:'POD',是否POD:'是',POD状态:'POD'}],processing:{running:false,paused:false,phase:'完成'}};
  insertMinimal('business_export_snapshots',{snapshotId:legacySnapshot,businessType:'WHPP',reportDate:legacyDate,runId:'RUN-LEGACY-0808',payloadJson:JSON.stringify({state:legacyState,dashboard:{},status:'VALID',reconciliationStatus:'COMPLETED'}),generatedAt:'2026-08-08T10:00:00.000Z',createdAt:'2026-08-08T10:00:00.000Z'});
  insertMinimal('business_daily_reports',{businessType:'WHPP',reportDate:legacyDate,sourceFile:'8-8.xls',totalCount:1,summaryJson:JSON.stringify({total:1,completed:true,snapshotStatus:'COMPLETED',finalizedSnapshotId:legacySnapshot,finalizedAt:'2026-08-08T10:00:00.000Z'}),createdAt:'2026-08-08T09:00:00.000Z',updatedAt:'2026-08-08T10:00:00.000Z'});
  insertMinimal('business_daily_parse_rows',{businessType:'WHPP',reportDate:legacyDate,shipmentCode:legacyBill,sheetName:'日报',rowNumber:2,source_row_number:2,recipient_raw:'WHPP',recipient_normalized:'WHPP',recipient_group:'WHPP',recipient_group_reason:'TEST',rawText:'',rowJson:JSON.stringify(legacyRow),createdAt:'2026-08-08T09:00:00.000Z'});
  const legacyDbRow=db.prepare('SELECT status,reconciliationStatus FROM business_export_snapshots WHERE snapshotId=?').get(legacySnapshot);
  assert.equal(legacyDbRow.status,'LEGACY_UNVERIFIED');assert.equal(legacyDbRow.reconciliationStatus,'UNVERIFIED');
  const legacyExport=listCompletedWhppSnapshots(legacyDate,legacyDate);
  assert.equal(legacyExport.length,1,'completed daily authority must preserve old finalized WHPP history without globally trusting legacy snapshots');
  assert.equal(legacyExport[0].snapshotId,legacySnapshot);assert.equal(legacyExport[0].legacyFinalized,true);assert.equal(countCompletedWhppRows(legacyDate,legacyDate),1);
  const replay=saveWhppDailyImport({reportDate:legacyDate,sourceName:'8-8-replay.xls',rows:[legacyRow],batchId:'B-LEGACY-REPLAY',snapshotId:'S-LEGACY-REPLAY'});
  assert.equal(replay.finalizedLifecyclePreserved,true);assert.equal(replay.finalizedLifecyclePreserveReason,'IDENTICAL_MEMBERSHIP_REUPLOAD');assert.equal(replay.legacyFinalizedSnapshotAttested,true);
  const historicalAnchorDate='2026-08-10',historicalAnchorBill='WH-V419-CURRENT-ANCHOR';
  const historicalAnchor=saveWhppDailyImport({reportDate:historicalAnchorDate,sourceName:'8-10-anchor.xls',rows:[{shipmentCode:historicalAnchorBill,运单号:historicalAnchorBill,regionCode:'PP',rowNumber:2}],batchId:'B-HISTORICAL-ANCHOR',snapshotId:'S-HISTORICAL-ANCHOR'});
  assert.equal(historicalAnchor.reportDate,historicalAnchorDate,'fixture must advance current WHPP state so 8/8 exercises historical snapshot recovery');

  // Simulate old normalized member rows being rotated away. V172 detail and V87
  // export must both recover the exact same legacy finalized snapshot membership,
  // still excluding any finalRows-only carry members.
  db.prepare("DELETE FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?").run(legacyDate);
  const legacyRotatedExport=listCompletedWhppSnapshots(legacyDate,legacyDate);
  assert.equal(legacyRotatedExport.length,1);assert.equal(countCompletedWhppRows(legacyDate,legacyDate),1);
  assert.equal(legacyRotatedExport[0].payload.finalRows[0].whppExportMembershipSource,'WHPP_LEGACY_FINALIZED_SNAPSHOT_PNH');
  const legacyDetail=inspectV172WhppDetail({reportDate:legacyDate,tab:'all',page:'1',pageSize:'500'});
  assert.equal(legacyDetail.total,1,'V172 must preserve certified 4f53 legacy completed history after daily member rows rotate');
  assert.equal(legacyDetail.rows[0]?.shipmentCode,legacyBill);
  assert.equal(legacyDetail.rows[0]?.detailMembershipSource,'BUSINESS_EXPORT_SNAPSHOT_LEGACY_DAILY_ATTESTED');

  // A changed reupload of that same legacy date starts a new lifecycle. Even the
  // old LEGACY_UNVERIFIED row must become explicitly INVALID/FAILED, not merely
  // lose eligibility because the daily summary was rewritten.
  const legacyReplacement='WH-V419-LEGACY-REPLACEMENT';
  const legacyChanged=saveWhppDailyImport({reportDate:legacyDate,sourceName:'8-8-changed.xls',rows:[{shipmentCode:legacyReplacement,运单号:legacyReplacement,regionCode:'PV',rowNumber:2}],batchId:'B-LEGACY-CHANGED',snapshotId:'S-LEGACY-CHANGED'});
  assert.deepEqual(legacyChanged.pnhBills,[legacyReplacement]);
  const invalidLegacy=db.prepare('SELECT status,reconciliationStatus,invalidReason FROM business_export_snapshots WHERE snapshotId=?').get(legacySnapshot);
  assert.equal(invalidLegacy.status,'INVALID');assert.equal(invalidLegacy.reconciliationStatus,'FAILED');assert.match(String(invalidLegacy.invalidReason||''),/WHPP_DAILY_REIMPORT_NEW_LIFECYCLE/);
  assert.deepEqual(listCompletedWhppSnapshots(legacyDate,legacyDate),[],'changed legacy reupload must revoke completed export eligibility immediately');
  const changedLegacyDetail=inspectV172WhppDetail({reportDate:legacyDate,tab:'all',page:'1',pageSize:'500'});
  assert.deepEqual(changedLegacyDetail.rows.map(row=>row.shipmentCode),[legacyReplacement],'detail must switch from invalidated legacy completion to new daily membership immediately');

  // A legacy snapshot is not self-authorizing. A daily header that is pending or
  // points elsewhere must keep it out of completed export and rotated detail.
  const orphanDate='2026-08-09',orphanBill='WH-V419-LEGACY-ORPHAN',orphanSnapshot='WH-LEGACY-ORPHAN-0809';
  insertMinimal('business_export_snapshots',{snapshotId:orphanSnapshot,businessType:'WHPP',reportDate:orphanDate,runId:'RUN-ORPHAN',payloadJson:JSON.stringify({state:{businessType:'WHPP',reportDate:orphanDate,pnhBills:[orphanBill],dailyParseRows:[{shipmentCode:orphanBill,运单号:orphanBill}]}}),generatedAt:'2026-08-09T10:00:00.000Z',createdAt:'2026-08-09T10:00:00.000Z'});
  insertMinimal('business_daily_reports',{businessType:'WHPP',reportDate:orphanDate,sourceFile:'8-9.xls',totalCount:1,summaryJson:JSON.stringify({total:1,completed:false,snapshotStatus:'PENDING'}),createdAt:'2026-08-09T09:00:00.000Z',updatedAt:'2026-08-09T10:00:00.000Z'});
  insertMinimal('business_daily_parse_rows',{businessType:'WHPP',reportDate:orphanDate,shipmentCode:orphanBill,sheetName:'日报',rowNumber:2,source_row_number:2,recipient_raw:'WHPP',recipient_normalized:'WHPP',recipient_group:'WHPP',recipient_group_reason:'TEST',rawText:'',rowJson:JSON.stringify({shipmentCode:orphanBill,运单号:orphanBill}),createdAt:'2026-08-09T09:00:00.000Z'});
  assert.deepEqual(listCompletedWhppSnapshots(orphanDate,orphanDate),[],'unreferenced legacy snapshot must not self-authorize completed history');
  assert.equal(countCompletedWhppRows(orphanDate,orphanDate),0);
  db.prepare("DELETE FROM business_daily_parse_rows WHERE businessType='WHPP' AND reportDate=?").run(orphanDate);
  const orphanDetail=inspectV172WhppDetail({reportDate:orphanDate,tab:'all',page:'1',pageSize:'500'});
  assert.equal(orphanDetail.total,0,'pending daily authority must not allow a legacy snapshot to self-authorize rotated historical detail');

  console.log('[V419 WHPP FINAL SNAPSHOT AUTHORITY] PASS new finalize writes VALID+COMPLETED at source · 4f53 legacy finalized snapshot preserved in export+detail only by exact completed daily authority + immutable membership · changed legacy reupload explicitly INVALID/FAILED · orphan legacy snapshot rejected');
}finally{
  try{closeDb();}catch{}
  fs.rmSync(root,{recursive:true,force:true});
}
