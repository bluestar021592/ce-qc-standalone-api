import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const js=fs.readFileSync(path.join(root,'public','v625-shell.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','v625-shell.html'),'utf8');

assert.match(js,/function buildWhppCanonicalAccounting\(state=\{\},fallback=\{\}\)/,'WHPP canonical accounting builder missing');
assert.match(js,/const pod=uniqueDetailRows\(\[/,'WHPP POD merges canonical direct TMS 60 evidence with the backend POD bucket');
assert.match(js,/excludeReturning\(tabs\?\.pod\?\.rows\)\.filter\(row=>allowedTerminal\(row,'60'\)\)/,'stale POD detail entries must respect the canonical TMS status');
assert.match(js,/const returned=uniqueDetailRows\(\[/,'WHPP returned merges canonical direct TMS 81 evidence with the backend return bucket');
assert.match(js,/excludeReturning\(tabs\?\.returned\?\.rows\)\.filter\(row=>allowedTerminal\(row,'81'\)\)/,'stale returned detail entries must respect the canonical TMS status');
assert.match(js,/const returning=uniqueDetailRows\(/,'WHPP TMS status 80 must be disjoint from completed returns');
assert.match(js,/rowHasTmsConflict\(row\)\)\{unprocessed\.push\(row\)/,'unresolved terminal contradictions must not be classed as normal');
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
