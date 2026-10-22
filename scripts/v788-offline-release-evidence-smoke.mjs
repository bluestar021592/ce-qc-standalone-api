import assert from 'node:assert/strict';
import fs from 'node:fs';
import {evaluateV788EvidenceReport as review,V788_OFFLINE_EVIDENCE_GATE_ID} from '../src/v788OfflineEvidenceGate.js';

const nowMs=Date.parse('2026-10-22T10:00:00+07:00');
const input={
  generatedAt:'2026-10-22T02:00:00Z', databaseCopyUnmodifiedDuringAudit:true,
  audit:{readOnly:true,active72:{count:72,uniqueCount:72},whpp:{
    byDate:[{date:'2026-07-01',sourceMembers:190,withCurrent:190},
      {date:'2026-07-02',sourceMembers:156,withCurrent:156}],
    totals:{sourceMembers:346,withCurrent:346,normalizedPOD:290,normalizedReturned:56,
      strictPOD:0,strictReturned:0,returning80:0,labelOnlyTerminal:346,otherUnverified:0,
      contradiction:0,savedTmsCurrentConflict:0,ledgerOpenWithNormalizedTerminal:346,
      ledgerTerminalWithNonterminal:0,ledgerTerminalContradictingTms:0,
      trustedPodLockOnPOD:0,trustedPodLockOnNonPOD:0}
  },sevenBusinessSource:{available:true,byDate:[
      {date:'2026-07-01',reconciled:true,latestValidUnifiedBatchPresent:true,completedValidUnifiedBatch:true,
        blockedByUnfinishedValidBatch:false,duplicateBusinessRows:0,crossBusinessDuplicates:0,
        whppOverlapWithSix:0,sixBusinessRows:6231,whppIndependentSourceMembers:190,
        sevenBusinessDistinctUnion:6421},
      {date:'2026-07-02',reconciled:true,latestValidUnifiedBatchPresent:true,completedValidUnifiedBatch:true,
        blockedByUnfinishedValidBatch:false,duplicateBusinessRows:0,crossBusinessDuplicates:0,
        whppOverlapWithSix:0,sixBusinessRows:515,whppIndependentSourceMembers:156,
        sevenBusinessDistinctUnion:671}
  ]}},
  verdict:{readyToPublish:false,readyToClearAndReimport:false}
};
const one=()=>review(input,{nowMs});
const check=(res,id)=>res.checks.find(c=>c.id===id)?.status;
const first=one();
assert.equal(first.id,V788_OFFLINE_EVIDENCE_GATE_ID);
assert.equal(first.releaseDecision,'BLOCKED');
assert.equal(first.summary.whppMembers,346);
assert.equal(first.summary.podLabels,290);
assert.equal(first.summary.trustedPodTimes,0);
assert.equal(first.summary.excelExpectedSourceMembers,7092);
for(const id of ['WHPP_STRICT_TERMINAL','WHPP_LEDGER_CLOSURE','WHPP_POD_TIME'])
 assert.equal(check(first,id),'BLOCK',id);
for(const id of ['REAL_EXCEL_READBACK','REAL_UI_EXPORT'])
 assert.equal(check(first,id),'REVIEW',id);
assert.equal(first.authorizedToClear,false);

input.verdict.readyToClearAndReimport=true;
input.verdict.readyToPublish=true;
assert.equal(check(one(),'NO_SELF_AUTHORIZATION'),'BLOCK','self-reported pass cannot authorize clear');
input.verdict.readyToClearAndReimport=false;
input.verdict.readyToPublish=false;
const fresh=JSON.parse(JSON.stringify(input));
fresh.generatedAt='2026-10-14T04:37:07Z';
assert.equal(check(review(fresh,{nowMs}),'REPORT_FRESHNESS'),'BLOCK','old read-only reports cannot release today');
assert.equal(review(null,{nowMs}).releaseDecision,'BLOCKED','malformed report must fail closed');
assert.equal(review({},{nowMs}).readyToClearAndReimport,false);

input.audit.whpp.totals.strictPOD=290;
input.audit.whpp.totals.strictReturned=56;
input.audit.whpp.totals.labelOnlyTerminal=0;
input.audit.whpp.totals.ledgerOpenWithNormalizedTerminal=0;
input.audit.whpp.totals.trustedPodLockOnPOD=290;
// Matching terminal and time COUNTS alone are not proof of the same 346 WHPP bills.
const aggregateOnly=one();
assert.equal(check(aggregateOnly,'WHPP_PER_WAYBILL_TERMINAL_EVIDENCE'),'REVIEW');
assert.equal(check(aggregateOnly,'WHPP_POD_TIME'),'REVIEW');
assert.equal(aggregateOnly.evidenceReadyForManualReview,false);
input.whppPerBillIndependentEvidence={readOnly:true,matchedBySourceDateAndBusiness:true,
  independentlyCheckedAgainstSavedTms:true,memberCount:346,podBillMatches:290,
  returnedBillMatches:56,terminalConflictBills:0,wrongDateStatusMatches:0,
  returningCountedAsReturned:0};
input.whppPerBillTimingEvidence={readOnly:true,sourceDateBound:true,
  canonicalPodBillCount:290,trustedTimestampMatchedBills:290,
  missingOrInvalidTimestamps:0,evidenceProvenanceChecked:true};
input.realExcelReadback={readOnly:true,rawExcelRead:true,sourceMemberCount:7092,
  matchedDistinctWaybills:7092,missingWaybills:0,unexpectedWaybills:0,
  businessAndDateMatched:true,exportRowsMatched:true};
input.realUiAndExportVerification={independentReadOnlyVerification:true,
  totalAndSevenBoardsMatched:true,drilldownMatched:true,timestampMetricsVerified:true,
  exportReadbackMatched:true};
const all=one();
assert.equal(all.evidenceReadyForManualReview,true,'complete independent evidence allows review only');
assert.equal(all.releaseDecision,'MANUAL_APPROVAL_STILL_REQUIRED');
assert.equal(all.readyToPublish,false,'never auto deploy');
assert.equal(all.authorizedToClear,false,'never auto purge');
assert.equal(all.readyToClearAndReimport,false,'never auto reimport');
const tampered=JSON.parse(JSON.stringify(input));
tampered.audit.whpp.totals.trustedPodLockOnPOD=289;
assert.equal(check(review(tampered,{nowMs}),'WHPP_POD_TIME'),'BLOCK');
tampered.audit.whpp.totals.trustedPodLockOnPOD=290;
tampered.audit.sevenBusinessSource.byDate[0].crossBusinessDuplicates=1;
assert.equal(check(review(tampered,{nowMs}),'SEVEN_BUSINESS_SOURCE'),'BLOCK');
const noDateDuplicates=JSON.parse(JSON.stringify(input));
noDateDuplicates.audit.sevenBusinessSource.byDate[1].date='2026-07-01';
assert.equal(check(review(noDateDuplicates,{nowMs}),'SEVEN_BUSINESS_SOURCE'),'BLOCK','duplicate source dates cannot be counted twice');
const noExtraTerminals=JSON.parse(JSON.stringify(input));
noExtraTerminals.audit.whpp.totals.strictPOD=310;
assert.equal(check(review(noExtraTerminals,{nowMs}),'WHPP_STRICT_TERMINAL'),'BLOCK','strict terminal count above source members must fail closed');
const crossDateMismatch=JSON.parse(JSON.stringify(input));
crossDateMismatch.audit.sevenBusinessSource.byDate[0].whppIndependentSourceMembers=189;
crossDateMismatch.audit.sevenBusinessSource.byDate[0].sevenBusinessDistinctUnion=6420;
assert.equal(check(review(crossDateMismatch,{nowMs}),'SEVEN_BUSINESS_SOURCE'),'BLOCK','per-date WHPP source membership cannot drift while seven-business sum balances');
const falsePositiveTerminal=JSON.parse(JSON.stringify(input));
falsePositiveTerminal.whppPerBillIndependentEvidence.podBillMatches=289;
assert.equal(check(review(falsePositiveTerminal,{nowMs}),'WHPP_PER_WAYBILL_TERMINAL_EVIDENCE'),'BLOCK',
  'same terminal totals but different actual bills must not clear release gate');
const falsePositiveTime=JSON.parse(JSON.stringify(input));
falsePositiveTime.whppPerBillTimingEvidence.trustedTimestampMatchedBills=289;
assert.equal(check(review(falsePositiveTime,{nowMs}),'WHPP_POD_TIME'),'BLOCK',
  'same total signed-time locks do not prove matching 290 canonical POD members');
const wrongDateTms=JSON.parse(JSON.stringify(input));
wrongDateTms.whppPerBillIndependentEvidence.wrongDateStatusMatches=1;
assert.equal(check(review(wrongDateTms,{nowMs}),'WHPP_PER_WAYBILL_TERMINAL_EVIDENCE'),'BLOCK',
  'terminal proof from a different source date must not prove old daily membership');
const returnInProgress=JSON.parse(JSON.stringify(input));
returnInProgress.whppPerBillIndependentEvidence.returningCountedAsReturned=1;
assert.equal(check(review(returnInProgress,{nowMs}),'WHPP_PER_WAYBILL_TERMINAL_EVIDENCE'),'BLOCK',
  'shipmentStatus 80 returning is not shipmentStatus 81 returned');
const main=fs.readFileSync(new URL('../src/v788OfflineEvidenceGate.js',import.meta.url),'utf8');
assert.doesNotMatch(main,/writeFile|unlink|rmSync|\bDELETE\b|\bUPDATE\b|fetch\(/);
console.log('[V788 OFFLINE EVIDENCE] source 346, POD-time 0/290, ledger OPEN346 and absent Excel/UI block; stale/spoofed report fails closed; all evidence still needs manual approval PASS');
