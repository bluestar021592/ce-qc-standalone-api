import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

for(const relative of ['src/v105AsyncPurgePatch.js','public/v104-fast-purge-ui.js','public/v105-fast-render.js','src/v84AsyncExportPatch.js','src/v89StaticAssetCachePatch.js']){
  test(`${relative} stays syntax-valid`,()=>{
    const check=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8'});
    assert.equal(check.status,0,check.stderr||check.stdout);
  });
}

test('purge prepare returns a job immediately and executes legacy protected prepare in background',()=>{
  const source=read('src/v105AsyncPurgePatch.js');
  assert.match(source,/PREPARE_PATH = '\/api\/admin\/data-purge\/prepare'/);
  assert.match(source,/STATUS_PATH = '\/api\/v105\/data-purge\/prepare\/:jobId'/);
  assert.match(source,/setImmediate\(async \(\) =>/);
  assert.match(source,/runLegacyPrepare\(legacyHandler, req\)/);
  assert.match(source,/res\.status\(202\)\.json/);
  assert.match(source,/ownerKey\(req\.user\)/);
  assert.match(source,/role \|\| ''\)\.toUpperCase\(\) !== 'ADMIN'/);
});

test('purge UI polls background status and keeps existing destructive confirmation flow',()=>{
  const source=read('public/v104-fast-purge-ui.js');
  assert.match(source,/pollJob\(prepared\.pollUrl,preview\)/);
  assert.match(source,/await sleep\(750\)/);
  assert.match(source,/purgeChallenge=challenge/);
  assert.match(source,/安全备份正在后台执行/);
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

test('versioned static assets receive browser max-age cache instead of forced revalidation',()=>{
  const source=read('src/v89StaticAssetCachePatch.js');
  assert.match(source,/\[\?&\]v=/);
  assert.match(source,/max-age=86400/);
  assert.match(source,/stale-while-revalidate=604800/);
  assert.doesNotMatch(source,/private, no-cache/);
});

test('daily go-live gate excludes the 2GiB durability test but full test suite still discovers it',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.doesNotMatch(pkg.scripts['test:golive'],/data-purge-large-backup\.test\.js/);
  assert.match(pkg.scripts.test,/test\/\*\.test\.js/);
  assert.match(pkg.scripts['test:golive'],/v104-fast-purge-backup\.test\.js/);
  assert.match(pkg.scripts['test:golive'],/v105-performance-spine\.test\.js/);
});
