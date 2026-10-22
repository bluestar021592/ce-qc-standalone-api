// V788 offline evidence gate. Pure, fail-closed, and NEVER grants release or purge rights.
// All inputs are aggregate read-only inspection results, not customer/waybill records.
export const V788_OFFLINE_EVIDENCE_GATE_ID = 'V788_READONLY_RELEASE_EVIDENCE_V1';
const isCount = n => Number.isSafeInteger(n) && n >= 0;
const count = n => isCount(n) ? n : null;
const sum = (rows,key) => rows.reduce((s,r) => s + (count(r?.[key]) ?? 0),0);
const status = (ok,missing) => ok ? 'PASS' : missing ? 'REVIEW' : 'BLOCK';
export function evaluateV788EvidenceReport(report, options={}) {
  const audit=report?.audit, whpp=audit?.whpp, total=whpp?.totals;
  const dates=Array.isArray(whpp?.byDate)?whpp.byDate:[];
  const sourceDates=Array.isArray(audit?.sevenBusinessSource?.byDate)?audit.sevenBusinessSource.byDate:[];
  const checks=[];
  const add=(id,ok,missing,detail) => checks.push({id,status:status(Boolean(ok),Boolean(missing)),detail});
  const now=Number.isFinite(options?.nowMs)?options.nowMs:Date.now();
  const generated=Date.parse(String(report?.generatedAt||''));
  const ageHours=(now-generated)/3600000;
  add('READONLY_REPORT',audit?.readOnly===true&&report?.databaseCopyUnmodifiedDuringAudit===true,
    !audit,'只读验收副本必须可识别，且审计期间数据库未修改');
  add('REPORT_FRESHNESS',Number.isFinite(ageHours)&&ageHours>=-0.1&&ageHours<=72,
    !Number.isFinite(ageHours),'正式验收需要最近72小时内的新证据，历史报告仅供定位');
  const cp=audit?.active72;
  add('ACTIVE_CP_72',cp?.count===72&&cp?.uniqueCount===72&&!audit?.active72?.duplicateCount,
    !cp,'72个有效CP编码须去重且保持72个');
  const uniqueWhppDates=new Set(dates.map(d=>String(d?.date||'')));
  const validDateRows=dates.length>0&&uniqueWhppDates.size===dates.length
    &&dates.every(d=>/^20\d{2}-\d{2}-\d{2}$/.test(d.date)
      &&isCount(d.sourceMembers)&&isCount(d.withCurrent)
      &&d.sourceMembers===d.withCurrent);
  const memberSum=sum(dates,'sourceMembers'), hasTotals=isCount(total?.sourceMembers);
  add('WHPP_SOURCE_MEMBERS',validDateRows&&hasTotals&&total.sourceMembers===memberSum
    &&total.withCurrent===memberSum, !dates.length||!hasTotals,
    'WHPP独立日报每日期成员与当前记录、合计必须逐项一致');
  const normalizedPod=count(total?.normalizedPOD),normalizedReturned=count(total?.normalizedReturned);
  const strictPod=count(total?.strictPOD),strictReturned=count(total?.strictReturned);
  const labelOnly=count(total?.labelOnlyTerminal),unverified=count(total?.otherUnverified);
  const noConflict=total?.contradiction===0&&total?.savedTmsCurrentConflict===0;
  const validTerminalConservation=hasTotals&&normalizedPod!==null
    &&normalizedReturned!==null&&strictPod!==null&&strictReturned!==null
    &&count(total?.returning80)!==null
    &&normalizedPod+normalizedReturned<=total.sourceMembers
    &&strictPod+strictReturned+total.returning80<=total.sourceMembers;
  add('WHPP_STRICT_TERMINAL',validTerminalConservation&&labelOnly===0&&unverified===0
    &&strictPod>=normalizedPod&&strictReturned>=normalizedReturned&&noConflict,
    !total,'旧状态标签不能替代逐票TMS 60/81或严格等效证据；退回中80不能算已退回');
  // Aggregate 290 POD + 56 returns may belong to DIFFERENT bills than saved TMS
  // 60/81. Never accept equal totals as proof of exact per-bill status ownership.
  const perBill=report?.whppPerBillIndependentEvidence;
  const verifiedPerBill=perBill?.readOnly===true
    &&perBill?.matchedBySourceDateAndBusiness===true
    &&perBill?.independentlyCheckedAgainstSavedTms===true
    &&perBill?.memberCount===total?.sourceMembers
    &&perBill?.podBillMatches===normalizedPod
    &&perBill?.returnedBillMatches===normalizedReturned
    &&perBill?.terminalConflictBills===0
    &&perBill?.wrongDateStatusMatches===0
    &&perBill?.returningCountedAsReturned===0;
  add('WHPP_PER_WAYBILL_TERMINAL_EVIDENCE',verifiedPerBill,!perBill,
    '同一来源日期+业务+运单号必须逐票匹配TMS60/POD与81/已退回，不得用总量相等代替逐票证据');
  const ledger=count(total?.ledgerOpenWithNormalizedTerminal);
  add('WHPP_LEDGER_CLOSURE',ledger===0&&total?.ledgerTerminalWithNonterminal===0
    &&total?.ledgerTerminalContradictingTms===0,
    ledger===null,'已核实POD或已退回必须与历史跟踪账本闭环一致');
  const trusted=count(total?.trustedPodLockOnPOD);
  const timing=report?.whppPerBillTimingEvidence;
  add('WHPP_POD_TIME',normalizedPod!==null&&trusted!==null&&trusted>=normalizedPod
    &&total?.trustedPodLockOnNonPOD===0
    &&timing?.readOnly===true&&timing?.sourceDateBound===true
    &&timing?.canonicalPodBillCount===normalizedPod
    &&timing?.trustedTimestampMatchedBills===normalizedPod
    &&timing?.missingOrInvalidTimestamps===0
    &&timing?.evidenceProvenanceChecked===true,
    !timing,'可信POD时间须逐票匹配当前POD成员、来源日期和允许的原始时间字段；仅有时间锁总数不代表可信');
  const uniqueSourceDates=new Set(sourceDates.map(d=>String(d?.date||'')));
  const whppByDate=new Map(dates.map(d=>[d?.date,d?.sourceMembers]));
  const sevenOk=sourceDates.length>0&&uniqueSourceDates.size===sourceDates.length
    &&audit?.sevenBusinessSource?.available===true
    &&sourceDates.every(d=>d.reconciled===true&&d.latestValidUnifiedBatchPresent===true
      &&d.completedValidUnifiedBatch===true&&!d.blockedByUnfinishedValidBatch
      &&d.duplicateBusinessRows===0&&d.crossBusinessDuplicates===0
      &&d.whppOverlapWithSix===0&&isCount(d.sixBusinessRows)
      &&isCount(d.whppIndependentSourceMembers)
      &&isCount(d.sevenBusinessDistinctUnion)
      &&whppByDate.get(d.date)===d.whppIndependentSourceMembers
      &&d.sevenBusinessDistinctUnion===d.sixBusinessRows+d.whppIndependentSourceMembers);
  add('SEVEN_BUSINESS_SOURCE',sevenOk,!sourceDates.length,
    '七业务日报快照来源去重守恒；不能用缺失批次或旧完成批次代替最新有效来源');
  const expectedExcelSource=sum(sourceDates,'sevenBusinessDistinctUnion');
  const excel=report?.realExcelReadback;
  add('REAL_EXCEL_READBACK',excel?.readOnly===true&&excel?.rawExcelRead===true
    &&expectedExcelSource>0&&excel?.sourceMemberCount===expectedExcelSource
    &&excel?.matchedDistinctWaybills===expectedExcelSource
    &&excel?.missingWaybills===0&&excel?.unexpectedWaybills===0
    &&excel?.businessAndDateMatched===true&&excel?.exportRowsMatched===true,
    !excel,'须提供原始Excel逐票来源及真实导出逐票一致性报告；只读数据库校验不能替代它');
  const ui=report?.realUiAndExportVerification;
  add('REAL_UI_EXPORT',ui?.independentReadOnlyVerification===true
    &&ui?.totalAndSevenBoardsMatched===true
    &&ui?.drilldownMatched===true&&ui?.timestampMetricsVerified===true
    &&ui?.exportReadbackMatched===true,
    !ui,'必须另行核验5177总/分看板、逐票点击、签收时效、真实导出回读');
  const selfGranted=report?.verdict?.readyToClearAndReimport===true
    ||report?.verdict?.readyToPublish===true;
  add('NO_SELF_AUTHORIZATION',!selfGranted,false,
    '验收报告本身或代码测试结果不能授予发布、删除或清空重传权限');
  const pass=checks.filter(c=>c.status==='PASS').length;
  const blocked=checks.filter(c=>c.status==='BLOCK').length;
  const review=checks.filter(c=>c.status==='REVIEW').length;
  const evidenceReady=checks.every(c=>c.status==='PASS');
  return {
    id:V788_OFFLINE_EVIDENCE_GATE_ID,mode:'READONLY_OFFLINE_AGGREGATE',
    releaseDecision:evidenceReady?'MANUAL_APPROVAL_STILL_REQUIRED':'BLOCKED',
    evidenceReadyForManualReview:evidenceReady,readyToPublish:false,
    readyToClearAndReimport:false,authorizedToClear:false,productionModified:false,
    counts:{pass,blocked,review,total:checks.length},
    summary:{reportGeneratedAt:report?.generatedAt||'',whppMembers:hasTotals?total.sourceMembers:null,
      podLabels:normalizedPod,returnedLabels:normalizedReturned,
      openLedgerOnLabeledTerminal:ledger,trustedPodTimes:trusted,
      excelExpectedSourceMembers:sourceDates.length?expectedExcelSource:null},
    checks
  };
}
