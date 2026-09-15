import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

const lazy=read('public/v108-route-lazy-features.js');
assert.match(lazy,/2026-09-15-v544-purge-entry-owner-race-v1/,'V544 route-lazy revision must be active');
assert.match(lazy,/v505-data-purge-recovery\.js\?v=20260915-v544-1/,'V544 must cache-bust the authoritative V505 purge UI owner');
assert.match(lazy,/\[onclick\*="openDataPurge"\]/,'V544 must identify purge-entry controls before inline onclick runs');
assert.match(lazy,/event\.preventDefault\(\);[\s\S]*?event\.stopImmediatePropagation\(\)/,'V544 capture listener must suppress the legacy synchronous purge handler');
assert.match(lazy,/async function invokePurgeOwner\(\)[\s\S]*?await loadGroup\('data'\)[\s\S]*?__CE_QC_V505_DATA_PURGE_RECOVERY__\?\.openDataPurge/,'V544 must finish loading V505 before invoking purge');
assert.match(lazy,/document\.addEventListener\('click',[\s\S]*?,true\);/,'V544 purge interception must run in capture phase');
assert.doesNotMatch(lazy,/v104-fast-purge-ui\.js/,'retired competing purge owner must stay absent');

const app=read('public/app.js');
assert.match(app,/正在创建并校验清空前备份/,'fixture must still expose the legacy handler text that V544 prevents from being entered');
assert.match(app,/purgeChallenge = await api\('\/api\/admin\/data-purge\/prepare'/,'legacy direct PREPARE path must be recognized by this regression guard');

function walk(dir){
  const out=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())out.push(...walk(full));
    else if(/\.(?:js|mjs|cjs|html)$/i.test(entry.name))out.push(full);
  }
  return out;
}
const productionCandidates=[path.join(root,'bootstrap.js'),path.join(root,'server.js'),...walk(path.join(root,'src')),...walk(path.join(root,'public'))];
const deliveryOwners=productionCandidates
  .filter(file=>path.basename(file)!=='v108-route-lazy-features.js')
  .filter(file=>fs.readFileSync(file,'utf8').includes('v108-route-lazy-features.js'));
assert.ok(deliveryOwners.length>0,'V544 requires v108-route-lazy-features.js to be delivered by the production runtime');

console.log(`[V544] purge entry owner smoke passed · capture-phase gate blocks legacy direct PREPARE until V505 is loaded · deliveryOwner=${deliveryOwners.map(file=>path.relative(root,file)).join(',')}`);
