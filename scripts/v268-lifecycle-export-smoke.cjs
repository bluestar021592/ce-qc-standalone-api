const fs=require('fs');
const assert=require('assert/strict');
const {execFileSync}=require('child_process');
const read=p=>fs.readFileSync(p,'utf8');
const owner=read('public/v268-lifecycle-export-owner.js');
const integrity=read('public/v271-canonical-integrity-owner.js');
const inject=read('src/v231MetricTruthUiInjectionPatch.js');
const tracking=read('public/v246-qc-tracking.js');
const history=read('public/v183-history-refresh.js');
const shops=read('src/shopCodes.js');
const parser=read('src/unifiedExcelParser.js');
execFileSync(process.execPath,['--check','public/v268-lifecycle-export-owner.js'],{stdio:'pipe'});
execFileSync(process.execPath,['--check','public/v271-canonical-integrity-owner.js'],{stdio:'pipe'});
execFileSync(process.execPath,['--check','src/v231MetricTruthUiInjectionPatch.js'],{stdio:'pipe'});
execFileSync(process.execPath,['--check','src/shopCodes.js'],{stdio:'pipe'});
execFileSync(process.execPath,['--check','src/unifiedExcelParser.js'],{stdio:'pipe'});
assert.doesNotThrow(()=>new Function(owner),'V330 navigation-safe lifecycle/export owner must compile');
assert.doesNotThrow(()=>new Function(integrity),'retired V271 compatibility source must still compile');
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
for(const type of ['CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN'])assert.ok(owner.includes(`'${type}'`),`lifecycle exporter must include ${type}`);
assert.match(owner,/v271-canonical-integrity-owner\.js\?v=20260823-v271-1/,'retired V271 URL must remain source-visible only for compatibility');
assert.match(owner,/retired-by-v330/,'fresh V330 runtime must poison-pill the old V271 owner instead of starting it');
assert.doesNotMatch(owner,/s\.src=['"]\/v271-canonical-integrity-owner\.js/,'fresh V330 lifecycle runtime must never create a V271 network trend script');
assert.match(inject,/v268-lifecycle-export-owner\.js\?v=20260827-v330-1/,'fresh HTML must cache-bust the V330 lifecycle owner');
assert.match(inject,/v268-lifecycle-export-owner\.js\?v=20260823-v269-1/,'old V269 URL remains source-visible for compatibility gates only');
assert.doesNotMatch(inject,/tags\.push\(`\s*<script src=\\"\$\{V271_CANONICAL_INTEGRITY_MARKER\}/,'V330 HTML must not deliver the old V271 owner');
assert.match(inject,/retired-by-v330-cache-only-trend-owner/,'V271 retirement must be observable in response headers');

// Navigation safety: SPA helper may observe added nodes but must never swallow clicks.
assert.match(owner,/v268Initialized==='1'/,'tracking-panel enhancement must be idempotent');
assert.match(owner,/panel\.dataset\.v268Initialized='1';[\s\S]*textContent/,'initialization marker must be set before text mutations');
assert.match(owner,/function scheduleEnhance\(\)/,'DOM enhancement must be coalesced');
assert.match(owner,/records\.some\(r=>\[\.\.\.r\.addedNodes\]/,'MutationObserver must react only to added element nodes');
assert.doesNotMatch(owner,/preventDefault\s*\(|stopPropagation\s*\(|stopImmediatePropagation\s*\(/,'lifecycle owner must never swallow navigation events');
assert.match(owner,/without click interception/,'runtime log must explicitly disclose click safety');

// V306 keeps the useful V270 ADMIN-override behavior, but expands runtime authority
// to the signed 95-code + alias map and explicitly forbids store recognition from
// changing the seven-business daily-report board assignment.
assert.match(shops,/SHOP_CODE_RUNTIME_VERSION = '2026-08-25-v306-authoritative-code-name-alias-v1'/,'V306 authoritative code/name/alias shop runtime must remain active');
assert.match(shops,/const persisted = loadAllPersistedShopCodes\(db\);[\s\S]*merged\.set\(code, name\)/,'persisted ADMIN CP codes must continue to merge over builtin display names at runtime');
assert.match(shops,/ADMIN-uploaded canonical names still override display names/,'V306 must explicitly preserve the V270 ADMIN display-name override contract');
assert.match(shops,/authority: 'SHOP_CODE_FIRST_ALIAS_SECOND_BUSINESS_BOARD_UNCHANGED'/,'shop summary must disclose code-first, alias-second, business-board-unchanged authority');
assert.match(shops,/effectiveImmediately: true/,'successful CP-code import must become effective immediately');
assert.match(shops,/SHOP_CODE_NAME_CONFLICT/,'same CP code with conflicting names must block import');
assert.match(shops,/NO_VALID_SHOP_CODES/,'invalid CP workbooks must be rejected rather than silently accepted');
assert.match(integrity,/不会改变CE、CEAF、TBKH、ALI1688、SHOPEE CN\/VN、WHPP的日报业务归属/,'retired V271 compatibility source must retain CP-code business-isolation documentation');
assert.match(integrity,/管理员上传名单立即用于以后扫描\/轨迹的门店匹配/,'retired V271 compatibility source must retain immediate trajectory-matching documentation');

assert.match(parser,/BUSINESS_PRIORITY = Object\.freeze\(\['CEAF', 'SHOPEEVN', 'SHOPEECN', 'ALI1688', 'TBKH', 'WHPP', 'CE'\]\)/,'daily-report business priority must remain explicit');
assert.match(parser,/customerName\.includes\('CCAF'\)/,'CEAF must remain customer-name strong rule');
assert.match(parser,/recipient\.includes\('SHOPEEVN'\)/,'SHOPEEVN strong rule must remain explicit');
assert.match(parser,/recipient\.includes\('SHOPEECN'\)/,'SHOPEECN strong rule must remain explicit');
assert.match(parser,/recipient\.includes\('ALI1688'\)/,'ALI1688 strong rule must remain explicit');
assert.match(parser,/shipmentCode\.startsWith\('TBKH'\)/,'TBKH prefix rule must remain explicit');
assert.match(parser,/shipmentCode\.startsWith\('CE'\).*WHPP/s,'CE prefix must remain WHPP fallback');
assert.match(parser,/shipmentCode\.startsWith\('CC'\).*businessType: 'CE'/s,'CC prefix must remain CE fallback');
assert.match(parser,/UNCLASSIFIED_WAYBILL_PREFIX/,'unclassified rows must block import instead of silently becoming CE');
assert.match(parser,/SOURCE_CLASSIFICATION_RECONCILIATION_FAILED/,'seven-business totals must reconcile exactly to unique valid waybills');

// The V271 file stays in the repository only as historical compatibility evidence.
// Its old network timeout/retry logic must never regain runtime ownership.
assert.match(integrity,/9000/,'historical V271 source should remain identifiable');
assert.match(integrity,/走势图读取失败/,'historical V271 source should remain identifiable by its old timeout UI');
assert.match(integrity,/scheduleRetry/,'historical V271 source should remain identifiable by its old retry loop');
assert.match(inject,/X-CE-QC-V269-UI/,'V269 navigation-safe compatibility delivery must remain observable');
assert.match(tracking,/每小时做一次防漏对账/,'existing V246 background anti-leak tracking must remain active');
assert.match(tracking,/02:00执行最近30天非终态自动刷新/,'existing V246 nightly OPEN refresh contract must remain active');
assert.match(history,/刷新状态后导出/,'legacy V183 refresh/export source remains for compatibility but is visually retired');
console.log('[V330/V306.1/V269] V271 timeout/retry trend owner retired · cache-only trend ownership + authoritative shop code/alias routing + seven-board isolation + lifecycle freshness gate passed');
