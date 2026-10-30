import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src=fs.readFileSync('src/selectedDatePersistentTruth.js','utf8');
const start=src.indexOf('export function persistentWhppCompletionTruth(');
assert.ok(start>0,'WHPP historical proof exists');
const body=src.slice(start).replace(/^export function persistentWhppCompletionTruth/,'function persistentWhppCompletionTruth');
assert.match(body,/const canonicalFast=loadWhppCanonicalTruth/,'immutable WHPP receipt must be checked against real independent members');
assert.match(body,/rows\.every\(row=>row\?\.truthEvidence\?\.scan===true&&row\?\.truthEvidence\?\.final===true\)/);
assert.match(body,/const unifiedWhppCompleted=unifiedCompleted&&unifiedChildStatus==='COMPLETED'&&unifiedWhppSnapshotVerified/,
  'persisted WHPP child validation remains a prerequisite');
assert.match(body,/&&Number\(canonical\?\.evidence\?\.scanRows\|\|0\)===canonicalTotal/,
  'slow path must never transform a valid child receipt into a fake scan count');

function fixture({total,scans=0,finals=0,pod=0,returned=0,imported=0}){
  const rows=Array.from({length:total},(_,i)=>{
    const scan=i<scans,final=i<finals;
    const isPod=i<pod,isReturn=i>=pod&&i<pod+returned;
    return{shipmentCode:'WHPP-'+String(i+1).padStart(5,'0'),
      apiStatus:'SUCCESS',
      truthEvidence:{scan,final,pod:isPod,returned:isReturn}};
  });
  const canonical={total,rows,evidence:{
    scanRows:scans,finalRows:finals,podRows:pod,returnedRows:returned
  }};
  const batch={snapshotId:'SNAP-JUL12',batchId:'BATCH-JUL12',reportDate:'2026-07-12'};
  const unified={status:'COMPLETED',payloadJson:JSON.stringify({
    parentRun:{children:{WHPP:{status:'COMPLETED'}}},
    sourceSnapshots:{WHPP:'WHPP-CHILD-JUL12'}}),createdAt:'2026-07-12T23:00:00+07:00'};
  const db={
    prepare(sql){
      return{get(){
        if(sql.includes('FROM unified_snapshots'))return unified;
        if(sql.includes('FROM business_export_snapshots'))return{
          snapshotId:'WHPP-CHILD-JUL12',generatedAt:'2026-07-12T23:00:00+07:00',ok:1};
        if(sql.includes('FROM unified_import_rows'))return{count:imported};
        if(sql.includes('FROM business_final_rows'))return{count:finals};
        if(sql.includes('FROM business_daily_reports'))return null;
        if(sql.includes('FROM business_history_summary'))return null;
        throw Error('Unexpected SQL: '+sql);
      }};
    }
  };
  const context={
    Date,Number,String,Array,Boolean,Math,
    dateKey:v=>String(v||'').slice(0,10),
    latestValidBatch:()=>batch,
    safeJson:(v,fallback={})=>{try{return typeof v==='string'?JSON.parse(v):v||fallback}catch{return fallback}},
    loadWhppCanonicalTruth:()=>canonical
  };
  const run=vm.runInNewContext('('+body+')',context);
  return run(db,'2026-07-12');
}
const missing=fixture({total:103,scans:0,finals:0,imported:0});
assert.equal(missing.locked,false,'a completed child snapshot cannot fabricate 103 scans/103 final rows');
assert.equal(missing.canonicalTotal,103,'independent members must not be displayed as zero');
assert.equal(missing.missingScans,103);
assert.equal(missing.missingFinals,103);
assert.equal(missing.reason,'WHPP_SCAN_FINAL_EVIDENCE_MISSING');

const partial=fixture({total:103,scans:103,finals:80,imported:0});
assert.equal(partial.locked,false,'103/103 scans with 80/103 final rows is not completed');
assert.equal(partial.missingFinals,23);

const trueFinal=fixture({total:190,scans:190,finals:190,pod:166,returned:24,imported:0});
assert.equal(trueFinal.locked,true,'190/190 scanned and finalized with exact immutable child may complete');
assert.equal(trueFinal.canonicalTotal,190);
assert.equal(trueFinal.finalCount,190);
assert.equal(trueFinal.sourceCount,0,'unified imported WHPP count remains independent from daily 190');
assert.equal(trueFinal.terminalEvidenceVerified,true);
assert.equal(trueFinal.terminalEvidenceCoverage.podRows,166);
assert.equal(trueFinal.terminalEvidenceCoverage.returnedRows,24);
assert.equal(trueFinal.terminalEvidenceCoverage.unverifiedRows,0);

const unresolved=fixture({total:190,scans:190,finals:190,pod:166,returned:22,imported:0});
assert.equal(unresolved.locked,true,'processing completion may be true even with pending customer terminals');
assert.equal(unresolved.terminalEvidenceVerified,false);
assert.equal(unresolved.terminalEvidenceCoverage.unverifiedRows,2);
assert.equal(unresolved.terminalEvidenceGaps.length,2);

const mismatched=fixture({total:102,scans:102,finals:102,pod:102,imported:103});
assert.equal(mismatched.locked,false,'snapshot cannot override 103 imported source members with 102 processed');

console.log('[V798] 5 isolated WHPP proof scenarios PASS: July12 0/103, partial, July1 166+24, two-open, mismatched source');
