import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v419-whpp-valid-detail-'));
Object.assign(process.env,{DATA_DIR:root,DB_FILE:path.join(root,'whpp-valid-detail.db'),ACCESS_MODE:'LOCAL',NODE_ENV:'test',CI:'1',SQLITE_MMAP_BYTES:'0',SQLITE_CACHE_KIB:'8192'});

const {getDb,closeDb}=await import('../src/db.js');
const {inspectV172WhppDetail}=await import('../src/v172WhppDetailParityPatch.js');
const {listCompletedWhppSnapshots,countCompletedWhppRows,whppDailyCounts}=await import('../src/v87WhppExportStore.js');
const db=getDb();
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
  assert.equal(exportSnapshots.length,1,'WHPP export must include only dates with VALID+COMPLETED snapshots');
  assert.equal(exportSnapshots[0].reportDate,'2026-08-01');
  assert.deepEqual(exportSnapshots[0].payload.finalRows.map(row=>row.shipmentCode),[good],'residual final rows from invalid/non-member facts must not create WHPP export members');
  assert.equal(countCompletedWhppRows('2026-08-01','2026-08-02'),1,'WHPP completed export row count must be membership-locked');
  assert.deepEqual(whppDailyCounts('2026-08-01','2026-08-02'),[{reportDate:'2026-08-01',businessType:'WHPP',count:1}]);
  assert.equal(exportSnapshots[0].payload.finalRows[0].v419WhppExportMembershipId,'2026-09-03-v419-whpp-valid-completed-membership-export-v2');

  const partialA='WH-V419-PARTIAL-A',partialB='WH-V419-PARTIAL-B';
  const partialState={businessType:'WHPP',reportDate:'2026-08-03',pnhBills:[partialA,partialB],dailyParseRows:[],finalRows:[{shipmentCode:partialA,运单号:partialA},{shipmentCode:partialB,运单号:partialB}]};
  insertMinimal('business_export_snapshots',{snapshotId:'WH-VALID-0803',businessType:'WHPP',reportDate:'2026-08-03',runId:'RUN-PARTIAL',payloadJson:JSON.stringify({state:partialState}),generatedAt:'2026-08-03T10:00:00.000Z',createdAt:'2026-08-03T10:00:00.000Z',status:'VALID',reconciliationStatus:'COMPLETED'});
  insertMinimal('business_daily_reports',{businessType:'WHPP',reportDate:'2026-08-03',sourceFile:'8-3.xls',totalCount:2,summaryJson:'{}',createdAt:'2026-08-03T09:00:00.000Z',updatedAt:'2026-08-03T09:00:00.000Z'});
  insertMinimal('business_daily_parse_rows',{businessType:'WHPP',reportDate:'2026-08-03',shipmentCode:partialA,sheetName:'日报',rowNumber:2,source_row_number:2,recipient_raw:'WHPP',recipient_normalized:'WHPP',recipient_group:'WHPP',recipient_group_reason:'TEST',rawText:'',rowJson:JSON.stringify({运单号:partialA}),createdAt:'2026-08-03T09:00:00.000Z'});
  const partialGuard=error=>error?.code==='WHPP_STANDARD_DAILY_INCOMPLETE'&&error.expected===2&&error.actual===1;
  assert.throws(()=>inspectV172WhppDetail({reportDate:'2026-08-03',tab:'all'}),partialGuard,'partial standard WHPP membership must block detail instead of being hidden by completed snapshot fallback');
  assert.throws(()=>whppDailyCounts('2026-08-03','2026-08-03'),error=>error?.code==='WHPP_EXPORT_DAILY_MEMBERSHIP_INCOMPLETE'&&error.expected===2&&error.actual===1,'partial standard WHPP membership must block export instead of being hidden by snapshot fallback');

  console.log('[V419 WHPP VALID SNAPSHOT DETAIL+EXPORT] PASS invalid/failed snapshots and INVALID unified batches cannot override completed history or create phantom dates; residual final rows cannot create WHPP export members; partial standard membership fails closed in both detail and export; latest current POD still overlays valid daily membership');
}finally{
  try{closeDb();}catch{}
  fs.rmSync(root,{recursive:true,force:true});
}
