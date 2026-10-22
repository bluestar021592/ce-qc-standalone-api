// V788 record viewer: offline, pure aggregate, no database/network/user credential/writes.
// Zero exit status is intentionally never granted by this viewer: publishing
// and deleting data require an entirely separate authenticated process.
import fs from 'node:fs';
import path from 'node:path';
import {evaluateV788EvidenceReport} from '../src/v788OfflineEvidenceGate.js';

const suggestedFile=process.platform==='win32'
  ?path.win32.join('D:\\CE_QC_V788_验收副本','V788_只读验收结果.json')
  :'';
const reportFile=process.argv[2]||process.env.V788_READONLY_REPORT_FILE||suggestedFile;
const say=(text)=>process.stdout.write(String(text)+'\n');
say('CE QC V788 | 历史验收记录只读查看（不会触发扫描、数据清空或正式升级）');
if(!reportFile) {
  say('BLOCKED：未指定只读验收记录，非 Windows 运行请提供报告路径。');
  process.exitCode=10;
} else {
  try {
    const file=path.resolve(reportFile), info=fs.lstatSync(file);
    if(!info.isFile()||info.isSymbolicLink()||info.size<=0||info.size>2*1024*1024)
      throw new Error('INVALID_REPORT_FILE');
    const raw=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
    const parsed=JSON.parse(raw);
    const result=evaluateV788EvidenceReport(parsed);
    say('验收报告日期：'+(result.summary.reportGeneratedAt||'未知'));
    say('来源：本地只读记录，不代表本次重新查询了TMS接口或正式数据库。');
    say('WHPP 来源票数：'+(result.summary.whppMembers??'待核实'));
    say('POD 标签：'+(result.summary.podLabels??'待核实')
      +'；退回标签：'+(result.summary.returnedLabels??'待核实')
      +'；仍处于OPEN的终态标签：'+(result.summary.openLedgerOnLabeledTerminal??'待核实'));
    say('可信POD时间：'+(result.summary.trustedPodTimes??'待核实')+'/'+(result.summary.podLabels??'待核实'));
    for(const item of result.checks)
      say('['+item.status+'] '+item.id+' - '+item.detail);
    say('验收检查：通过 '+result.counts.pass+' / 阻断 '+result.counts.blocked
      +' / 待核验 '+result.counts.review);
    say('发布决策：'+result.releaseDecision);
    say('正式系统5177：不得据此发布、清空或重新导入。');
    // Always fail closed: a record viewer is never a deploy/purge gate.
    process.exitCode=10;
  }catch{
    say('BLOCKED：读取验收记录失败或文件缺失，未修改任何文件。');
    say('检查位置：'+reportFile);
    say('不得据此清空正式数据。');
    process.exitCode=10;
  }
}
