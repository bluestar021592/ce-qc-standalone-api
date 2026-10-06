import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const js=fs.readFileSync(path.join(root,'public','v625-shell.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','v625-shell.html'),'utf8');

assert.match(js,/function buildWhppCanonicalAccounting\(state=\{\},fallback=\{\}\)/,'WHPP canonical accounting builder missing');
assert.match(js,/const pod=uniqueDetailRows\(tabs\?\.pod\?\.rows\|\|\[\]\)/,'WHPP POD must come from backend POD detail bucket');
assert.match(js,/const returned=uniqueDetailRows\(tabs\?\.returned\?\.rows\|\|\[\]\)/,'WHPP returned bucket missing');
assert.match(js,/const otherNormal=uniqueDetailRows\(\[\.\.\.cancelled,\.\.\.normalDiversion,\.\.\.shops\]\)/,'WHPP other-normal bucket must merge backend normal destinations');
assert.match(js,/else unprocessed\.push\(row\)/,'unclassified WHPP remainder must be explicit');
assert.match(js,/business==='WHPP'\?buildWhppCanonicalAccounting\(state,m\):buildBusinessAccounting\(state,m\)/,'WHPP must bypass generic frontend reclassification');
assert.match(js,/renderDonut\(\{total:a\.total,delivery:counts\.delivery\|\|0,pod:counts\.pod\|\|0/,'WHPP donut must use same canonical accounting');
assert.match(html,/id="kpiUnprocessedCard"/,'WHPP explicit remainder card missing');
assert.match(html,/v625-shell\.js\?v=\d{8}-v6\d{2}-1/,'V636+ JS cache bust missing');
assert.match(html,/v625-shell\.css\?v=\d{8}-v6\d{2}-1/,'V636+ CSS cache bust missing');


const assetBuild=Number((html.match(/v625-shell\.js\?v=\d{8}-v(6\d{2})-1/)||[])[1]||0);
assert.ok(assetBuild>=636,'asset cache build must not predate V636');
console.log('[V636] WHPP backend canonical buckets drive KPI, drilldown, donut, and conservation');
