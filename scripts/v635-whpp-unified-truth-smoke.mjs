import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const home=fs.readFileSync(path.join(root,'src','homeQualitySummary.js'),'utf8');
const js=fs.readFileSync(path.join(root,'public','v625-shell.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','v625-shell.html'),'utf8');

assert.match(home,/function dedicatedWhppCount\(reportDate=''/,'dedicated WHPP home count resolver missing');
assert.match(home,/if\(whppDedicated>0\)counts\.WHPP=whppDedicated/,'home WHPP must use dedicated WHPP membership when available');
assert.match(home,/const total=classified>0\?classified:sourceTotal/,'home grand total must reconcile all seven displayed businesses');
assert.match(home,/loadWhppCanonicalTruth\(reportDate,snapshotId\|\|''\)/,'WHPP timing must use canonical WHPP truth');
assert.match(home,/whpp_recovered_snapshot/,'WHPP timing must accept exact-member recovered snapshot track evidence');
assert.match(home,/if\(businessType==='WHPP'&&batch\?\.reportDate\)/,'WHPP return summary must use dedicated WHPP dashboard');

assert.match(js,/state\?\.detailTabs\?\.all\?\.rows/,'business accounting must prefer complete authoritative daily members');
assert.match(js,/row\.finalRowAvailable===false\)rowsByKind\.unprocessed\.push\(row\)/,'unprocessed members must be explicit');
assert.match(js,/v631AccountingMeta/,'status conservation display must remain active');
assert.match(html,/id="kpiUnprocessedCard"/,'explicit unprocessed card missing');
assert.match(html,/data-kpi-detail="unprocessed"/,'unprocessed detail drilldown missing');
assert.match(html,/v625-shell\.js\?v=20261005-v63[567]-1/,'V635 JS cache bust missing');
assert.match(html,/v625-shell\.css\?v=20261005-v63[567]-1/,'V635 CSS cache bust missing');

console.log('[V635] dedicated WHPP home/timing/returns + complete status accounting smoke passed');
