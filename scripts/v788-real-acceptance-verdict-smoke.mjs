import assert from 'node:assert/strict';
import {buildV788AcceptanceVerdict} from './v788-real-acceptance-verdict.mjs';
const base={
 readOnly:true,active72:{status:'ACTIVE_72',count:72,uniqueCount:72},
 whpp:{byDate:[{date:'2026-07-01',sourceMembers:190},
                 {date:'2026-07-02',sourceMembers:156}],
  totals:{sourceMembers:346,normalizedPOD:290,normalizedReturned:56,
    trustedPodLockOnPOD:290,trustedPodTimeCoveragePct:100,
    labelOnlyTerminal:0,otherUnverified:0,strictPOD:290,strictReturned:56,
    contradiction:0,ledgerTerminalContradictingTms:0,
    ledgerOpenWithNormalizedTerminal:0,ledgerTerminalWithNonterminal:0}},
 sevenBusinessSource:{available:true,datesChecked:2,blockedDates:[],
   byDate:[{date:'2026-07-01',reconciled:true,latestValidUnifiedBatchPresent:true,completedValidUnifiedBatch:true},
     {date:'2026-07-02',reconciled:true,latestValidUnifiedBatchPresent:true,completedValidUnifiedBatch:true}]}
};
const clone=()=>JSON.parse(JSON.stringify(base));
const ready=buildV788AcceptanceVerdict(clone());
assert.equal(ready.counts.blocked,0);
assert.equal(ready.releaseDecision,'NEEDS_REAL_EVIDENCE',
  'only source validation does not prove Excel, never auto-approve publish');
assert.equal(ready.readyToPublish,false);
let stale=clone();stale.sevenBusinessSource.byDate[0].reconciled=false;
stale.sevenBusinessSource.blockedDates=['2026-07-01'];
assert.equal(buildV788AcceptanceVerdict(stale).releaseDecision,'BLOCKED');
let missingUnified=clone();missingUnified.sevenBusinessSource.byDate[0].latestValidUnifiedBatchPresent=false;
missingUnified.sevenBusinessSource.byDate[0].completedValidUnifiedBatch=false;
assert.equal(buildV788AcceptanceVerdict(missingUnified).releaseDecision,'BLOCKED',
  'WHPP-only date is not proof that all seven business sources exist');
assert.equal(buildV788AcceptanceVerdict(missingUnified).gates.find(x=>x.id==='SEVEN_BUSINESS_LATEST_SOURCES').detail.missingUnifiedSourceDates,1);
let incompleteUnified=clone();incompleteUnified.sevenBusinessSource.byDate[1].completedValidUnifiedBatch=false;
assert.equal(buildV788AcceptanceVerdict(incompleteUnified).releaseDecision,'BLOCKED',
  'reconciled members must not mask incomplete newest unified import');
// The latest seven-business source must cover BOTH exact WHPP acceptance
// dates; all-green results for only one day are not enough to publish.
let onlyOneDay=clone();
onlyOneDay.sevenBusinessSource.byDate=onlyOneDay.sevenBusinessSource.byDate.slice(0,1);
onlyOneDay.sevenBusinessSource.datesChecked=1;
let oneDayVerdict=buildV788AcceptanceVerdict(onlyOneDay);
assert.equal(oneDayVerdict.releaseDecision,'BLOCKED');
assert.equal(oneDayVerdict.gates.find(x=>x.id==='SEVEN_BUSINESS_LATEST_SOURCES').detail.missingRequiredDates,1);
let repeatedDay=clone();repeatedDay.sevenBusinessSource.byDate.push({...repeatedDay.sevenBusinessSource.byDate[0]});
repeatedDay.sevenBusinessSource.datesChecked=3;
assert.equal(buildV788AcceptanceVerdict(repeatedDay).releaseDecision,'BLOCKED');
let staleDateCount=clone();staleDateCount.sevenBusinessSource.datesChecked=1;
assert.equal(buildV788AcceptanceVerdict(staleDateCount).releaseDecision,'BLOCKED');
let blockedDates=clone();blockedDates.sevenBusinessSource.blockedDates=['2026-07-01'];
assert.equal(buildV788AcceptanceVerdict(blockedDates).releaseDecision,'BLOCKED');
let notReally72=clone();notReally72.active72.uniqueCount=71;
assert.equal(buildV788AcceptanceVerdict(notReally72).releaseDecision,'BLOCKED');
let missingTerminal=clone();missingTerminal.whpp.totals.strictPOD=0;
const noTerminalVerdict=buildV788AcceptanceVerdict(missingTerminal);
assert.equal(noTerminalVerdict.gates.find(x=>x.id==='WHPP_TERMINAL_EVIDENCE').status,'REVIEW',
  'absence of strict TMS proof cannot pass even if legacy labels and conflicts are zero');
let returnedShort=clone();returnedShort.whpp.totals.strictReturned=55;
assert.equal(buildV788AcceptanceVerdict(returnedShort).gates.find(x=>x.id==='WHPP_TERMINAL_EVIDENCE').status,'REVIEW');
let returningStill=clone();returningStill.whpp.totals.returning80=1;
assert.equal(buildV788AcceptanceVerdict(returningStill).gates.find(x=>x.id==='WHPP_TERMINAL_EVIDENCE').status,'REVIEW');
let open=clone();open.whpp.totals.ledgerOpenWithNormalizedTerminal=346;
const blocked=buildV788AcceptanceVerdict(open);
assert.equal(blocked.releaseDecision,'BLOCKED');
assert.deepEqual(blocked.gates.find(x=>x.id==='WHPP_LEDGER_VS_CURRENT').detail,
 {openLedgerWithPODOrReturned:346,terminalLedgerWithUnfinished:0});
let unsynced=clone();unsynced.whpp.totals.latePODPendingState=2;
assert.equal(buildV788AcceptanceVerdict(unsynced).gates.find(x=>x.id==='WHPP_LATE_TMS_NEEDS_STATE_SYNC').status,'REVIEW');
let old=clone();old.whpp.totals.trustedPodLockOnPOD=0;old.whpp.totals.trustedPodTimeCoveragePct=0;
assert.equal(buildV788AcceptanceVerdict(old).gates.find(x=>x.id==='WHPP_POD_SIGNING_TIME').status,'REVIEW');
let cp=clone();cp.active72.status='INVALID';cp.active72.count=71;
assert.equal(buildV788AcceptanceVerdict(cp).releaseDecision,'BLOCKED');
let wrong=clone();wrong.whpp.byDate[1].sourceMembers=155;
assert.equal(buildV788AcceptanceVerdict(wrong).releaseDecision,'BLOCKED');
assert.equal(JSON.stringify(blocked).includes('CE0207'),false);
console.log('[V788 ACCEPTANCE] CP72, WHPP190/156, terminal ledger, POD time, latest source and Excel-not-verified gates PASS');