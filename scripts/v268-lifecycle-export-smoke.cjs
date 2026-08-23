const fs=require('fs');
const assert=require('assert/strict');
const {execFileSync}=require('child_process');
const read=p=>fs.readFileSync(p,'utf8');
const owner=read('public/v268-lifecycle-export-owner.js');
const inject=read('src/v231MetricTruthUiInjectionPatch.js');
const tracking=read('public/v246-qc-tracking.js');
const history=read('public/v183-history-refresh.js');
execFileSync(process.execPath,['--check','public/v268-lifecycle-export-owner.js'],{stdio:'pipe'});
assert.doesNotThrow(()=>new Function(owner),'V269 navigation-safe lifecycle/export owner must compile');
assert.match(owner,/\/api\/v246\/tracking\/reconcile/,'formal period export must use the canonical V246 OPEN reconcile path before workbook generation');
assert.match(owner,/\/api\/v246\/tracking\/job\//,'export must wait for reconcile completion instead of fire-and-forget');
assert.match(owner,/failed>0/,'export must refuse silent stale output when some OPEN refreshes fail');
assert.match(owner,/original\.apply/,'original exporter must run only after refresh completion');
assert.match(owner,/duplicate-history-refresh/,'duplicate V183 manual history refresh panel must be retired');
assert.match(owner,/duplicate-carryover-manual/,'duplicate cross-day manual carryover panel must be retired');
assert.match(owner,/每2小时刷新OPEN票/,'UI must disclose automatic two-hour OPEN tracking');
assert.match(owner,/02:00复核最近30天/,'UI must disclose nightly 30-day reconciliation');
assert.match(owner,/漏跑会在开机后补跑/,'UI must disclose missed-run catch-up');
assert.match(owner,/全部7业务/,'formal exporter must expose all seven physical business types');
for(const type of ['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'])assert.ok(owner.includes(`'${type}'`),`V268 exporter must include ${type}`);

// V269: the consolidation helper must be navigation-safe. The previous V268 owner
// called enhance() directly from a document-wide MutationObserver while enhance()
// rewrote textContent, which could recursively saturate the browser main thread and
// make sidebar links appear unclickable.
assert.match(owner,/v268Initialized==='1'/,'tracking-panel enhancement must be idempotent');
assert.match(owner,/panel\.dataset\.v268Initialized='1';[\s\S]*textContent/,'initialization marker must be set before any textContent mutation');
assert.match(owner,/function scheduleEnhance\(\)/,'DOM enhancement must be coalesced');
assert.match(owner,/records\.some\(r=>\[\.\.\.r\.addedNodes\]/,'MutationObserver must react only to newly added element nodes');
assert.doesNotMatch(owner,/new MutationObserver\(\(\)=>enhance\(\)\)/,'document-wide observer must never call mutating enhance directly');
assert.doesNotMatch(owner,/addEventListener\(['"]click['"][\s\S]{0,120}true\)/,'V269 must not install a capture-phase click interceptor');
assert.doesNotMatch(owner,/preventDefault\s*\(/,'V269 must not prevent sidebar/default navigation clicks');
assert.doesNotMatch(owner,/stopPropagation\s*\(|stopImmediatePropagation\s*\(/,'V269 must not swallow navigation click propagation');
assert.match(owner,/never intercepts sidebar clicks/,'runtime log must disclose navigation-safe behavior');

assert.match(inject,/v268-lifecycle-export-owner\.js\?v=20260823-v268-1/,'legacy V268 resource marker must remain source-compatible');
assert.match(inject,/v268-lifecycle-export-owner\.js\?v=20260823-v269-1/,'live V269 asset URL must force browsers off the looping V268 resource');
assert.match(inject,/X-CE-QC-V268-UI/,'V268 compatibility delivery must remain observable');
assert.match(inject,/X-CE-QC-V269-UI/,'V269 navigation-safe delivery must be observable');
assert.match(tracking,/每小时做一次防漏对账/,'existing V246 background anti-leak tracking must remain active');
assert.match(tracking,/02:00执行最近30天非终态自动刷新/,'existing V246 nightly OPEN refresh contract must remain active');
assert.match(history,/刷新状态后导出/,'legacy V183 manual refresh/export behavior remains available in source for compatibility but is visually retired by V268/V269');
console.log('[V269/V268] navigation-safe lifecycle consolidation gate passed: idempotent DOM observer + sidebar click safety + automatic OPEN tracking + export freshness');
