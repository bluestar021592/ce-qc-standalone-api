// V788 on-demand isolated acceptance: independent proof and legacy audit.
// ADMIN-triggered worker only. No TMS HTTP calls, generated files or DB writes.
// Fail closed, never leak waybills / credentials / local paths.
import fs from 'node:fs';
import {getRuntimeConfig} from '../src/db.js';
import {findV788ExistingWhppExport} from './v788-find-existing-whpp-export.mjs';
import {readV788ExistingWhppXlsx} from './v788-existing-whpp-xlsx-readback.mjs';
import {DatabaseSync} from 'node:sqlite';
import {parentPort} from 'node:worker_threads';
import {auditDatabaseFile} from './v788-whpp-real-readonly-audit.mjs';
import {buildV788AcceptanceVerdict} from './v788-real-acceptance-verdict.mjs';
import {DEFAULT_COPY,validateIsolatedCopy} from './v788-run-isolated-readonly-acceptance.mjs';
import {v788ReadSourceMembershipSignature,verifyV788PersistedSidecar}
  from './v788-whpp-tms-evidence-sidecar.mjs';
import {summarizeV788WhppPodTimeSources}
  from './v788-whpp-pod-time-source-inventory.mjs';
import {presentV788AuditGates} from '../src/v788AuditGateMessages.js';

const PROOF_FILE=String.raw`D:\CE_QC_V788_验收副本\V788_WHPP_TMS_逐票证据.sqlite`;
function fingerprint(file){
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<=0)
    throw Error('ISOLATED_FILE_UNSAFE');
  if(fs.realpathSync.native(file).toLowerCase()!==file.toLowerCase())
    throw Error('ISOLATED_FILE_REDIRECTED');
  return [stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join('|');
}
const gate=(id,status,detail)=>({id,status,detail});
function inspectStoredTms(file,expectedSourceFingerprint){
  const exists=fs.existsSync(PROOF_FILE);
  if(!exists)return {
    independentTmsStatus:'BLOCK',
    proofReady:false,
    independentTmsGate:gate('WHPP_INDEPENDENT_TMS_346','BLOCK',{
      reason:'ISOLATED_SIDECAR_NOT_FOUND',expectedMembers:346}),
    proofFileFingerprint:null
  };
  let sourceDb,proofDb;
  const proofFileFingerprint=fingerprint(PROOF_FILE);
  try{
    sourceDb=new DatabaseSync(file,{readOnly:true});
    sourceDb.exec('PRAGMA query_only=ON');
    proofDb=new DatabaseSync(PROOF_FILE,{readOnly:true});
    proofDb.exec('PRAGMA query_only=ON');
    const signature=v788ReadSourceMembershipSignature(sourceDb);
    const proof=verifyV788PersistedSidecar(proofDb,signature);
    if(proof.verified!==true)return {
      independentTmsStatus:'BLOCK',proofReady:false,proofFileFingerprint,
      independentTmsGate:gate('WHPP_INDEPENDENT_TMS_346','BLOCK',{
        reason:String(proof.reason||'EVIDENCE_NOT_VERIFIED').slice(0,60),
        expectedMembers:346,independentlySavedMembers:Number(proof.storedMembers||0)})
    };
    let podTimeInventory={available:false,reason:'TIME_INVENTORY_UNAVAILABLE'};
    try{
      const candidate=summarizeV788WhppPodTimeSources(sourceDb,proofDb,signature);
      if(candidate?.available===true){
        podTimeInventory={
          available:true,podMembers:Number(candidate.podMembers||0),
          timeCandidateMembers:Number(candidate.timeCandidateMembers||0),
          unambiguousTimeCandidateMembers:Number(candidate.unambiguousTimeCandidateMembers||0),
          missingTimeMembers:Number(candidate.missingTimeMembers||0),
          manualReviewMembers:Number(candidate.manualReviewMembers||0)
        };
      }
    }catch{}
    return {
      independentTmsStatus:'PASS',proofReady:true,proofFileFingerprint,
      independentTmsGate:gate('WHPP_INDEPENDENT_TMS_346','PASS',{
        independentlySavedMembers:Number(proof.storedMembers||0),
        batches:Number(proof.batches||0),exactMemberSetMatches:true,
        pod:290,returned:56,
        directTmsTimeCandidates:Number(proof.trustedExplicitPodTimes||0),
        directTmsTimeMissing:Number(proof.missingTrustedExplicitPodTimes||0),
        statusOnly:true,signingTimeAccepted:false,ledgerAccepted:false,exportAccepted:false
      }),
      podTimeInventory
    };
  }finally{
    try{proofDb?.close()}catch{}
    try{sourceDb?.close()}catch{}
    if(fingerprint(file)!==expectedSourceFingerprint)
      throw Error('ISOLATED_SOURCE_CHANGED_DURING_PROOF_CHECK');
    if(fingerprint(PROOF_FILE)!==proofFileFingerprint)
      throw Error('ISOLATED_PROOF_CHANGED_DURING_CHECK');
  }
}
async function run(){
  if(process.platform!=='win32')throw Error('WINDOWS_ISOLATION_REQUIRED');
  const file=validateIsolatedCopy(DEFAULT_COPY);
  const before=fingerprint(file);
  let independent;
  try{independent=inspectStoredTms(file,before)}
  catch{
    independent={independentTmsStatus:'BLOCK',proofReady:false,
      independentTmsGate:gate('WHPP_INDEPENDENT_TMS_346','BLOCK',{
        reason:'ISOLATED_SIDECAR_PROOF_UNAVAILABLE'})};
  }
  let audit=null,verdict=null;
  try{
    audit=auditDatabaseFile(file);
    verdict=buildV788AcceptanceVerdict(audit);
  }catch{
    // A historical source table might not be migrated yet. It must not
    // conceal already attested independent TMS proof, or mark it accepted.
  }
  if(fingerprint(file)!==before)
    throw Error('ISOLATED_SOURCE_CHANGED_DURING_AUDIT');
  if(independent.proofFileFingerprint
      &&fingerprint(PROOF_FILE)!==independent.proofFileFingerprint)
    throw Error('ISOLATED_PROOF_CHANGED_DURING_AUDIT');
  const gates=verdict?.gates?.map(g=>({id:g.id,status:g.status,detail:g.detail}))||[
    gate('ISOLATED_DATABASE_AUDIT','BLOCK',{
      reason:'LEGACY_SOURCE_TABLES_OR_SCHEMA_UNAVAILABLE'})
  ];
  gates.push(independent.independentTmsGate);
  // Read already generated WHPP XLSX straight from the configured exports
  // directory; never export, regenerate, overwrite or upload a workbook.
  // This independent check is limited to WHPP 7/1 + 7/2, not seven-business
  // Excel acceptance. No path or waybill is exposed to the browser.
  const exportsConfig=getRuntimeConfig();
  let readback={status:'NOT_CHECKED',reason:'SOURCE_TMS_PROOF_NOT_READY'};
  if(independent.proofReady===true&&!exportsConfig.usingFallbackDataDir){
    const match=findV788ExistingWhppExport(exportsConfig.exportsDir);
    if(match.status==='FOUND'){
      let sourceDb,proofDb;
      try{
        sourceDb=new DatabaseSync(file,{readOnly:true});
        sourceDb.exec('PRAGMA query_only=ON');
        proofDb=new DatabaseSync(PROOF_FILE,{readOnly:true});
        proofDb.exec('PRAGMA query_only=ON');
        const checked=await readV788ExistingWhppXlsx({
          sourceDb,proofDb,workbookPath:match.file
        });
        readback={status:checked.status,rows:Number(checked.readbackRows||0),
          pod:Number(checked.readbackPodRows||0),
          returned:Number(checked.readbackReturnedRows||0),
          issues:checked.issues};
      }catch{
        readback={status:'BLOCKED',reason:'EXPORT_READBACK_FAILED'};
      }finally{
        try{sourceDb?.close()}catch{}
        try{proofDb?.close()}catch{}
      }
    }else readback={status:match.status,reason:match.reason};
  }else if(exportsConfig.usingFallbackDataDir){
    readback={status:'NOT_CHECKED',reason:'PRIMARY_EXPORT_STORAGE_UNAVAILABLE'};
  }
  const exportGateStatus=readback.status==='XLSX_CONTENT_VERIFIED'?'PASS':
    readback.status==='NOT_FOUND'||readback.status==='NOT_CHECKED'?'REVIEW':'BLOCK';
  gates.push(gate('WHPP_EXISTING_REAL_XLSX',exportGateStatus,{
    status:readback.status,reason:readback.reason||'',
    rows:readback.rows??null,pod:readback.pod??null,
    returned:readback.returned??null,
    issues:readback.issues||null
  }));
  const counts={
    passed:gates.filter(g=>g.status==='PASS').length,
    blocked:gates.filter(g=>g.status==='BLOCK').length,
    reviewing:gates.filter(g=>g.status==='REVIEW').length,total:gates.length
  };
  const status=counts.blocked?'BLOCKED':counts.reviewing?'NEEDS_REAL_EVIDENCE':'READY_FOR_REVIEW';
  const totals=audit?.whpp?.totals||{};
  return {
    ok:true,status,readOnly:true,
    readyToPublish:false,readyToClearAndReimport:false,
    productionModified:false,sourceCopyModified:false,
    auditSchemaAvailable:!!verdict,
    independentTmsStatus:independent.independentTmsStatus,
    independentTmsProofReady:independent.proofReady,
    podTimeInventory:independent.podTimeInventory||null,
    existingWhppExcel:{status:readback.status,rows:readback.rows??null,
      pod:readback.pod??null,returned:readback.returned??null},
    counts,
    members:Number(totals.sourceMembers||0),
    normalizedPOD:Number(totals.normalizedPOD||0),
    normalizedReturned:Number(totals.normalizedReturned||0),
    ledgerOpenWithNormalizedTerminal:Number(totals.ledgerOpenWithNormalizedTerminal||0),
    trustedPodLockOnPOD:Number(totals.trustedPodLockOnPOD||0),
    gates:presentV788AuditGates(gates)
  };
}
run().then(result=>{
  parentPort?.postMessage(result);
}).catch(()=>{
  parentPort?.postMessage({
    ok:false,status:'BLOCKED',code:'ISOLATED_AUDIT_UNAVAILABLE',
    readOnly:true,readyToPublish:false,productionModified:false
  });
});
