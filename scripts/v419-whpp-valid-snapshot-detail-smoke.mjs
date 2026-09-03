import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v419-whpp-valid-detail-'));
Object.assign(process.env,{DATA_DIR:root,DB_FILE:path.join(root,'whpp-valid-detail.db'),ACCESS_MODE:'LOCAL',NODE_ENV:'test',CI:'1',SQLITE_MMAP_BYTES:'0',SQLITE_CACHE_KIB:'8192'});

const {getDb,closeDb}=await import('../src/db.js');
const {inspectV172WhppDetail}=await import('../src/v172WhppDetailParityPatch.js');
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
  console.log('[V419 WHPP VALID SNAPSHOT DETAIL] PASS invalid/failed snapshots and INVALID unified batches cannot override completed history or create phantom range dates; latest current POD still overlays valid daily membership');
}finally{
  try{closeDb();}catch{}
  fs.rmSync(root,{recursive:true,force:true});
}
