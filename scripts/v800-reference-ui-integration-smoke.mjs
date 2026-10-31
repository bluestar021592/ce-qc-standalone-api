import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync('public/v625-shell.html','utf8');
const js=fs.readFileSync('public/v625-shell.js','utf8');
const css=fs.readFileSync('public/v792-reference-ui.css','utf8');
const server=fs.readFileSync('server.js','utf8');
const file=fs.readFileSync('src/whppCanonicalTruth.js','utf8');

assert.match(html,/<link rel="stylesheet" href="\/v792-reference-ui.css\?v=20261031-v800-1">\s*<link rel="stylesheet" href="\/v801-home-layout.css\?v=20261031-v801-1">\s*<\/head>/);
assert.match(html,/v625-shell\.js\?v=20261031-v802-1&patch=802/);
for(const id of ['v792HomeManagement','v792WhppAnalysis','v792WhppTables',
  'v792WhppOverall','v792WhppPP','v792WhppPV','v792WhppFirst',
  'v792WhppSecond','v792WhppThird','v792WhppReturnCount','v792WhppReturnRate',
  'v792WhppAnomalyRows','v792WhppReturnedRows','v792WhppReturnReasons']){
  assert.equal(html.split('id="'+id+'"').length-1,1,'unique UI id '+id);
}
for(const id of ['v788FormalReadinessPanel','v788ReadOnlyAuditStart',
  'v788WhppEvidenceStart','v788KpiDetailPrevious','v788KpiDetailNext'])
  assert.ok(html.includes('id="'+id+'"'),'must preserve real-data audit/pagination '+id);
assert.match(html,/id="kpiReturnRateCard"[^>]*data-kpi-detail="returned"/);
assert.match(js,/function v800ApplyReferenceLayout\(\)/);
assert.match(js,/v800ApplyReferenceLayout\(\);\s*bind\(\);/);
assert.match(js,/overview\.after\(top\);top\.append\(process,status,quick,logs\)/);
assert.match(js,/bottom\.append\(timing\);bottom\.after\(open\)/);
assert.match(js,/total\.classList\.add\('v792-total-summary'\)/);
assert.match(js,/v800SetWhppMetrics\(m,timing\)/);
assert.match(js,/v800RenderWhppDetails\(v628BusinessWorkspaceRows/);
assert.match(js,/v800LoadWhppTrend\(reportDate\)/);
assert.match(js,/if\(point\[key\]===null\|\|point\[key\]===undefined\)/);
assert.match(js,/row\.latestTime\|\|row\.lastEventTime\|\|'—'/);
assert.doesNotMatch(js,/row\.latestTime\|\|row\.lastEventTime\|\|row\.lastCheckedAt/,
  'query/check time is not a verified last tracking event');
assert.match(js,/businessType=WHPP&reportDate='\+encodeURIComponent\(v628BusinessReportDate\)/);
assert.match(css,/font-family:"Microsoft YaHei"/);
assert.doesNotMatch(css,/#kpiOtherCard,\s*\n[^{]*#kpiUnprocessedCard\{display:none!important\}/);
assert.doesNotMatch(css,/\.v632-total-card\{display:none\}/);
assert.match(server,/app\.get\('\/api\/v800\/whpp\/trend'/);
assert.match(server,/loadWhppCanonicalTruth\(d,'',db\)/);
assert.match(server,/returnReason:String\(row\.returnReason \|\| row\.退回原因 \|\| row\.退件原因 \|\| ''\)\.trim\(\)/);
assert.match(file,/export function loadWhppCanonicalTruth/);
assert.match(server,/pod:hasEvidence\?Number\(truth\.evidence\?\.podRows\|\|0\):null/);
assert.match(server,/fullyVerified:covered===total/);
assert.match(server,/res\.setHeader\('Cache-Control','private, no-store'\)/);
for(const tab of ['clear','backup','storage'])
  assert.ok(html.includes('/data-management?auth=v625&tab='+tab),'deep link '+tab);
assert.match(js,/switchDataTab\(\['clear','backup','storage'\]\.includes\(requestedTab\)\?requestedTab:'clear'\)/);
assert.match(html,/id="v626OpenPodRows"/);
assert.match(html,/id="v625BusinessRows"/);
console.log('[V800/V801_UI] PASS: home/WHPP reference, protected V788 controls, same-day links, real null-gap trend and brand layout');
