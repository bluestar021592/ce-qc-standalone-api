import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const syntax=file=>{const result=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});assert.equal(result.status,0,`${file}: ${result.stderr||result.stdout}`);};

test('V145 backend tracks explicit API failures across all seven businesses',()=>{
  syntax('src/v145SevenBusinessRetryCenterPatch.js');
  const source=read('src/v145SevenBusinessRetryCenterPatch.js');
  assert.match(source,/v145-seven-business-retry-center-v1/);
  for(const type of ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP']) assert.match(source,new RegExp(type));
  assert.match(source,/API_PENDING_RETRY/);
  assert.match(source,/API_RETRY_EXHAUSTED/);
  assert.match(source,/roundSizes=\[25,10,5,1\]/);
  assert.match(source,/attempt<3/);
  assert.match(source,/transientRetries:3/);
  assert.match(source,/\/api\/v145\/retry-center/);
  assert.match(source,/updateCarryoverResults/);
  assert.match(source,/setImmediate/);
});

test('V145 UI fills the import-side gap and exposes one retry center for seven businesses',()=>{
  syntax('public/v141-whpp-retry-isolation-ui.js');
  const ui=read('public/v141-whpp-retry-isolation-ui.js');
  assert.match(ui,/v145-seven-business-retry-center-v1/);
  assert.match(ui,/七业务接口失败 \/ 失效重试中心/);
  assert.match(ui,/importPanel\(\)/);
  assert.match(ui,/#importPage #unifiedImport/);
  assert.match(ui,/align-items:stretch!important/);
  assert.match(ui,/普通未POD和普通跨日遗留不会进入这里/);
  assert.match(ui,/\/api\/v145\/retry-center/);
  assert.match(ui,/\/api\/v143\/whpp-retry-queue/);
  assert.match(ui,/重新登录CE并继续重试/);
});

test('V145 is installed in the managed UI bootstrap and is cache-busted',()=>{
  const injector=read('src/v44WhppUiPatch.js');
  assert.match(injector,/import '\.\/v145SevenBusinessRetryCenterPatch\.js'/);
  assert.match(injector,/v145-seven-business-retry-center-v1/);
  assert.match(injector,/v141-whpp-retry-isolation-ui\.js\?v=20260816-7/);
});
