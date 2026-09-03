import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ensureV246TrackingSchema } from '../src/v246TrackingLedgerCore.js';
import { applyV419CanonicalExportLedgerTruth } from '../src/v419CanonicalExportLedgerTruth.js';

const NOW='2026-09-03T00:00:00Z';
function fixture(){const db=new DatabaseSync(':memory:');ensureV246TrackingSchema(db);return db;}
function insertLedger(db,{bill,type,status='TERMINAL',reason='POD',state='POD',category='POD',podDate='2026-08-03',attemptNo=0,attemptSource='',signingDays=null,evidenceJson='{}',stateJson='{}'}){
  db.prepare(`INSERT INTO qc_tracking_ledger(
    shipmentCode,businessType,firstReportDate,lastImportedDate,sourceSnapshotId,lastSnapshotId,trackingStatus,terminalReason,terminalAt,
    currentState,currentCategory,lastEventTime,podDate,attemptNo,attemptSource,signingDays,evidenceJson,currentStateJson,lastCheckedAt,lastRepairReason,createdAt,updatedAt
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    bill,type,'2026-08-01','2026-08-04','S1','S4',status,reason,NOW,state,category,'',podDate,attemptNo,attemptSource,signingDays,evidenceJson,stateJson,NOW,'fixture',NOW,NOW
  );
}

test('WHPP export takes POD and attempt truth from V246 ledger and clears stale signing values when ledger has no signing proof',()=>{
  const db=fixture();try{
    insertLedger(db,{bill:'WHPP-EXPORT-1',type:'WHPP',attemptNo:2,attemptSource:'V246_STRICT_TRACK:START_FAILURE_CYCLE',podDate:'2026-08-03',evidenceJson:JSON.stringify({starts:[{time:'2026-08-02T08:00:00Z'}]})});
    const rows=[{shipmentCode:'WHPP-EXPORT-1',businessType:'WHPP',pod:false,returned:true,pending:true,delivering:true,statusCode:'R',statusDesc:'RETURNED',podDate:'2026-08-09',podTime:'2026-08-09T10:00:00Z',attemptNo:3,podAttemptNo:3,currentAttemptNo:3,signingDays:9,deliveryDays:9,evidence:new Set()}];
    applyV419CanonicalExportLedgerTruth('WHPP',rows,{db});
    const row=rows[0];
    assert.equal(row.pod,true);assert.equal(row.returned,false);assert.equal(row.pending,false);assert.equal(row.delivering,false);
    assert.equal(row.statusCode,'Y');assert.equal(row.statusDesc,'POD');assert.equal(row.podDate,'2026-08-03');assert.equal(row.podTime,'2026-08-03');
    assert.equal(row.attemptNo,2);assert.equal(row.podAttemptNo,2);assert.equal(row.currentAttemptNo,2);assert.equal(row.attemptSource,'V246_STRICT_TRACK:START_FAILURE_CYCLE');
    assert.equal(row.signingDays,0);assert.equal(row.deliveryDays,0,'stale legacy signing cannot survive when WHPP ledger has no signingDays proof');
    assert.equal(row.v419CanonicalExportTruthId,'2026-09-03-v419-canonical-export-ledger-truth-v2');
  }finally{db.close();}
});

test('Shopee strict V246 attempt overrides later legacy track counter and strict signing uses saved START evidence',()=>{
  const db=fixture();try{
    insertLedger(db,{bill:'SPE-EXPORT-2',type:'SHOPEEVN',attemptNo:2,attemptSource:'V246_STRICT_TRACK:START_FAILURE_CYCLE',podDate:'2026-08-03',evidenceJson:JSON.stringify({starts:[{time:'2026-08-02T08:00:00Z'},{time:'2026-08-03T07:00:00Z'}]})});
    const rows=[{shipmentCode:'SPE-EXPORT-2',businessType:'SHOPEEVN',pod:true,returned:false,attemptNo:3,trackAttemptNo:3,podAttemptNo:3,currentAttemptNo:3,signingDays:5,deliveryDays:5,evidence:new Set()}];
    applyV419CanonicalExportLedgerTruth('SHOPEEVN',rows,{db});
    const row=rows[0];
    assert.equal(row.attemptNo,2);assert.equal(row.trackAttemptNo,2);assert.equal(row.podAttemptNo,2);assert.equal(row.currentAttemptNo,2);
    assert.equal(row.signingDays,2);assert.equal(row.deliveryDays,2);assert.equal(row.signingDaysSource,'V246严格START→POD');
  }finally{db.close();}
});

test('OPEN/RETURNED ledger clears every stale POD-derived field, not only the visible status flag',()=>{
  const db=fixture();try{
    insertLedger(db,{bill:'TBKH-OPEN',type:'TBKH',status:'OPEN',reason:'',state:'OC',category:'OC',podDate:'',stateJson:JSON.stringify({OC天数:2})});
    insertLedger(db,{bill:'CE-RETURNED',type:'CE',reason:'RETURNED',state:'RETURNED',category:'退回',podDate:''});
    const stale={pod:true,returned:false,pending:false,delivering:false,statusCode:'Y',statusDesc:'POD',podDate:'2026-08-03',podTime:'2026-08-03T08:00:00Z',podSource:'OLD_POD',podPriority:1,attemptNo:3,trackAttemptNo:3,podAttemptNo:3,currentAttemptNo:3,attemptSource:'OLD_ATTEMPT',attemptEvidenceComplete:true,signingDays:9,deliveryDays:9,signingDaysSource:'OLD_SIGNING',deliveryDaysSource:'OLD_SIGNING',dispatchSigningEvidenceComplete:true,signingEvidenceComplete:true,cancelled:true};
    const open={shipmentCode:'TBKH-OPEN',...stale};
    const returned={shipmentCode:'CE-RETURNED',...stale,pending:true,delivering:true};
    applyV419CanonicalExportLedgerTruth('TBKH',[open],{db});
    applyV419CanonicalExportLedgerTruth('CE',[returned],{db});
    for(const row of [open,returned]){
      assert.equal(row.pod,false);assert.equal(row.podDate,'');assert.equal(row.podTime,'');assert.equal(row.podSource,'');
      assert.equal(row.attemptNo,0);assert.equal(row.trackAttemptNo,0);assert.equal(row.podAttemptNo,0);assert.equal(row.currentAttemptNo,0);assert.equal(row.attemptSource,'');assert.equal(row.attemptEvidenceComplete,false);
      assert.equal(row.signingDays,0);assert.equal(row.deliveryDays,0);assert.equal(row.signingDaysSource,'');assert.equal(row.deliveryDaysSource,'');assert.equal(row.signingEvidenceComplete,false);assert.equal(row.dispatchSigningEvidenceComplete,false);
      assert.equal(row.cancelled,false);
    }
    assert.equal(open.returned,false);assert.equal(open.statusDesc,'OC');
    assert.equal(returned.returned,true);assert.equal(returned.pending,false);assert.equal(returned.delivering,false);assert.equal(returned.statusCode,'R');assert.equal(returned.statusDesc,'RETURNED');
  }finally{db.close();}
});

test('V225 export pipeline applies V419 canonical ledger after all legacy evidence calculators',()=>{
  const source=fs.readFileSync(new URL('../src/v225ExportReturnTruth.js',import.meta.url),'utf8');
  const v230=source.indexOf('applyV230AttemptSigningTruth(businessType,rows)');
  const v381=source.indexOf('applyV381LedgerExportTruth(businessType,rows');
  const v320=source.indexOf('applyV320DispatchSigningTruth(businessType,rows');
  const v329=source.indexOf('applyV329FirstReportSigning(businessType,rows');
  const v419=source.indexOf('applyV419CanonicalExportLedgerTruth(businessType,rows');
  assert.ok(v230>=0&&v381>v230&&v320>v381&&v329>v320&&v419>v329,'V419 ledger truth must be the final export authority');
  assert.match(source,/V419_CANONICAL_EXPORT_LEDGER_TRUTH_ID/);
});