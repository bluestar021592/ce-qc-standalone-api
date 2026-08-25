const fs=require('fs');
const assert=require('assert/strict');
const css=fs.readFileSync('public/dashboard-v18.css','utf8');
const owner=fs.readFileSync('public/v253-dashboard-fast-owner.js','utf8');

assert.match(css,/V292: density-first dashboard layout/,'V292 density rules must remain identifiable');
assert.match(css,/\.v18-mid-grid:has\(> :only-child\)\{grid-template-columns:minmax\(0,1fr\)!important\}/,'single mid-grid panel must consume the full row');
assert.match(css,/\.v18-chart-grid:has\(> \.v18-chart-card:first-child:last-child\)\{grid-template-columns:minmax\(0,1fr\)!important\}/,'one chart must fill the full chart row');
assert.match(css,/\.v18-chart-grid:has\(> \.v18-chart-card:nth-child\(2\):last-child\)\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important\}/,'two charts must split the full row 50/50');
assert.match(css,/\.v18-chart-grid:has\(> \.v18-chart-card:nth-child\(3\):last-child\)\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important\}/,'three charts must split the full row into thirds');
assert.match(css,/\.v18-chart-grid:has\(> \.v18-chart-card:nth-child\(4\):last-child\)\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important\}/,'four charts must retain the canonical four-column row');
assert.match(css,/\[data-v291-home-attempts="1"\] \.v18-chart-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important\}/,'home CN/VN attempt charts must occupy the complete row');
assert.match(css,/\.v18-dispatch-grid:has\(> :nth-child\(2\):last-child\)\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/,'two dispatch blocks must not reserve two empty columns');
assert.match(css,/@media\(max-width:720px\)[\s\S]*grid-template-columns:minmax\(0,1fr\)!important/,'mobile density must collapse to one full-width column');
assert.match(owner,/dataset\.v291HomeAttempts='1'/,'V291 home attempt section must expose the density hook');
assert.doesNotMatch(css,/\.brand|\.sidebar|\.side-logo|\.logo-area/,'V292 density patch must not touch permanent CE brand/sidebar layout');

console.log('[V292] dashboard density smoke passed · 1/2/3/4 modules consume 100% row width · home SHOPEE special and CN/VN attempt panels no longer leave empty tracks');
