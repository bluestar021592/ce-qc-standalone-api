import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=fs.readFileSync(path.join(root,'public','v625-shell.html'),'utf8');
const js=fs.readFileSync(path.join(root,'public','v625-shell.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public','v625-shell.css'),'utf8');

assert.match(html,/data-card="TOTAL"/,'home overview total card missing');
assert.match(html,/id="v632GrandTotal"/,'total-card value target missing');
assert.match(html,/id="v632GrandTotalCheck"/,'seven-business reconciliation target missing');

const totalPos=html.indexOf('data-card="TOTAL"');
const cePos=html.indexOf('data-card="CE"');
assert.ok(totalPos>=0&&cePos>totalPos,'total card must be the first home overview card');

assert.match(js,/const sevenBusinessTotal=types\.reduce\(\(sum,type\)=>sum\+Number\(counts\[type\]\|\|0\),0\)/,'total card must sum the exact seven business counts');
assert.match(js,/const grand=Number\(classification\.total\|\|sevenBusinessTotal\|\|0\)/,'total card must use authoritative classification total with seven-business fallback');
assert.match(js,/setText\('v632GrandTotal',fmt\(grand\)\)/,'total card display binding missing');
assert.match(js,/setText\('v632GrandTotalCheck',fmt\(sevenBusinessTotal\)\)/,'seven-business reconciliation display missing');
assert.match(js,/grand!==sevenBusinessTotal/,'total card must visibly flag conservation mismatch');

assert.match(css,/grid-template-columns:repeat\(8,minmax\(128px,1fr\)\)/,'desktop home overview must support total + seven business cards');
assert.match(css,/\.tone-total/,'total card visual tone missing');
assert.match(css,/\.v632-total-mismatch/,'total-card mismatch visual guard missing');
assert.match(html,/v625-shell\\.js\\?v=\\d{8}-v6\\d{2}-1/,'V632+ JS cache bust missing');
assert.match(html,/v625-shell\\.css\\?v=\\d{8}-v6\\d{2}-1/,'V632+ CSS cache bust missing');

const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const dupes=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
assert.deepEqual(dupes,[],'duplicate DOM ids: '+dupes.join(', '));


const assetBuild=Number((html.match(/v625-shell\\.js\\?v=\\d{8}-v(6\\d{2})-1/)||[])[1]||0);
assert.ok(assetBuild>=632,'asset cache build must not predate V632');
console.log('[V632] home total-card UI + seven-business conservation gate passed');
