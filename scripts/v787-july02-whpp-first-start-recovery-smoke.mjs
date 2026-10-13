import assert from 'node:assert/strict';
import fs from 'node:fs';
const ui=fs.readFileSync(new URL('../public/v625-shell.js',import.meta.url),'utf8');
const persistent=fs.readFileSync(new URL('../src/selectedDatePersistentTruth.js',import.meta.url),'utf8');
const start=ui.indexOf('function v787WhppRecoveryAction(');
const end=ui.indexOf('async function v787WhppRecoveryProof(',start);
assert.ok(start>=0&&end>start,'exact WHPP recovery source must be present');
const action=new Function(ui.slice(start,end)+'\nreturn v787WhppRecoveryAction;')();
const day='2026-07-02',snapshot='SNAP-whpp-156-fixture';
const make=(scan,final,other={})=>({
 reportDate:day,snapshotId:snapshot,
 whppCompletion:{
   locked:false,reason:'WHPP_SCAN_FINAL_EVIDENCE_MISSING',
   canonicalTotal:156,canonicalResolved:156,membershipMatches:true,
   terminalEvidenceCoverage:{sourceCount:0,scanRows:scan,finalRows:final,podRows:0,returnedRows:0},
   ...other
 }
});
const unprocessed=action(make(0,0),day,snapshot);
assert.deepEqual(unprocessed,{action:'START',total:156,scanned:0,finalized:0},
 '7/2 daily 156 WHPP members and 0 scan/final must START; unified WHPP source 0 is not a skip');
assert.equal(action(make(60,40),day,snapshot).action,'RESUME','partial saved evidence resumes, no from-zero rerun');
assert.equal(action(make(156,155),day,snapshot).action,'RESUME','missing one final is not finished');
assert.equal(action(make(156,156,{locked:true,processingEvidenceVerified:true}),day,snapshot).action,'DONE',
 'all members processed, customer POD still pending is valid processing completion');
assert.equal(action(make(0,0,{locked:true,unifiedWhppCompleted:true}),day,snapshot).action,'START',
 'old unified 3/3 can never skip an unprocessed 156 WHPP independent source');
assert.throws(()=>action(make(0,0),'2026-07-03',snapshot),/日期|快照/);
assert.throws(()=>action(make(0,0),day,'wrong-snapshot'),/日期|快照/);
assert.throws(()=>action(make(157,0),day,snapshot),/超过/);
assert.throws(()=>action(make(0,0,{canonicalResolved:155}),day,snapshot),/未完整识别/);
assert.match(ui,/if\(Number\(counts\.WHPP\|\|0\)>0\)\{\s*appendLiveLog\('检查独立WHPP来源及扫描\/最终记录证据'/,
  'Resume path never trusts a previous familyComplete projection');
assert.doesNotMatch(ui,/code==='WHPP_REPORT_MISSING'&&countTruth&&Number\(countTruth\.counts\?\.WHPP\|\|0\)===0/,
  'Missing normalized WHPP source must not be swallowed by unified WHPP=0');
assert.match(persistent,/WHPP_SCAN_FINAL_EVIDENCE_MISSING/,'processing missing distinguished from POD terminal gap');
console.log('[V787 WHPP 156 RECOVERY] true source 156, scan0/final0 START; partial RESUME; exact scanned DONE; stale 3/3 no skip; date+snapshot guard PASS');
