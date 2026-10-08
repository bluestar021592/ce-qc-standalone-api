import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const accounting=fs.readFileSync(path.join(root,'src','businessAccounting.js'),'utf8');
const integrity=fs.readFileSync(path.join(root,'src','dataIntegrity.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const js=fs.readFileSync(path.join(root,'public','v625-shell.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','v625-shell.html'),'utf8');

assert.match(accounting,/export function buildCanonicalBusinessAccounting/,'canonical backend accounting missing');
assert.match(accounting,/if\(rowIsPod\(row\)\)/,'POD must be resolved before unprocessed fallback');
assert.match(accounting,/rowsByKind\.unprocessed\.push\(row\)/,'unprocessed remainder bucket missing');
assert.match(accounting,/difference=total-accounted/,'business accounting difference missing');

assert.match(integrity,/sourceCount/,'source count missing from integrity ledger');
assert.match(integrity,/stateMemberCount/,'state membership count missing');
assert.match(integrity,/scanCount/,'scan count missing');
assert.match(integrity,/waitingScan/,'waiting scan count missing');
assert.match(integrity,/missingFromState/,'missing-state count missing');
assert.match(integrity,/safeForDashboard/,'dashboard safety gate missing');
assert.match(integrity,/processingComplete/,'processing-complete gate missing');

assert.match(server,/buildCanonicalBusinessAccounting/,'business endpoint must use canonical backend accounting');
assert.match(server,/app\.get\('\/api\/data-integrity'/,'data integrity endpoint missing');
assert.match(server,/state\.accounting=buildCanonicalBusinessAccounting/,'standard boards must expose backend accounting');
assert.match(server,/accounting=buildCanonicalBusinessAccounting/,'WHPP must expose backend accounting');

assert.match(js,/state\.accounting\?\.rowsByKind\s*\?\s*state\.accounting\s*:\s*\{total:m\.total/,'frontend must prefer backend accounting when the compact state includes canonical rowsByKind');
assert.match(js,/new URLSearchParams\(\{businessType:targetBusiness\}\)/,'deferred business board must scope integrity reads to the selected business');
assert.match(js,/json\('\/api\/data-integrity\?'\+integrityQuery\.toString\(\),10000\)/,'business board must hydrate integrity after compact first paint');
assert.match(js,/待扫描/,'visible waiting-scan signal missing');
assert.match(js,/const dataHealthy=Boolean\(classification\.balanced\)/,'home first paint must use classification conservation only and defer full integrity checks');
assert.match(js,/明细在对应业务看板按需读取/,'home must explain that exact integrity is hydrated only inside selected business board');
assert.match(js,/v628BusinessWorkspaceRows\.length[\s\S]*buildBusinessAccounting\(\{finalRows:v628BusinessWorkspaceRows\},m\)/,'fallback accounting must hydrate from the selected-business workspace only');

assert.match(html,/id="v637HomeIntegrity"/,'home integrity ledger UI missing');
assert.match(html,/id="v637BusinessIntegrity"/,'business integrity ledger UI missing');
assert.match(html,/v625-shell\.js\?v=\d{8}-v\d{3,}-1/,'V637+ JS cache bust missing');
assert.match(html,/v625-shell\.css\?v=\d{8}-v\d{3,}-1/,'V637+ CSS cache bust missing');

console.log('[V637] conservation hard gate passed: canonical backend accounting retained, home no longer blocks on full integrity, selected business hydrates scoped integrity/workspace on demand');
