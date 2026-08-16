import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('V159 keeps fresh unified-import classification totals visible on every business board',()=>{
  const source=read('public/v159-current-import-stability.js');
  assert.match(source,/classificationCounts/);
  assert.match(source,/dailyParseSummary:\{totalRecognized:total/);
  assert.match(source,/dashboard=\{pnh:total,totalMonitored:total/);
  assert.match(source,/recipientGroups:\{ALL:\{metrics:all\},CN:\{metrics:cn\},VN:\{metrics:vn\}\}/);
  assert.match(source,/exactBusinessState\(type/);
});

test('V159 V2 force-refreshes exact CE/CEAF/ALI/Shopee result truth after the run completes',()=>{
  const source=read('public/v159-current-import-stability.js');
  assert.match(source,/v159-current-import-stability-v2-result-refresh/);
  assert.match(source,/async function exactBusinessState\(type,options=\{\}\)/);
  assert.match(source,/const force=Boolean\(options\?\.force\)/);
  assert.match(source,/completedSnapshot\(current\)/);
  assert.match(source,/__v159ResultTruthLoaded===true/);
  assert.match(source,/async function refreshAllResultTruth\(\)/);
  assert.match(source,/for\(const type of TYPES\)await exactBusinessState\(type,\{force:true\}\)/);
  assert.match(source,/ce-qc-run-complete/);
  assert.match(source,/refreshAllResultTruth\(\)/);
});

test('V159 makes URL route authoritative and blocks stale WHPP visual activation',()=>{
  const source=read('public/v159-current-import-stability.js');
  assert.match(source,/if\(routeGuardBusy\|\|location\.pathname==='\/whpp'\)return/);
  assert.match(source,/blocked stale WHPP activation/);
  assert.match(source,/whpp\.hidden=true;whpp\.classList\.remove\('active'\)/);
});

test('daily automatic queue stays isolated from historical carry',()=>{
  const source=read('src/v139DailyCarryIsolationPatch.js');
  assert.match(source,/currentOpen:\s*todayOpen/);
  assert.match(source,/historicalSeparate:\s*true/);
  assert.match(source,/historicalCarryInDailyRun:\s*0/);
});

test('managed HTML injects V159 after the legacy business and WHPP scripts',()=>{
  const source=read('src/v44WhppUiPatch.js');
  const legacy=source.indexOf('v132-whpp-seven-business-fast.js');
  const guard=source.indexOf('v159-current-import-stability.js');
  assert.ok(legacy>=0,'V132 WHPP script must remain present');
  assert.ok(guard>legacy,'V159 must load after V132 so it can guard stale async UI activation');
  assert.match(source,/v159-current-import-stability-v1|v159-current-import-stability-v2-result-refresh/);
});
