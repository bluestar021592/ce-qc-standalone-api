// Offline aggregate report only. No network, SQLite, user credentials or writes.
import fs from 'node:fs';
import {evaluateV788EvidenceReport} from '../src/v788OfflineEvidenceGate.js';
const source=process.argv[2];
if(!source) {
  console.error('用法: node scripts/v788-offline-release-review.mjs <V788_只读验收结果.json>');
  process.exitCode=2;
} else {
  try {
    const input=JSON.parse(fs.readFileSync(source,'utf8'));
    const result=evaluateV788EvidenceReport(input);
    console.log(JSON.stringify(result,null,2));
    process.exitCode=result.evidenceReadyForManualReview?0:10;
  } catch (error) {
    console.error('BLOCKED: 无法读取或解析只读验收报告；未修改任何数据库或文件。');
    process.exitCode=10;
  }
}
