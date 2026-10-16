import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const home=fs.readFileSync(path.join(root,'src','homeQualitySummary.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const js=fs.readFileSync(path.join(root,'public','v625-shell.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','v625-shell.html'),'utf8');

assert.match(home,/function ledgerEvidenceForBills\(bills=\[\]\)/,'strict local timing ledger fallback missing');
assert.match(home,/function strictLedgerTiming\(row=\{\}\)/,'strict ledger timing truth missing');
assert.match(home,/\/\^V246_STRICT_TRACK\/i/,'ledger timing must accept only strict START evidence');
assert.match(home,/pushEvidenceRows\(result,core,'track_events'\)/,'core saved track evidence missing');
assert.match(home,/pushEvidenceRows\(result,business,'business_track_events'\)/,'business saved track evidence missing');
assert.match(home,/sourceCounts:usable\.reduce/,'timing evidence provenance counts missing');

assert.match(server,/function localTrackEvidence\(shipmentCodes=\[\]/,'local track evidence reader missing');
assert.match(server,/function ledgerAsTrackEvents\(rows=\[\]\)/,'ledger-to-track evidence bridge missing');
assert.match(server,/if\(!auth\.hasAccessToken\)[\s\S]*localEvents\.length/,'local evidence must remain readable if CE remote auth is unavailable');
assert.match(server,/requestedBusinessType/,'track query must preserve exact seven-business context');

assert.match(js,/function buildBusinessAccounting\(state=\{\},fallback=\{\}\)/,'exclusive business accounting missing');
// V788: returns are valid only for WHPP/Shopee and a TMS 80 is a
// separate unfinished-return bucket; the old chain may not force every
// business to own a hidden returned bucket.
const start=js.indexOf('function buildBusinessAccounting(');
const end=js.indexOf('\\nfunction v628MetricRows(',start);
assert.ok(start>=0&&end>start,'business accounting must precede KPI drilldown');
const classify=js.slice(start,end);
for(const fragment of [
  "if(rowHasTmsConflict(row))rowsByKind.unprocessed.push(row)",
  "else if(!returnCapable&&(rowIsReturning(row)||rowIsReturned(row)))rowsByKind.unprocessed.push(row)",
  "else if(returnCapable&&rowIsReturning(row))rowsByKind.returning.push(row)",
  "else if(rowIsPod(row))rowsByKind.pod.push(row)",
  "else if(returnCapable&&rowIsReturned(row))rowsByKind.returned.push(row)",
  "else if(rowIsPending(row))rowsByKind.pending.push(row)",
  "else if(rowIsAbnormal(row))rowsByKind.abnormal.push(row)",
  "else if(rowIsOtherNormal(row))rowsByKind.otherNormal.push(row)",
  "else rowsByKind.delivery.push(row)"
])assert.ok(classify.includes(fragment),'exclusive business accounting step missing: '+fragment);
assert.match(classify,/const accounted=\\['pod','returned','returning','pending','abnormal','otherNormal','delivery','unprocessed'\\]\\.reduce/,
  'business accounting must conserve disjoint status buckets');
assert.match(js,/v631AccountingMeta/,'visible conservation audit missing');
assert.match(js,/businessType='\+encodeURIComponent\(business\)/,'drilldown links must carry exact business type');
assert.match(js,/function renderTimingMissing\(type\)/,'missing-timing drilldown renderer missing');
assert.match(js,/data-timing-missing/,'missing-timing controls must bind');

for(const value of ['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'])assert.ok(html.includes(`<option value="${value}"`),`tracking selector missing ${value}`);
assert.match(html,/id="v631AccountingMeta"/,'accounting audit UI missing');
assert.match(html,/id="v631TimingMissingPanel"/,'timing missing evidence panel missing');
assert.match(html,/v625-shell\.js\?v=\d{8}-v\d{3,}-1/,'V631+ JS cache bust missing');
assert.match(html,/v625-shell\.css\?v=\d{8}-v\d{3,}-1/,'V631+ CSS cache bust missing');

const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const dupes=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
assert.deepEqual(dupes,[],'duplicate DOM ids: '+dupes.join(', '));


const assetBuild=Number((html.match(/v625-shell\.js\?v=\d{8}-v(\d{3,})-1/)||[])[1]||0);
assert.ok(assetBuild>=631,'asset cache build must not predate V631');
console.log('[V631] traceable status accounting + local track evidence + strict timing provenance smoke passed');
