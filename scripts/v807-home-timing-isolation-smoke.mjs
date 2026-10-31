import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync('server.js','utf8');
const worker=fs.readFileSync('src/v766HeavyReadWorker.mjs','utf8');
const coordinator=fs.readFileSync('src/v766ReadJobCoordinator.js','utf8');
const summary=fs.readFileSync('src/homeQualitySummary.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

// This is a contract regression, not a fake live-DB acceptance. An exact
// report-date/snapshot remains mandatory, and users must never see invented
// time or 0 POD when a worker errors, times out or returns an old snapshot.
assert.match(server,/app\.get\('\/api\/home-timing-summary'/);
assert.match(server,/HOME_TIMING_BUSINESS_TYPE_INVALID/);
assert.match(server,/v766ReadJob\('HOME_TIMING',\{reportDate,snapshotId,businessType\}\)/);
assert.match(worker,/businessType:message\.businessType\|\|''/);
assert.match(coordinator,/cacheKey\(kind,args\).*String\(args\.businessType\|\|''\)/);
assert.match(summary,/buildSelectedDateTimingProjection\(\{reportDate='',snapshotId='',businessType=''\}/);
assert.match(summary,/selectedTypes=type\?\[type\]:TIMING_TYPES/);
assert.match(summary,/businessType:type,source:'EXACT_SELECTED_DAY_SAVED_TIMING'/);
assert.match(summary,/if\(type&&!TIMING_TYPES\.includes\(type\)\)/);
assert.match(shell,/const timingTypes=\['WHPP','SHOPEEVN','SHOPEECN','TBKH'\]/);
assert.match(shell,/businessType='\+encodeURIComponent\(type\)/);
assert.match(shell,/String\(payload\?\.businessType\|\|''\)!==type/);
assert.match(shell,/const timing=\{\.\.\.base\}/);
assert.match(shell,/for\(const type of types\.filter\(item=>Object\.prototype\.hasOwnProperty\.call\(incoming,item\)\)\)/);
assert.match(shell,/签收时效已读取 '\+loaded\.length\+'\/'\+types\.length/);
assert.match(shell,/可信POD读取失败；本次无可核验结果/);
assert.match(shell,/正在读取该日报可信POD/);
for(const type of ['TBKH','WHPP','SHOPEECN','SHOPEEVN']){
  for(const suffix of ['Overall','Pod','PP','PV']){
    assert.equal(html.split('id="v625Timing'+type+suffix+'"').length-1,1,
      'must preserve original '+type+' '+suffix+' display binding');
  }
}
assert.match(shell,/v803MergeFullWithExactTiming\(summary\?\.timing\|\|\{\}/);
assert.match(server,/X-CE-QC-Read-Cache/);
console.log('[V807 HOME TIMING] PASS business-isolated read worker keys, full-route compatibility, exact-date guard, truthful loading/timeout UI, and original four card IDs');
