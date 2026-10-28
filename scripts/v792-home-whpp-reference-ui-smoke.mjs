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
assert.doesNotMatch(js,/page[!=]==='business'/,
  'business pages have route keys ce/ceaf/tbkh/ali1688/whpp/shopeecn/shopeevn, never business');
assert.match(js,/const stillSelected=\(\)=>Boolean\(business\)&&business===targetBusiness/,
  'detail lane must run for actual WHPP and other business route keys');
assert.match(js,/overview\.after\(top\);top\.append\(process,status,quick,logs\)/);
assert.match(js,/bottom\.append\(timing,open\)/);
assert.match(js,/technical\.append\(heading,quality,accounting,integrity\)/,
  'WHPP source and quality controls remain accessible below reference charts');
assert.match(js,/v792ApplyReferenceLayout\(\);\s*bind\(\);/);
assert.match(js,/if\(business==='WHPP'\)v792RenderWhppDetails/);
assert.match(js,/function v792WhppStatusDonut\(m=\{\}\)/);
assert.match(js,/v792LoadWhppTrend\(reportDate\)/);
assert.match(js,/buildSegments\('total'\)\+buildSegments\('pod'\)\+buildSegments\('returned'\)/,
  'WHPP source, POD and returned must render from saved trend values');
assert.match(js,/if\(point\[key\]===null\|\|point\[key\]===undefined\)/,
  'missing-day evidence must break trend segments, not plot zero');
assert.match(js,/if\(byId\('v625BoardJump'\)\)byId\('v625BoardJump'\)\.value='\/whpp\?auth=v625'/,
  'WHPP header must select active board');
assert.match(server,/app\.get\('\/api\/v792\/whpp\/trend'/);
assert.match(server,/loadWhppCanonicalTruth\(date,'',db\)/,
  'WHPP trend must use canonical unified/independent/snapshot members');
assert.match(server,/const covered=truth\.rows\.filter\(row=>row\.finalRowAvailable===true\)\.length/);
assert.match(server,/pod:hasEvidence\?verifiedPod:null/,
  'missing POD evidence is null, never fabricated as zero');
assert.match(server,/finalVerified:covered===count/);
assert.match(server,/returned:hasEvidence\?verifiedReturned:null/);
assert.doesNotMatch(js,/CC06072602913.*(?:166|190)/,
  'reference screenshot and CEAF regression sample must not create fake metrics');
console.log('[V792] reference home/WHPP structure and verified seven-day chart bindings PASS');
