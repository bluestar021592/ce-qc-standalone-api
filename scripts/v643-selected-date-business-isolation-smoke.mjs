import fs from 'node:fs';
import assert from 'node:assert/strict';

const store=fs.readFileSync('src/unifiedImportStore.js','utf8');
const js=fs.readFileSync('public/v625-shell.js','utf8');
const css=fs.readFileSync('public/v625-shell.css','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(store,/sourceName:\s*row\.sourceName\s*\|\|\s*''/,'historical unified batch must expose sourceName');
assert.match(css,/\[hidden\]\{display:none!important\}/,'hidden elements must never be forced visible by button display rules');
assert.match(js,/selectedReportDate\(\)\|\|v626LatestImport\?\.reportDate/,'live progress must prefer selected report date');
assert.match(js,/businessType=SHOPEE'\+\(date\?'&reportDate='/,'SHOPEE progress must be date-scoped');
assert.match(js,/const selectedBatch=historyRows\.find/,'home must bind to selected historical batch');
assert.match(js,/v626LatestImport=\{\.\.\.\(v626LatestImport\|\|\{\}\),\.\.\.selectedBatch\}/,'selected batch context must hydrate current report context');
assert.match(js,/processExists\?\(v626LatestImport\?\.sourceName\|\|\('综合日报 '\+processDate\)\):'尚未上传综合日报'/,'existing historical report must not show not-uploaded state');
assert.match(html,/v625-shell\.js\?v=20261005-v643-1/,'V643 JS cache bust missing');
assert.match(html,/v625-shell\.css\?v=20261005-v643-1/,'V643 CSS cache bust missing');

console.log('[V643] selected-report progress binding + business-action isolation smoke passed');
