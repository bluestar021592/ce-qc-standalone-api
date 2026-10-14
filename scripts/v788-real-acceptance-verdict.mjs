// Pure, privacy-preserving read-only database acceptance interpretation.
// This never claims an actual XLSX has been read: the separate Excel
// exporter/readback still needs an isolated-copy validation step.
const EXPECTED=new Map([['2026-07-01',190],['2026-07-02',156]]);
function check(id,status,detail){return {id,status,detail}}
export function buildV788AcceptanceVerdict(audit){
  if(!audit||audit.readOnly!==true||!audit.whpp?.totals)
    throw new Error('只读数据审计结果缺失，禁止误判为验收通过');
  const results=[],totals=audit.whpp.totals,source=audit.sevenBusinessSource||{};
  results.push(check('ACTIVE_CP_72',
    audit.active72?.status==='ACTIVE_72'?'PASS':'BLOCK',
    {activeCount:Number(audit.active72?.count||0),uniqueCount:Number(audit.active72?.uniqueCount||0)}));
  for(const [date,expected] of EXPECTED){
    const found=audit.whpp.byDate?.find(x=>x.date===date);
    results.push(check('WHPP_DAILY_SOURCE_'+date,
      found?.sourceMembers===expected?'PASS':'BLOCK',
      {date,expectedMembers:expected,actualMembers:Number(found?.sourceMembers||0)}));
  }
  results.push(check('SEVEN_BUSINESS_LATEST_SOURCES',
    source.available&&Array.isArray(source.byDate)&&source.byDate.length>0
      &&source.byDate.every(day=>day.reconciled===true)?'PASS':'BLOCK',
    {datesChecked:Number(source.datesChecked||0),
      unfinishedLatestValidDates:(source.blockedDates||[]).length,
      unbalancedDates:(source.byDate||[]).filter(day=>day.reconciled!==true).length,
      sourceMembershipOnly:true}));
  results.push(check('WHPP_TERMINAL_CONFLICTS',
    Number(totals.contradiction||0)===0&&Number(totals.ledgerTerminalContradictingTms||0)===0
      ?'PASS':'BLOCK',
    {stateContradictions:Number(totals.contradiction||0),
     terminalLedgerContradictions:Number(totals.ledgerTerminalContradictingTms||0)}));
  results.push(check('WHPP_LATE_TMS_NEEDS_STATE_SYNC',
    Number(totals.latePODPendingState||0)===0&&Number(totals.lateReturnedPendingState||0)===0
      ?'PASS':'REVIEW',
    {lateStatus60StillUnfinished:Number(totals.latePODPendingState||0),
      lateStatus81StillUnfinished:Number(totals.lateReturnedPendingState||0),
      note:'最新60/81允许闭环，尚未同步的旧OPEN状态应更新，但不是相反终态矛盾'}));
  results.push(check('WHPP_LEDGER_VS_CURRENT',
    Number(totals.ledgerOpenWithNormalizedTerminal||0)===0
      &&Number(totals.ledgerTerminalWithNonterminal||0)===0?'PASS':'BLOCK',
    {openLedgerWithPODOrReturned:Number(totals.ledgerOpenWithNormalizedTerminal||0),
      terminalLedgerWithUnfinished:Number(totals.ledgerTerminalWithNonterminal||0)}));
  const pod=Number(totals.normalizedPOD||0),trusted=Number(totals.trustedPodLockOnPOD||0);
  results.push(check('WHPP_POD_SIGNING_TIME',
    pod>0&&trusted===pod?'PASS':'REVIEW',
    {podMembers:pod,trustedSavedPodTimes:trusted,
      missingTrustedSavedPodTimes:Math.max(0,pod-trusted),
      coveragePct:totals.trustedPodTimeCoveragePct,
      note:'仅统计来源可核实的独立POD时间锁；不把状态60或旧文本当作签收时间'}));
  results.push(check('WHPP_TERMINAL_EVIDENCE',
    Number(totals.sourceMembers||0)>0&&Number(totals.labelOnlyTerminal||0)===0
      &&Number(totals.otherUnverified||0)===0?'PASS':'REVIEW',
    {labelOnlyTerminal:Number(totals.labelOnlyTerminal||0),
      otherUnverified:Number(totals.otherUnverified||0),
      strictPOD:Number(totals.strictPOD||0),
      strictReturned:Number(totals.strictReturned||0),
      returning80:Number(totals.returning80||0)}));
  // This audit does not generate or inspect real seven-business XLSX files.
  results.push(check('REAL_EXCEL_DETAIL_READBACK','REVIEW',
    {reason:'只读SQLite来源核验不能替代真实Excel文件逐票回读'}));
  const blocked=results.filter(x=>x.status==='BLOCK');
  const reviewing=results.filter(x=>x.status==='REVIEW');
  return {
    version:'V788_ACCEPTANCE_VERDICT_V1',
    releaseDecision:blocked.length?'BLOCKED':reviewing.length?'NEEDS_REAL_EVIDENCE':'READY_FOR_REVIEW',
    readyToClearAndReimport:false,
    readyToPublish:false,
    reason:'此报告为数据库副本只读验收；人工复核、真实Excel回读和发布批准不由此工具自动完成',
    gates:results,
    counts:{passed:results.filter(x=>x.status==='PASS').length,
      blocked:blocked.length,reviewing:reviewing.length,total:results.length},
    exclusions:'不包含客户资料、单号、具体门店名或数据库绝对路径'
  };
}
