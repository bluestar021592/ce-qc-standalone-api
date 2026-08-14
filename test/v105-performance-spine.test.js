import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

for(const relative of ['src/v105AsyncPurgePatch.js','public/v104-fast-purge-ui.js','public/v105-fast-render.js','src/v84AsyncExportPatch.js','src/v89StaticAssetCachePatch.js','src/v55DashboardReconciliationPatch.js']){
  test(`${relative} stays syntax-valid`,()=>{
    const check=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8'});
    assert.equal(check.status,0,check.stderr||check.stdout);
  });
}

test('purge prepare and execute both return jobs immediately and use protected legacy handlers in background',()=>{
  const source=read('src/v105AsyncPurgePatch.js');
  assert.match(source,/PREPARE_PATH = '\/api\/admin\/data-purge\/prepare'/);
  assert.match(source,/EXECUTE_PATH = '\/api\/admin\/data-purge\/execute'/);
  assert.match(source,/PREPARE_STATUS_PATH = '\/api\/v105\/data-purge\/prepare\/:jobId'/);
  assert.match(source,/EXECUTE_STATUS_PATH = '\/api\/v105\/data-purge\/execute\/:jobId'/);
  assert.match(source,/setImmediate\(async \(\) =>/);
  assert.match(source,/runLegacyHandler\(legacyHandler, req\)/);
  assert.match(source,/res\.status\(202\)\.json/);
  assert.match(source,/ownerKey\(req\.user\)/);
  assert.match(source,/toUpperCase\(\) !== 'ADMIN'/);
});

test('purge UI polls both background phases and keeps existing destructive confirmation flow',()=>{
  const source=read('public/v104-fast-purge-ui.js');
  assert.match(source,/pollJob\(prepared\.pollUrl,preview,'PREPARE'\)/);
  assert.match(source,/pollJob\(submitted\.pollUrl,preview,'EXECUTE'\)/);
  assert.match(source,/purgeChallenge=challenge/);
  assert.match(source,/安全备份正在后台执行/);
  assert.match(source,/applyCompletedPurge\(result\)/);
  assert.doesNotMatch(source,/大型数据库可能需要几分钟/);
});

test('visible-page renderer does not render hidden operation pages on every state change',()=>{
  const source=read('public/v105-fast-render.js');
  assert.match(source,/pageNow=.*currentPage/);
  assert.match(source,/if\(page==='home'\)call\('renderHome'\)/);
  assert.match(source,/else if\(page==='import'\)/);
  assert.match(source,/requestIdleCallback/);
  const homeBranch=source.slice(source.indexOf("if(page==='home')"),source.indexOf("else if(page==='import')"));
  assert.doesNotMatch(homeBranch,/renderCcslOperations|renderShopeeOperations|renderNetworkSettings|loadAuditLogs|loadDataManagement/);
});

test('identical exports reuse active or recently completed jobs',()=>{
  const source=read('src/v84AsyncExportPatch.js');
  assert.match(source,/function payloadKey\(payload\)/);
  assert.match(source,/function reusableJob\(key, requester/);
  assert.match(source,/reused: 'ACTIVE'/);
  assert.match(source,/reused: 'COMPLETED'/);
  assert.match(source,/jobFilesExist\(job\)/);
  assert.match(source,/相同条件报表已生成/);
});

test('drilldown range is cached once and reused across metric clicks',()=>{
  const source=read('src/v55DashboardReconciliationPatch.js');
  assert.match(source,/const rangeCache=new Map\(\)/);
  assert.match(source,/function cachedRange\(fromDate,toDate\)/);
  assert.match(source,/RANGE_CACHE_MS/);
  assert.match(source,/const range=cachedRange\(fromDate,toDate\)/);
});

test('versioned static assets receive browser max-age cache instead of forced revalidation',()=>{
  const source=read('src/v89StaticAssetCachePatch.js');
  assert.match(source,/\[\?&\]v=/);
  assert.match(source,/max-age=86400/);
  assert.match(source,/stale-while-revalidate=604800/);
  assert.doesNotMatch(source,/private, no-cache/);
});

test('2GiB durability scenario stays available but is opt-in during normal go-live validation',()=>{
  const pkg=JSON.parse(read('package.json'));
  const large=read('test/data-purge-large-backup.test.js');
  assert.match(pkg.scripts['test:golive'],/data-purge-large-backup\.test\.js/);
  assert.match(pkg.scripts.test,/test\/\*\.test\.js/);
  assert.match(large,/CE_QC_RUN_LARGE_DURABILITY/);
  assert.match(large,/skip: !RUN_LARGE_DURABILITY/);
});
