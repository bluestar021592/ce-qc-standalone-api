import fs from 'node:fs';
import assert from 'node:assert/strict';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
const exporter=fs.readFileSync('src/shopeeTemplateExporter.js','utf8');
const period=fs.readFileSync('src/periodExporter.js','utf8');

assert.match(shell,/function familyComplete\(value=\{\}\)/,'one family completion predicate required');
assert.ok(/completeFamilies=\[ccsl,shopee,whpp\]\.filter\(familyComplete\)\.length/.test(shell)||/completeFamilies=Object\.values\(familyLabels\)\.filter\(label=>label==='完成'\)\.length/.test(shell),'progress and family cards must share completion truth');
assert.match(shell,/completeFamilies\+'\/3 业务完成'/,'completed run must not display 0\/0');
assert.match(shell,/refreshImportCanonicalClassification/,'import classification must refresh from canonical home truth');
assert.match(exporter,/\['每日看板', '全部明细', '金边明细', '外省明细', '门店明细', 'POD明细', '未POD明细', '分配派送中明细', 'Pending明细', '退回明细'\]/,'exact ten-sheet user template contract required');
assert.match(exporter,/总平均签收/,'dashboard must include total average signing days');
assert.match(exporter,/金边平均签收/,'dashboard must include PP average signing days');
assert.match(exporter,/外省平均签收/,'dashboard must include PV average signing days');
assert.match(exporter,/if \(!pod && !returned && !cancelled && !delivery && !pending\) buckets\.notPod\.push\(row\)/,
  'POD/returned/cancelled terminal parcels must not inflate open not-POD after latest saved statuses');
assert.match(exporter,/const DETAIL_HEADERS = \['日期','运单编号','下单时间','状态标识','状态说明','收件省份','区域分类','当前门店','当前省份','收件人','收件人手机','收件地址','派件时间','派件门店','派件省份','派件快递员','异常编码','异常描述','备注'\]/,'detail headers must match supplied workbook');
assert.match(period,/\['CE', 'CEAF', 'TBKH', 'ALI1688', 'WHPP', 'SHOPEECN', 'SHOPEEVN'\]/,'period exporter must cover seven businesses');
assert.match(html,/value="CEAF">CEAF空运/,'report selector must expose CEAF');
assert.match(html,/v625-shell\.js\?v=\d{8}-v\d{3,}-1/,'V650+ JS asset revision missing');
console.log('[V650] unified process-state + canonical WHPP count + user 10-sheet export template contract passed');
