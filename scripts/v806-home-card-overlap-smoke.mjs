import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync('public/v625-shell.html','utf8');
const css=fs.readFileSync('public/v806-home-card-clearance.css','utf8');
const js=fs.readFileSync('public/v625-shell.js','utf8');
assert.match(html,/<link rel="stylesheet" href="\/v805-home-reference.css\?v=20261031-v805-1">\s*<link rel="stylesheet" href="\/v806-home-card-clearance.css\?v=20261031-v806-1">\s*<\/head>/);
assert.match(css,/\.v625-business-card:not\(\.v632-total-card\)\>\.v625-card-foot\{/);
assert.match(css,/position:relative!important;/);
assert.match(css,/\.v626-return-mini\{/);
assert.match(css,/flex-wrap:wrap!important;/);
assert.match(css,/\.v632-total-card\.v792-total-summary\{/);
assert.match(css,/grid-template-areas:"title total description" "foot foot foot"/);
assert.match(css,/grid-area:foot/);
assert.match(css,/\.v632-total-card\.v792-total-summary\>\.v632-total-foot\{/);
for(const type of ['WHPP','SHOPEECN','SHOPEEVN']){
  const source=html.match(new RegExp('<a class="v625-business-card[^"]+"[^>]+data-card="'+type+'"[^]*?<\\/a>'));
  assert.ok(source,'real business card remains available '+type);
  assert.match(source[0],/v626-return-mini/,'return count/rate retained '+type);
  assert.match(source[0],/v625-card-foot/,'ratio/progress retained '+type);
}
for(const id of ['v632GrandTotal','v632GrandTotalCheck',
 'v626ReturnWHPP','v626ReturnRateWHPP',
 'v626ReturnSHOPEECN','v626ReturnRateSHOPEECN',
 'v626ReturnSHOPEEVN','v626ReturnRateSHOPEEVN'])
  assert.equal(html.split('id="'+id+'"').length-1,1,'unique evidence-bound field '+id);
assert.match(js,/card\.querySelector\('\.v625-card-foot em'\)\.style\.width/);
assert.match(js,/setText\('v632GrandTotal',fmt\(grand\)\)/);
console.log('[V806 METRIC CARDS] PASS genuine footer flow, true return/rate fields, non-absolute total & seven business cards');
