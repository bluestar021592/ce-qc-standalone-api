import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {auditV788WhppLiveTms} from '../src/v788WhppLiveTmsReadonly.js';

const members=[],evidence=new Map(),batches=[];
for(let i=0;i<346;i++){
  const date=i<190?'2026-07-01':'2026-07-02';
  const local=i<190?i:i-190, pod=local<(i<190?166:124);
  const code='CE'+String(i+1).padStart(9,'0');
  const state=pod?'POD':'RETURNED';
  members.push({reportDate:date,shipmentCode:code,currentState:state,ledgerStatus:'OPEN',
    currentEvidenceRows:1,ledgerEvidenceRows:1});
  evidence.set(code,{shipmentCode:code,shipmentStatus:pod?'60':'81'});
}
const query=async codes=>{
  assert.ok(codes.length<=25,'batch is safely bounded');
  batches.push(codes.length);
  return codes.map(c=>evidence.get(c));
};
const full=await auditV788WhppLiveTms({members,query});
assert.equal(full.outcome,'TERMINAL_EVIDENCE_REVIEW_READY');
assert.equal(full.terminalEvidenceReviewReady,true);
assert.equal(full.dates['2026-07-01'].sourceMembers,190);
assert.equal(full.dates['2026-07-01'].matchedPOD,166);
assert.equal(full.dates['2026-07-01'].matchedReturned,24);
assert.equal(full.dates['2026-07-02'].sourceMembers,156);
assert.equal(full.dates['2026-07-02'].matchedPOD,124);
assert.equal(full.dates['2026-07-02'].matchedReturned,32);
assert.equal(full.summary.queriedBills,346);
assert.equal(full.summary.completedBatches,14);
assert.equal(full.summary.terminalMatches,346);
assert.equal(full.dates['2026-07-01'].openLedgerTerminal,190);
assert.equal(full.dates['2026-07-02'].openLedgerTerminal,156);
assert.equal(full.readyToClearAndReimport,false,'verified terminal never authorizes purge');
assert.equal(full.readyToPublish,false);
assert.equal(full.signingTimeVerified,false,'status 60 cannot fabricate POD time');
assert.equal(full.releaseDecision,'BLOCKED');
assert.ok(batches.every(n=>n>0&&n<=25));
assert.doesNotMatch(JSON.stringify(full),/CE000000001/,'no customer waybill in summary');

const copy=(obj)=>JSON.parse(JSON.stringify(obj));
const withOverrides=async ({modifyEvidence,modifyMembers,queryOverride}={})=>{
  const rows=copy(members),live=new Map([...evidence].map(([k,v])=>[k,{...v}]));
  if(modifyMembers)modifyMembers(rows);
  if(modifyEvidence)modifyEvidence(live,rows);
  let called=0;
  const result=await auditV788WhppLiveTms({members:rows,query:async codes=>{
    called++;
    return queryOverride?queryOverride(codes,live):codes.map(c=>live.get(c));
  }});
  return {result,called};
};
const return80=await withOverrides({modifyEvidence:(live,rows)=>{
  const returned=rows.find(x=>x.currentState==='RETURNED');
  live.set(returned.shipmentCode,{shipmentCode:returned.shipmentCode,shipmentStatus:'80'});
}});
assert.equal(return80.result.outcome,'TERMINAL_EVIDENCE_INCOMPLETE');
assert.equal(return80.result.dates['2026-07-01'].returnedLabelStillReturning,1);
assert.equal(return80.result.summary.recognized80,1);
const contradicted=await withOverrides({modifyEvidence:(live,rows)=>{
  const pod=rows.find(x=>x.currentState==='POD');
  live.set(pod.shipmentCode,{shipmentCode:pod.shipmentCode,shipmentStatus:'81'});
}});
assert.equal(contradicted.result.outcome,'TERMINAL_EVIDENCE_INCOMPLETE');
assert.equal(contradicted.result.dates['2026-07-01'].terminalConflict,1);
const noCode=await withOverrides({modifyEvidence:(live,rows)=>{
  const pod=rows.find(x=>x.currentState==='POD');
  live.set(pod.shipmentCode,{shipmentCode:pod.shipmentCode,eventCode:'80',
    orderStatus:'85',statusText:'已签收'});
}});
assert.equal(noCode.result.dates['2026-07-01'].matchedPOD,165,
  'trajectory eventCode80 and scan orderStatus85 cannot stand in for shipmentStatus60');
const duplicated=await withOverrides({queryOverride:(codes,live)=>
  [...codes.map(c=>live.get(c)),{...live.get(codes[0])}]
});
assert.equal(duplicated.result.outcome,'TERMINAL_EVIDENCE_INCOMPLETE');
assert.ok(duplicated.result.summary.duplicateResponseBills>0);
const mismatch=await withOverrides({modifyMembers:(rows)=>rows.pop()});
assert.equal(mismatch.result.outcome,'SOURCE_MEMBERSHIP_CHANGED');
assert.equal(mismatch.called,0,'unexpected source totals must block before external request');
const ambiguous=await withOverrides({modifyMembers:(rows)=>{rows[0].currentEvidenceRows=2}});
assert.equal(ambiguous.result.outcome,'AMBIGUOUS_LOCAL_EVIDENCE');
assert.equal(ambiguous.called,0);
const crossDate=await withOverrides({modifyMembers:(rows)=>{rows[190].shipmentCode=rows[0].shipmentCode}});
assert.equal(crossDate.result.outcome,'CROSS_DATE_DUPLICATE_WAYBILL');
assert.equal(crossDate.called,0);
const error=await withOverrides({queryOverride:()=>{const e=new Error('SECRET TOKEN AND WAYBILL');e.ceStatus=401;throw e;}});
assert.equal(error.result.outcome,'TMS_AUTH_REQUIRED');
assert.doesNotMatch(JSON.stringify(error.result),/SECRET|TOKEN AND WAYBILL/);
const missing=await withOverrides({queryOverride:(codes,live)=>codes.slice(1).map(c=>live.get(c))});
assert.equal(missing.result.outcome,'TERMINAL_EVIDENCE_INCOMPLETE');
assert.ok(missing.result.summary.missingResponseBills>0);
const foreign=await withOverrides({queryOverride:(codes,live)=>[
  ...codes.map(c=>live.get(c)),{shipmentCode:'FOREIGN999',shipmentStatus:'60'}
]});
assert.equal(foreign.result.summary.returnedRecordsOutOfScope,14);
assert.equal(foreign.result.readyToPublish,false);

const source=fs.readFileSync('scripts/v788-whpp-live-tms-readonly.mjs','utf8');
assert.match(source,/--live-tms-readonly/,'network query must require explicit opt-in');
assert.match(source,/getRuntimeConfig|loadTokenSync/,'reuses CE login without asking for secrets');
assert.match(source,/maxRedirects:0/);
assert.doesNotMatch(source,/saveToken|refreshTokenIfNeeded|clearToken|writeFile|unlink|\bDELETE\b|\bUPDATE\b|data-purge|method:\s*['"]DELETE/);
const cli=spawnSync(process.execPath,['scripts/v788-whpp-live-tms-readonly.mjs'],
  {cwd:process.cwd(),encoding:'utf8',timeout:10000});
assert.equal(cli.status,10,'CLI always denied as release signal');
assert.match(cli.stdout,/只读检查/);
assert.doesNotMatch(cli.stdout,/CE000000001|TOKEN AND WAYBILL/);
console.log('[V788 LIVE TMS READONLY] WHPP 190+156, POD 166+124, returned 24+32, 14 bounded batches, auth and duplicates fail closed, zero writes or release PASS');
