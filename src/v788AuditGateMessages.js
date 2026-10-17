// No waybills, paths, user details or API diagnostic dumps in one-click audit UI.
// Derived solely from fixed acceptance gate identifiers and aggregate counts.
// The output explains WHAT failed and the next safe evidence/engineering action,
// never authorizes clearing, signing-time inference, or production writes.
const count=v=>Math.max(0,Number.isFinite(Number(v))?Math.floor(Number(v)):0);
export function explainV788Gate(g={}){
  const id=String(g.id||''),d=g.detail||{};
  if(id==='WHPP_INDEPENDENT_TMS_346'){
    return {label:'WHPP 346票独立TMS状态',
      summary:g.status==='PASS'?'逐票成员、8批与290票POD、56票已退回相符；仅状态证据通过。':'独立TMS逐票证据缺失、签名不一致或状态未完整验证。',
      next:'先核对D盘既有346票证据文件与日报成员名单，不要直接重新全量查询TMS。'};
  }
  if(id==='ISOLATED_DATABASE_AUDIT'){
    return {label:'隔离数据库结构',
      summary:'历史验收需要的数据表缺失或结构尚不兼容，无法判断其他业务是否已闭环。',
      next:'修复隔离副本只读审计的表结构兼容性，再重新检查；不回退读取正式数据库。'};
  }
  if(id==='ACTIVE_CP_72'){
    return {label:'72个当前有效CP门店码',
      summary:'当前有效门店码 '+count(d.activeCount)+' 个，唯一编码 '+count(d.uniqueCount)+' 个；验收要求均为72。',
      next:'核对最新72个有效CP名单是否完整导入隔离副本，不用旧门店码凑数。'};
  }
  if(id.startsWith('WHPP_DAILY_SOURCE_')){
    const day=id.slice('WHPP_DAILY_SOURCE_'.length);
    return {label:'WHPP '+day+'日报成员',
      summary:'当前识别 '+count(d.actualMembers)+' 票，要求 '+count(d.expectedMembers)+' 票。',
      next:'核对当天真实完整日报和WHPP成员分类，禁止按总数填补缺失单号。'};
  }
  if(id==='SEVEN_BUSINESS_LATEST_SOURCES'){
    return {label:'七业务最新日报来源',
      summary:'来源日期缺失 '+count(d.missingRequiredDates)+' 天，重复 '+count(d.duplicateSourceDates)+
        ' 天，未完成批次 '+count(d.unfinishedLatestValidDates)+' 天，未对平 '+count(d.unbalancedDates)+' 天。',
      next:'核对7月1日和2日七业务各自最新完整批次及保存状态，再进行逐票核对。'};
  }
  if(id==='WHPP_TERMINAL_CONFLICTS'){
    return {label:'WHPP相反终态冲突',
      summary:'当前状态矛盾 '+count(d.stateContradictions)+'，历史终态矛盾 '+
        count(d.terminalLedgerContradictions)+'，已存TMS与当前状态矛盾 '+
        count(d.persistedTmsVsCurrentStatusConflicts)+' 处。',
      next:'对照已保存的直接TMS 60/81和历史终态，冲突项人工核验后再考虑同步。'};
  }
  if(id==='WHPP_LATE_TMS_NEEDS_STATE_SYNC'){
    return {label:'WHPP旧状态待同步',
      summary:'新POD但旧状态未完成 '+count(d.lateStatus60StillUnfinished)+
        ' 处，新退回但旧状态未完成 '+count(d.lateStatus81StillUnfinished)+' 处。',
      next:'证据逐票确认后制定可审计的状态同步方案；当前只读，不改写OPEN账本。'};
  }
  if(id==='WHPP_LEDGER_VS_CURRENT'){
    return {label:'WHPP历史账本闭环',
      summary:'已POD/退回但账本仍OPEN '+count(d.openLedgerWithPODOrReturned)+
        ' 处，账本终态与当前未完成状态不符 '+count(d.terminalLedgerWithUnfinished)+' 处。',
      next:'按逐票直接TMS终态核实旧账本差异，保存审计证据后才能制定正式修复。'};
  }
  if(id==='WHPP_POD_SIGNING_TIME'){
    return {label:'WHPP可信签收时间',
      summary:'POD '+count(d.podMembers)+' 票，可信时间锁 '+count(d.trustedSavedPodTimes)+
        ' 票，缺可信时间 '+count(d.missingTrustedSavedPodTimes)+' 票。',
      next:'从原始签收轨迹和显式POD时间字段寻找来源；状态60或普通更新时间不得当签收时间。'};
  }
  if(id==='WHPP_TERMINAL_EVIDENCE'){
    return {label:'WHPP直接终态及当前账本一致性',
      summary:'隔离库直接POD '+count(d.strictPOD)+' 票、直接已退回 '+
        count(d.strictReturned)+' 票；需与290和56的独立状态证据逐票对应。',
      next:'用独立TMS证据核对旧库缺失/未同步成员；独立证据完整不等于旧账本已更新。'};
  }
  if(id==='WHPP_EXISTING_REAL_XLSX'){
    if(g.status==='PASS')return {label:'WHPP已有真实导出文件逐票回读',
      summary:'已从系统现有导出文件逐票核对 '+count(d.rows)+
        ' 票（POD '+count(d.pod)+'，已退回 '+count(d.returned)+'），并与隔离日报成员及独立TMS证明一致。',
      next:'仅WHPP 7月1日至2日文件通过；七业务综合真实Excel与签收时间仍须单独验收。'};
    if(d.status==='NOT_FOUND'||d.status==='NOT_CHECKED')return {
      label:'WHPP已有真实导出文件逐票回读',
      summary:'未发现可验收的既有两日WHPP Excel，或独立TMS/主导出盘未就绪；没有生成或下载假报表。',
      next:'优先使用已有正式导出文件；缺文件时维持待证据核验，不要求重复上传日报。'};
    return {label:'WHPP已有真实导出文件逐票回读',
      summary:'已有导出Excel文件无法通过逐票来源/终态校验（'+String(d.reason||d.status||'不一致')+'）。',
      next:'需核对真实导出的日期、全部明细、POD、退回分表；不得覆盖真实文件或修改业务库。'};
  }
  if(id==='REAL_EXCEL_DETAIL_READBACK'){
    return {label:'真实Excel逐票回读',
      summary:'仅完成SQLite来源审计；尚未验证真实日报或导出Excel每票的终态与数量。',
      next:'对原始真实Excel进行独立逐票回读核验；不以合成文件或汇总数字代替。'};
  }
  return {label:'其他隔离验收门槛',
    summary:'当前验收规则未完整满足，需进一步检查来源证据。',
    next:'保留阻断状态，不清空、不回写、不发布。'};
}
export function presentV788AuditGates(gates=[]){
  return (Array.isArray(gates)?gates:[]).map(g=>{
    const {label,summary,next}=explainV788Gate(g);
    return {id:String(g.id||''),status:g.status,label,summary,next};
  });
}
