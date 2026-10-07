import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const js=fs.readFileSync(path.join(root,'public','v625-shell.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','v625-shell.html'),'utf8');

assert.match(js,/function buildWhppCanonicalAccounting\(state=\{\},fallback=\{\}\)/,'WHPP canonical accounting builder missing');
assert.match(js,/const pod=uniqueDetailRows\(tabs\?\.pod\?\.rows\|\|\[\]\)/,'WHPP POD must come from backend POD detail bucket');
assert.match(js,/const returned=uniqueDetailRows\(tabs\?\.returned\?\.rows\|\|\[\]\)/,'WHPP returned bucket missing');
assert.match(js,/const otherNormal=uniqueDetailRows\(\[\.\.\.cancelled,\.\.\.normalDiversion,\.\.\.shops\]\)/,'WHPP other-normal bucket must merge backend normal destinations');
assert.match(js,/else unprocessed\.push\(row\)/,'unclassified WHPP remainder must be explicit');
assert.match(server,/requestedType === 'WHPP' && req\.query\.compact === '1'[\s\S]*buildCanonicalBusinessAccounting\(source,'WHPP'\)/,'WHPP compact first paint must use backend canonical accounting');
assert.match(js,/state\.accounting\?\.rowsByKind\s*\?\s*state\.accounting/,'frontend must consume backend WHPP canonical accounting before any fallback');
assert.match(js,/renderDonut\(\{total:m\.total,delivery:m\.delivery\|\|0,pod:m\.pod\|\|0/,'WHPP first-paint donut must use compact backend metrics while canonical accounting hydrates');
assert.match(html,/id="kpiUnprocessedCard"/,'WHPP explicit remainder card missing');
assert.match(html,/v625-shell\.js\?v=\d{8}-v\d{3,}-1/,'V636+ JS cache bust missing');
assert.match(html,/v625-shell\.css\?v=\d{8}-v\d{3,}-1/,'V636+ CSS cache bust missing');


const assetBuild=Number((html.match(/v625-shell\.js\?v=\d{8}-v(\d{3,})-1/)||[])[1]||0);
assert.ok(assetBuild>=636,'asset cache build must not predate V636');
console.log('[V636] WHPP compact route owns canonical backend accounting; frontend consumes it without generic first-paint reclassification');
