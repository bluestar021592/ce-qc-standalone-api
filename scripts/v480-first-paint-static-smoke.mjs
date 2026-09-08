import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

for(const file of ['src/v89StaticAssetCachePatch.js','src/exportJobAtomicJson.js']){
  const checked=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(checked.status,0,`${file} syntax failed: ${checked.stderr||checked.stdout}`);
}
const source=fs.readFileSync('src/v89StaticAssetCachePatch.js','utf8');
const atomic=fs.readFileSync('src/exportJobAtomicJson.js','utf8');
assert.match(source,/2026-09-08-v480-preauth-static-first-paint-v1/);
assert.match(source,/const V480_PUBLIC_ASSET_RE=\/\\\.\(\?:css\|js\|svg\|png\|jpe\?g\|webp\|gif\|ico\|woff2\?\)\$\/i/,'V480 whitelist must be explicit non-HTML browser assets only');
assert.match(source,/express\.static\('public',\{index:false,fallthrough:true,redirect:false,maxAge:0\}\)/,'V480 must never expose index.html through the pre-auth static server');
assert.match(source,/candidates\.some\(fn => fn\.name === 'accessIdentity'\)/,'V480 must install immediately before accessIdentity registration');
assert.match(source,/originalUse\.call\(this, v480FirstPaintAsset\)/,'V480 pre-auth asset middleware must be registered before the auth middleware itself');
assert.match(source,/X-CE-QC-V480-First-Paint/);
assert.doesNotMatch(source,/V480_PUBLIC_ASSET_RE[^\n]*(?:html|json)/i,'V480 pre-auth whitelist must not include HTML or JSON');
assert.match(source,/return originalUse\.apply\(this, args\)/,'existing Express middleware ownership must remain intact');
assert.match(atomic,/2026-09-08-v480-export-parent-liveness-v1/);
assert.match(atomic,/CE_QC_EXPORT_SIDECAR_CHILD/);
assert.match(atomic,/CE_QC_EXPORT_WORKER_MODE/);
assert.match(atomic,/process\.kill\(pid,0\)/,'export children must probe direct-parent liveness without touching unrelated Node processes');
assert.match(atomic,/process\.exit\(86\)/,'orphan export child must release itself when its parent disappears');
assert.match(atomic,/timer\.unref\?\.\(\)/,'parent watchdog must not keep a completed export process alive');
assert.doesNotMatch(atomic,/taskkill|Stop-Process/i,'V480 parent watch must never kill unrelated processes by name or broad process scan');
console.log('[V480] first-paint/lifecycle smoke passed · CSS/JS/images/fonts before auth · HTML/API stay protected · export descendants self-release when direct parent disappears');
