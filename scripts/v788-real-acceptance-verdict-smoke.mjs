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
   byDate:[{date:'2026-07-01',reconciled:true},{date:'2026-07-02',reconciled:true}]}
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
let open=clone();open.whpp.totals.ledgerOpenWithNormalizedTerminal=346;
const blocked=buildV788AcceptanceVerdict(open);
assert.equal(blocked.releaseDecision,'BLOCKED');
assert.deepEqual(blocked.gates.find(x=>x.id==='WHPP_LEDGER_VS_CURRENT').detail,
 {openLedgerWithPODOrReturned:346,terminalLedgerWithUnfinished:0});
let old=clone();old.whpp.totals.trustedPodLockOnPOD=0;old.whpp.totals.trustedPodTimeCoveragePct=0;
assert.equal(buildV788AcceptanceVerdict(old).gates.find(x=>x.id==='WHPP_POD_SIGNING_TIME').status,'REVIEW');
let cp=clone();cp.active72.status='INVALID';cp.active72.count=71;
assert.equal(buildV788AcceptanceVerdict(cp).releaseDecision,'BLOCKED');
let wrong=clone();wrong.whpp.byDate[1].sourceMembers=155;
assert.equal(buildV788AcceptanceVerdict(wrong).releaseDecision,'BLOCKED');
assert.equal(JSON.stringify(blocked).includes('CE0207'),false);
console.log('[V788 ACCEPTANCE] CP72, WHPP190/156, terminal ledger, POD time, latest source and Excel-not-verified gates PASS');