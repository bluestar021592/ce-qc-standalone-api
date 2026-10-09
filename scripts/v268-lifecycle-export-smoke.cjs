const fs=require('fs');
const assert=require('assert/strict');
const {execFileSync}=require('child_process');
const read=p=>fs.readFileSync(p,'utf8');
const owner=read('public/v268-lifecycle-export-owner.js');
const integrity=read('public/v271-canonical-integrity-owner.js');
const inject=read('src/v231MetricTruthUiInjectionPatch.js');
const tracking=read('public/v246-qc-tracking.js');
const trackingRuntime=read('src/v246QcTrackingRuntimePatch.js');
const history=read('public/v183-history-refresh.js');
const shops=read('src/shopCodes.js');
const parser=read('src/unifiedExcelParser.js');
execFileSync(process.execPath,['--check','public/v268-lifecycle-export-owner.js'],{stdio:'pipe'});
execFileSync(process.execPath,['--check','public/v271-canonical-integrity-owner.js'],{stdio:'pipe'});
execFileSync(process.execPath,['--check','src/v231MetricTruthUiInjectionPatch.js'],{stdio:'pipe'});
execFileSync(process.execPath,['--check','src/v246QcTrackingRuntimePatch.js'],{stdio:'pipe'});
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

// V781: preserve the V306 legacy fallback only until an administrator explicitly
// activates a complete 72-code current list. The old 95-code workbook remains
// stored for historical evidence, but cannot decide CURRENT store arrival after
// that activation. These are complementary rules, not one permanent version.
assert.match(shops,/SHOP_CODE_RUNTIME_VERSION = '2026-10-09-v780-complete-72-active-set-v1'/,
  'current shop runtime must advertise the exact-72 activation contract');
assert.match(shops,/if\(active\)\{[\s\S]*?new Map\(active\.members\.map/,
  'activated 72-code map must take precedence over any built-in/legacy codes');
assert.match(shops,/seedLatestShopWhitelist\(db\);[\s\S]*?const merged = latestShopCodeMap\(\);[\s\S]*?for \(const \[code, name\] of persisted\) merged\.set\(code, name\)/,
  'unactivated compatibility mode must still preserve the V306 ADMIN override');
assert.match(shops,/ADMIN-uploaded canonical names still override display names/,
  'V306 fallback must retain old ADMIN display-name override contract');
assert.match(shops,/ACTIVE_72_CODES_ONLY_HISTORICAL_PRESERVED/,
  'shop summary must disclose current-only 72 authority after activation');
assert.match(shops,/SHOP_CODE_FIRST_ALIAS_SECOND_BUSINESS_BOARD_UNCHANGED/,
  'legacy summary must still disclose original code-first business isolation');
assert.match(shops,/COMPLETE_SHOP_LIST_CHANGED/,
  'new active CP set must not silently change between admin preview and activation');
assert.match(shops,/shop_cp_import_snapshots/,
  'each CP import must preserve its own exact workbook membership');
assert.match(shops,/shop_active_code_set_history/,
  'historical activation evidence must remain stored for audit');
assert.match(shops,/if\(strictCanonical\)return null;/,
  'current 72-name aliases must not fuzzy-match retired or similar names');
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

// V452: the V450 UI intentionally auto-loads only the persisted tracking ledger.
// Do not use UI wording as proof that background anti-leak jobs still exist. The
// scheduler/runtime is the authority: it must preserve the hourly lightweight
// reconciliation and Cambodia 02:00 rolling 30-day non-terminal refresh.
assert.match(tracking,/\/api\/v246\/tracking\/summary\?/,'V450 tracking UI must auto-read persisted ledger through the read-only summary route');
assert.match(tracking,/initialReadStarted/,'V450 tracking UI must auto-read only once after mount');
assert.doesNotMatch(tracking,/function mount\([^)]*\)[\s\S]{0,220}tracking\/reconcile/,'V450 mount must not auto-start a network reconcile');
assert.match(trackingRuntime,/Date\.now\(\)-hourlyAuditAt>=60\*60_000/,'existing V246 hourly anti-leak cadence must remain active in runtime');
assert.match(trackingRuntime,/HOURLY_ANTI_LEAK_RECONCILE/,'existing V246 hourly anti-leak reconciliation must remain active in runtime');
assert.match(trackingRuntime,/if\(clock\.minuteOfDay<120\)return/,'existing V246 Cambodia 02:00 scheduler gate must remain active');
assert.match(trackingRuntime,/fromDate:addDays\(clock\.date,-29\),toDate:clock\.date,days:30/,'existing V246 nightly rolling 30-day scope must remain active');
assert.match(trackingRuntime,/CAMBODIA_0200_30DAY_AUTO/,'existing V246 nightly OPEN refresh contract must remain active in runtime');
assert.match(trackingRuntime,/v246_daily_0200_success_date/,'nightly V246 scheduler must persist success date for missed-run/catch-up control');
assert.match(history,/刷新状态后导出/,'legacy V183 refresh/export source remains for compatibility but is visually retired');
console.log('[V452/V330/V306.1/V269] lifecycle/export smoke passed · V246 background scheduler verified from runtime authority instead of stale UI wording · cache-only trend ownership + authoritative shop code/alias routing + seven-board isolation preserved');
