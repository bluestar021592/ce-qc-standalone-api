import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v27-sql-'));
process.env.DATA_DIR=temp;
process.env.DB_FILE=path.join(temp,'v27.db');

const [{getDb,closeDb},{v27MetricDetailHandler,v27CarryMonitorHandler}]=await Promise.all([
  import('../src/db.js'),
  import('../src/v27ServerPatch.js')
]);

function responseStub(){
  return {
    statusCode:200,headers:{},body:null,
    setHeader(k,v){this.headers[k]=v;},
    status(code){this.statusCode=code;return this;},
    json(body){this.body=body;return this;}
  };
}

function seed(){
  const db=getDb();
  const now=new Date().toISOString();
  db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,'VALID','{}','[]',?)`).run('b1','s1','2026-07-29','daily.xlsx','hash',now);
  db.prepare(`INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES('s1','b1','2026-07-29','COMPLETED','{}',?)`).run(now);
  const insImport=db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES('b1','s1','2026-07-29',?,?,?,?,?,'S',1,'test','{}',?)`);
  insImport.run('SHOPEEVN','VN001','PV','SHOPEEVN','SHOPEEVN',now);
  insImport.run('SHOPEEVN','VN002','PP','SHOPEEVN','SHOPEEVN',now);
  db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,latestEventTime,latestEventDesc,recipient_raw,recipient_group,podAttemptNo,currentAttemptNo,rawJson,createdAt,updatedAt) VALUES('SHOPEE','VN001','2026-07-29',0,'退回',?,'Returned','SHOPEEVN','VN',0,3,?, ?, ?)`).run(now,JSON.stringify({'退回状态':'已退回','Pending次数':3,'OC天数':1}),now,now);
  db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,latestEventTime,latestEventDesc,recipient_raw,recipient_group,podAttemptNo,currentAttemptNo,rawJson,createdAt,updatedAt) VALUES('SHOPEE','VN002','2026-07-29',1,'POD闭环',?,'POD','SHOPEEVN','VN',2,2,?, ?, ?)`).run(now,JSON.stringify({'Pending次数':1,'OC天数':0}),now,now);
  db.prepare(`INSERT INTO carryover_open_items(shipmentCode,businessType,sourceReportDate,lastReportDate,sourceSnapshotId,lastSnapshotId,status,apiStatus,closeReason,stateJson,createdAt,updatedAt) VALUES('VN001','SHOPEEVN','2026-07-27','2026-07-29','s0','s1','OPEN','OK','',?, ?, ?)`).run(JSON.stringify({lastEventTime:'2026-07-28T10:00:00+07:00',lastEventDesc:'Old node'}),now,now);
  db.prepare(`INSERT INTO shipment_current_state(shipmentCode,businessType,reportDate,snapshotId,state,apiStatus,lastEventTime,stateJson,updatedAt) VALUES('VN001','SHOPEEVN','2026-07-29','s1','RETURN_IN_PROGRESS','OK','2026-07-29T12:00:00+07:00',?,?)`).run(JSON.stringify({lastEventTime:'2026-07-29T12:00:00+07:00',lastEventDesc:'New node',primaryCategory:'退回处理中'}),now);
}

seed();

test('lazy SHOPEE returned detail reads exact rows from normalized SQLite',()=>{
  const req={query:{businessType:'SHOPEEVN',from:'2026-07-29',to:'2026-07-29',tab:'returned',page:'1',pageSize:'200'}};
  const res=responseStub();
  v27MetricDetailHandler(req,res);
  assert.equal(res.statusCode,200);
  assert.equal(res.body.ok,true);
  assert.equal(res.body.total,1);
  assert.equal(res.body.rows[0].shipmentCode,'VN001');
});

test('lazy SHOPEE second-attempt detail reads POD attempt column',()=>{
  const req={query:{businessType:'SHOPEEVN',from:'2026-07-29',to:'2026-07-29',tab:'all',attempt:'2',page:'1',pageSize:'200'}};
  const res=responseStub();
  v27MetricDetailHandler(req,res);
  assert.equal(res.statusCode,200);
  assert.equal(res.body.total,1);
  assert.equal(res.body.rows[0].shipmentCode,'VN002');
});

test('carry monitor detects a newer node without loading whole history',()=>{
  const req={query:{status:'OPEN',limit:'50'}};
  const res=responseStub();
  v27CarryMonitorHandler(req,res);
  assert.equal(res.statusCode,200);
  assert.equal(res.body.summary.total,1);
  assert.equal(res.body.summary.newNode,1);
  assert.equal(res.body.rows[0].shipmentCode,'VN001');
  assert.equal(res.body.rows[0].hasNewNode,true);
});

test.after(()=>{closeDb();fs.rmSync(temp,{recursive:true,force:true});});
