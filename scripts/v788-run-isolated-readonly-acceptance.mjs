import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditDatabaseFile} from './v788-whpp-real-readonly-audit.mjs';
import {buildV788AcceptanceVerdict} from './v788-real-acceptance-verdict.mjs';

export const DEFAULT_COPY=String.raw`D:\CE_QC_V788_验收副本\ce_qc_monitor.db`;
export function validateIsolatedCopy(input){
  const raw=String(input||'').trim();
  if(!raw)throw new Error('验收数据库副本路径未提供');
  const normalized=path.win32.normalize(raw).toLowerCase();
  const required=path.win32.normalize(DEFAULT_COPY).toLowerCase();
  // Never accept the production default DB, or arbitrary alternate paths.
  if(normalized!==required)
    throw new Error('安全拦截：此只读验收工具仅允许D盘V788验收副本，不接受正式数据库或其他路径');
  if(process.platform==='win32'&&fs.existsSync(raw)){
    const physical=path.win32.normalize(fs.realpathSync.native(raw)).toLowerCase();
    if(physical!==required)throw new Error('安全拦截：验收副本路径指向别处（链接或重定向），拒绝读取');
  }
  return raw;
}
export function acceptanceText(audit,verdict){
  const totals=audit.whpp?.totals||{},rows=audit.whpp?.byDate||[];
  const name={PASS:'通过',REVIEW:'待证据核验',BLOCK:'阻断发布'};
  const lines=[
    'V788 只读真实数据库验收报告',
    '最终结论：'+verdict.releaseDecision,
    '本报告没有更改或清空数据库，不代表真实Excel已完成回读。',
    '门店有效编码数量：'+Number(audit.active72?.count||0),
    'WHPP成员总数：'+Number(totals.sourceMembers||0),
    ...rows.filter(r=>['2026-07-01','2026-07-02'].includes(r.date))
      .map(r=>r.date+' WHPP：'+r.sourceMembers+'票（POD '+r.normalizedPOD+
      '，已退回 '+r.normalizedReturned+'，退回中 '+r.returning80+'）'),
    'WHPP POD时间可信覆盖：'+Number(totals.trustedPodLockOnPOD||0)+' / '+
      Number(totals.normalizedPOD||0)+'（'+(totals.trustedPodTimeCoveragePct??'无POD基数')+'%）',
    '账本OPEN但当前POD/已退回：'+Number(totals.ledgerOpenWithNormalizedTerminal||0),
    '独立TMS记录覆盖：'+Number(totals.savedTmsTrackMembers||0)+' / '+Number(totals.sourceMembers||0),
    '独立TMS状态：60(POD)='+Number(totals.savedTms60||0)
      +'，80(退回中)='+Number(totals.savedTms80||0)
      +'，81(已退回)='+Number(totals.savedTms81||0)
      +'，其他='+Number(totals.savedTmsUnknown||0),
    '独立TMS与当前状态冲突：'+Number(totals.savedTmsCurrentConflict||0),
    '历史TMS补证记录（只读诊断）：',
    ...(audit.savedTimingStopSummary?.byDate||[]).map(item=>
      item.date+'：'+(item.savedDurableStop
        ?'已保存停止记录；请求='+Number(item.statusQueried||0)
          +'，返回='+Number(item.statusApiRows||0)
          +'，匹配='+Number(item.statusMatchedRows||0)
          +'，写入='+Number(item.statusPersistedRows||0)
          +'，失败='+Number(item.statusFailed||0)
          +'，失败类别='+JSON.stringify(item.statusFailureTypes||{})
        :'未发现停止记录（不代表未调用TMS接口）')),
    '七业务来源日期：'+Number(audit.sevenBusinessSource?.datesChecked||0),
    '最新日报未处理完成日期：'+Number(audit.sevenBusinessSource?.blockedDates?.length||0),
    '---------------------------------------------',
    ...verdict.gates.map(g=>'['+(name[g.status]||g.status)+'] '+g.id+'：'+JSON.stringify(g.detail)),
    '---------------------------------------------',
    '任何阻断或待证据核验均不授权发布或清空重传。',
    '报告不包含运单号、客户姓名、手机号、具体门店名称或数据库路径。'
  ];
  return lines.join('\r\n')+'\r\n';
}
export function runIsolatedAcceptance(dbPath=DEFAULT_COPY,outBase=''){
  const safe=validateIsolatedCopy(dbPath);
  if(!fs.existsSync(safe))throw new Error('尚未找到D盘V788验收副本数据库，禁止自动访问正式数据库');
  const before=fs.statSync(safe);
  if(!before.isFile())throw new Error('验收来源不是普通SQLite数据库文件');
  const audit=auditDatabaseFile(safe);
  const after=fs.statSync(safe);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)
    throw new Error('验收副本在核验期间发生改变，结果无效；请重新检查验收副本');
  const verdict=buildV788AcceptanceVerdict(audit);
  const dest=outBase?path.resolve(outBase):path.join(path.dirname(safe),'V788_只读验收结果');
  if(dest.toLowerCase()===safe.toLowerCase())
    throw new Error('报告输出位置不得指向SQLite源文件');
  const payload={generatedAt:new Date().toISOString(),
    databaseCopyUnmodifiedDuringAudit:true,
    audit,verdict};
  fs.writeFileSync(dest+'.json',JSON.stringify(payload,null,2)+'\n','utf8');
  fs.writeFileSync(dest+'.txt',acceptanceText(audit,verdict),'utf8');
  return {status:verdict.releaseDecision,jsonFile:dest+'.json',textFile:dest+'.txt',
    gates:verdict.counts};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const dbArg=process.argv.find(x=>x.startsWith('--db='));
  const outArg=process.argv.find(x=>x.startsWith('--out='));
  try{
    const result=runIsolatedAcceptance(dbArg?dbArg.slice(5):DEFAULT_COPY,
      outArg?outArg.slice(6):'');
    console.log('V788 只读验收已完成。结果：'+result.status);
    console.log('汇总：'+result.textFile);
    console.log('详细：'+result.jsonFile);
  }catch(error){
    console.error('[V788 验收未完成] '+String(error?.message||error));
    process.exitCode=1;
  }
}
