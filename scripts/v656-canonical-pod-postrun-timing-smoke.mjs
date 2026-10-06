import fs from 'node:fs';
import assert from 'node:assert/strict';

const repair=fs.readFileSync('src/selectedDateTimingEvidenceRepair.js','utf8');
const summary=fs.readFileSync('src/homeQualitySummary.js','utf8');
const server=fs.readFileSync('server.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(repair,/export function selectedDatePodBills/,'one canonical POD membership owner required');
assert.match(summary,/selectedDatePodBills/,'home timing must reuse repair POD membership');
assert.match(summary,/canonicalPodSet\.has\(shipmentCode\)/,'canonical repair POD member must count in timing denominator');
assert.match(server,/\/api\/timing-repair\/start/,'explicit post-processing timing repair trigger missing');
assert.match(shell,/WHPP待处理，请点击“继续未完成处理”/,'2-of-3 UI must state the exact next action');
assert.match(shell,/post\('\/api\/timing-repair\/start'/,'3-family completion must start timing repair');
assert.match(html,/v625-shell\.js\?v=20261005-v6(?:5[6-9]|[6-9]\\d)-1/,'V656+ JS revision missing');
console.log('[V656] canonical POD timing denominator + explicit post-run repair trigger + actionable 2-of-3 UI passed');
