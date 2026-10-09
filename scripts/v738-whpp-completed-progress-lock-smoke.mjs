import assert from 'node:assert/strict';
import fs from 'node:fs';

const truth=fs.readFileSync('src/selectedDatePersistentTruth.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(truth,/unifiedWhppSnapshotVerified/,'WHPP completion must verify an actual persisted WHPP child snapshot');
assert.match(truth,/businessType='WHPP' AND reportDate=\? AND snapshotId=\?/,'WHPP unified fast path must bind the exact selected-date child snapshot');
assert.match(truth,/unifiedCompleted&&unifiedChildStatus==='COMPLETED'&&unifiedWhppSnapshotVerified/,'aggregate COMPLETED alone must not finalize WHPP');
assert.doesNotMatch(truth,/\|\|unifiedCompleted\s*\n?\s*\)/,'bare unified completion must never be accepted as WHPP completion proof');
assert.match(truth,/Number\(canonical\?\.evidence\?\.scanRows\|\|0\)===sourceCount/,'every WHPP source member requires an actual scan');
assert.match(truth,/Number\(canonical\?\.evidence\?\.finalRows\|\|0\)===sourceCount/,'every WHPP source member requires persisted final evidence');
assert.match(truth,/Boolean\(evidence\.pod\)!==Boolean\(evidence\.returned\)/,'WHPP terminal truth must be exclusive POD or returned');
assert.match(truth,/terminalEvidenceVerified/,'historical WHPP exact terminal evidence must be an observable completion owner');
assert.match(truth,/const locked=unifiedWhppCompleted\|\|terminalEvidenceVerified\|\|processingEvidenceVerified;/,'processing completion requires exact scan/final coverage, independent of POD/return');
assert.match(truth,/terminalEvidenceGaps:terminalEvidenceGaps\.slice\(0,50\)/,'read-only WHPP diagnostic must show exact unresolved members');
assert.match(shell,/v763WhppEvidenceGaps\.get\(date\+'\|'\+String\(v626LatestImport\?\.snapshotId\|\|''\)\)/,'live WHPP must show unresolved states independently of processing completion');

assert.match(shell,/const v738WhppCompletionLatch=new Set\(\)/,'browser completion latch missing');
assert.match(shell,/if\(v738WhppCompletionLatch\.has\(date\)&&!whppPayload\?\.completionLock\?\.locked\)/,'browser may retain only a previously verified WHPP completion lock');
assert.doesNotMatch(shell,/ccsl=projectComplete\(ccsl,'CCSL'\)/,'unified snapshot status must not fabricate CCSL completion');
assert.doesNotMatch(shell,/shopee=projectComplete\(shopee,'SHOPEE'\)/,'unified snapshot status must not fabricate SHOPEE completion');
assert.doesNotMatch(shell,/V752_UNIFIED_COMPLETED_3OF3/,'retired aggregate 3-of-3 projection must stay removed');
assert.match(shell,/v752TerminalProgressLogs/,'terminal progress logs must remain deduplicated across polling ticks');
assert.match(html,/v625-shell\.js\?v=\d{8}-v\d{3,}-1&patch=\d{3,}/,'current V625 shell must preserve an install-safe cache-busted script revision');


assert.match(shell,/function v759RememberWhppProof\(/,'WHPP exact selected-date proof owner must exist');
assert.match(shell,/snapshotId!==String\(v626LatestImport\?\.snapshotId\|\|''\)/,'completed proof may not cross snapshot identities');
assert.match(shell,/Number\(evidence\.scanRows\|\|0\)===total/,'WHPP progress fallback must require every member scanned');
assert.match(shell,/Number\(evidence\.podRows\|\|0\)\+Number\(evidence\.returnedRows\|\|0\)===total/,'WHPP progress fallback must conserve terminal categories');
assert.match(shell,/const pinnedProof=v759PinnedWhppProof\(date\)/,'live WHPP progress must reuse pinned exact-snapshot proof when progress API is stale');
assert.match(shell,/void v759VerifyWhppCompletionOnce\(date\)/,'WHPP terminal verification must not delay each board paint');
assert.match(shell,/if\(verified\|\|v763WhppEvidenceGaps\.has\(key\)\)void refreshLiveProgress\(\)/,'terminal evidence gaps must repaint immediately');
assert.match(shell,/phase:'终态核验中'/,'WHPP must not show completed until exact proof passes');
assert.match(shell,/v759VerifyWhppCompletionOnce\(v626LatestImport\?\.reportDate\|\|''\)/,'import page must automatically verify the selected date once, not on every progress poll');

const fnStart=shell.indexOf('function v759RememberWhppProof(');
const fnEnd=shell.indexOf('async function v759VerifyWhppCompletionOnce(');
assert.ok(fnStart>0&&fnEnd>fnStart,'WHPP proof helper boundaries missing');
const helpers=shell.slice(fnStart,fnEnd);
const harness=new Function('truth','current',`
 const v626LatestImport=current;
 const v759WhppCompletionProofs=new Map();
 ${helpers}
 const accepted=v759RememberWhppProof(truth,'2026-07-01');
 return {accepted,pinned:v759PinnedWhppProof('2026-07-01'),cacheSize:v759WhppCompletionProofs.size,
   gap:v763WhppEvidenceGaps.get('2026-07-01|JULY1-IMMUTABLE')||null};
`);
const real={
 reportDate:'2026-07-01',snapshotId:'JULY1-IMMUTABLE',
 whppCompletion:{
  locked:true,snapshotLocked:true,membershipMatches:true,canonicalTotal:190,
  canonicalResolved:190,finalCount:190,completionSource:'IMMUTABLE_EXPORT_SNAPSHOT',
  terminalEvidenceCoverage:{scanRows:190,finalRows:190,podRows:166,returnedRows:24}
 }
};
const context={reportDate:'2026-07-01',snapshotId:'JULY1-IMMUTABLE'};
const ok=harness(real,context);
assert.equal(ok.accepted,true,'real July-1 evidence must recover 3/3 even when sourceCount is zero');
assert.equal(ok.pinned?.locked,true,'recovered exact-snapshot proof must remain available');
assert.equal(harness({...real,snapshotId:'OTHER-SNAPSHOT'},context).accepted,false,'other snapshot must never complete this date');
assert.equal(harness({...real,whppCompletion:{...real.whppCompletion,terminalEvidenceCoverage:{...real.whppCompletion.terminalEvidenceCoverage,scanRows:189}}},context).accepted,false,'189/190 scanned cannot finish WHPP');
assert.equal(harness({...real,whppCompletion:{...real.whppCompletion,terminalEvidenceCoverage:{...real.whppCompletion.terminalEvidenceCoverage,returnedRows:23}}},context).accepted,false,'189/190 terminal statuses cannot finish WHPP');
assert.equal(harness({...real,whppCompletion:{...real.whppCompletion,snapshotLocked:false}},context).accepted,false,'no immutable snapshot cannot use July-1 fallback');
const twoUnknown={
  ...real,whppCompletion:{
    ...real.whppCompletion,terminalEvidenceVerified:false,
    terminalEvidenceCoverage:{scanRows:190,finalRows:190,podRows:166,returnedRows:22,unverifiedRows:2},
    terminalEvidenceGaps:[{shipmentCode:'W-UNKNOWN-1'},{shipmentCode:'W-UNKNOWN-2'}]
  }
};
const failed=harness(twoUnknown,context);
assert.equal(failed.accepted,false,'188/190 terminal is not WHPP complete despite snapshot');
assert.equal(failed.gap.missing,2,'exact two terminal gaps must block 3/3');
assert.deepEqual(failed.gap.bills,['W-UNKNOWN-1','W-UNKNOWN-2']);
const processed=harness({...twoUnknown,whppCompletion:{...twoUnknown.whppCompletion,processingEvidenceVerified:true}},context);
assert.equal(processed.accepted,true,'4/4 scanned/finalized remains complete despite 2 ongoing customer statuses');
assert.equal(processed.gap.missing,2,'customer exception count still remains visible');


console.log('[V759/V738] exact dated WHPP terminal proof restores 3-of-3 only with matching immutable snapshot, scan and final membership; unified COMPLETED alone cannot finalize WHPP; an exact persisted WHPP child snapshot or full terminal scan+final proof can lock completion; browser aggregate 3-of-3 projection stays removed');
