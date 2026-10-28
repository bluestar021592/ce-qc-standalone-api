import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync('public/v625-shell.html','utf8');
const js=fs.readFileSync('public/v625-shell.js','utf8');
const css=fs.readFileSync('public/v792-reference-ui.css','utf8');
const server=fs.readFileSync('server.js','utf8');

assert.match(html,/v792-reference-ui\.css\?v=/);
assert.match(html,/id="v792HomeManagement"/);
assert.match(html,/id="v792WhppAnalysis"/);
assert.match(html,/id="v792WhppTables"/);
assert.match(html,/id="v792WhppAnomalyRows"/);
assert.match(html,/id="v792WhppReturnedRows"/);
assert.match(css,/grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
assert.match(css,/grid-template-columns:repeat\(8,minmax\(0,1fr\)\)/);
assert.match(js,/function v792ApplyReferenceLayout\(\)/);
assert.match(js,/overview\.after\(top\);top\.append\(process,status,quick,logs\)/);
assert.match(js,/bottom\.append\(timing,open\)/);
assert.match(js,/v792ApplyReferenceLayout\(\);\s*bind\(\);/);
assert.match(js,/if\(business==='WHPP'\)v792RenderWhppDetails/);
assert.match(js,/function v792WhppStatusDonut\(m=\{\}\)/);
assert.match(js,/v792LoadWhppTrend\(reportDate\)/);
assert.match(server,/app\.get\('\/api\/v792\/whpp\/trend'/);
assert.match(server,/WHERE d\.businessType='WHPP'/);
assert.match(server,/f\.businessType='WHPP' AND f\.reportDate=d\.reportDate/);
assert.match(server,/pod=count!==null&&final===count\?Number\(record\.savedPod\|\|0\):null/);
assert.doesNotMatch(js,/CC06072602913.*(?:166|190)/,
  'reference screenshot and CEAF regression sample must not create fake metrics');
console.log('[V792] reference home/WHPP structure and verified seven-day chart bindings PASS');
