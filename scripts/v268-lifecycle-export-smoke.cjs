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
execFileSync(process.execPath,['--check','src/shopCodes.js'],{stdio:'pipe'});
execFileSync(process.execPath,['--check','src/unifiedExcelParser.js'],{stdio:'pipe'});
assert.doesNotThrow(()=>new Function(owner),'V271 navigation-safe lifecycle/export loader must compile');
assert.doesNotThrow(()=>new Function(integrity),'V271 canonical integrity owner must compile');
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
assert.match(owner,/v271-canonical-integrity-owner\.js\?v=20260823-v271-1/,'navigation-safe runtime must load V271 canonical integrity owner');

// Navigation safety: SPA helper may observe added nodes but must never swallow clicks.
assert.match(owner,/v268Initialized==='1'/,'tracking-panel enhancement must be idempotent');
assert.match(owner,/panel\.dataset\.v268Initialized='1';[\s\S]*textContent/,'initialization marker must be set before text mutations');
assert.match(owner,/function scheduleEnhance\(\)/,'DOM enhancement must be coalesced');
assert.match(owner,/records\.some\(r=>\[\.\.\.r\.addedNodes\]/,'MutationObserver must react only to added element nodes');
assert.doesNotMatch(owner,/preventDefault\s*\(|stopPropagation\s*\(|stopImmediatePropagation\s*\(/,'lifecycle owner must never swallow navigation events');
assert.match(owner,/without click interception/,'runtime log must explicitly disclose click safety');

// V270/V271: user-uploaded CP codes are authoritative for shop trajectory classification,
// but are deliberately independent from the seven-business daily-report classifier.
assert.match(shops,/SHOP_CODE_RUNTIME_VERSION = '2026-08-23-v270-user-upload-authoritative-merge-v1'/,'V270 shop-code authority must remain active');
assert.match(shops,/const persisted = loadAllPersistedShopCodes\(db\);[\s\S]*merged\.set\(code, name\)/,'persisted ADMIN CP codes must merge over builtin codes at runtime');
assert.match(shops,/authority: 'ADMIN_UPLOAD_OVERRIDES_BUILTIN'/,'shop summary must disclose ADMIN upload authority');
assert.match(shops,/effectiveImmediately: true/,'successful CP-code import must become effective immediately');
assert.match(shops,/SHOP_CODE_NAME_CONFLICT/,'same CP code with conflicting names must block import');
assert.match(shops,/NO_VALID_SHOP_CODES/,'invalid CP workbooks must be rejected rather than silently accepted');
assert.match(integrity,/不会改变CE、CEAF、TBKH、ALI1688、SHOPEE CN\/VN、WHPP的日报业务归属/,'UI must explain CP codes do not own business classification');
assert.match(integrity,/管理员上传名单立即用于以后扫描\/轨迹的门店匹配/,'UI must explain immediate trajectory matching');

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

// V271: Chinese clarity + one canonical trend owner. No endless empty placeholder.
assert.match(integrity,/数据库结构版本/,'data management must use Chinese schema label');
assert.match(integrity,/正常＝SQLite数据库可以正常读取和写入/,'normal status must be explained in Chinese');
assert.match(integrity,/门店CP码与门店名称配置/,'shop panel title must be explicit');
assert.match(integrity,/grid-template-columns:1fr 1fr/,'shop configuration controls must be aligned');
assert.match(integrity,/SPECIAL=new Set\(\['TBKH','SHOPEECN','SHOPEEVN'\]\)/,'special trend scope must be exact');
assert.match(integrity,/GENERIC=new Set\(\['CE','CEAF','ALI1688','WHPP'\]\)/,'generic trend scope must cover the remaining physical boards including WHPP');
assert.match(integrity,/\/api\/v263\/delivery-trends/,'TBKH and Shopee specialized trends must use lifecycle truth');
assert.match(integrity,/\/api\/v253\/trends/,'generic and home trends must use cache-independent persisted truth');
assert.match(integrity,/9000/,'trend reads must have a finite timeout');
assert.match(integrity,/走势图读取失败/,'trend failures must be visible in Chinese instead of indefinite blank UI');
assert.match(integrity,/scheduleRetry/,'transient trend failures or incomplete facts must auto-retry');
assert.match(integrity,/root\.dataset\.v263Request=`V271_CANCEL_/,'V271 must invalidate older target-board hydrators before they can overwrite final charts');

assert.match(inject,/X-CE-QC-V269-UI/,'V269 navigation-safe delivery must remain observable');
assert.match(tracking,/每小时做一次防漏对账/,'existing V246 background anti-leak tracking must remain active');
assert.match(tracking,/02:00执行最近30天非终态自动刷新/,'existing V246 nightly OPEN refresh contract must remain active');
assert.match(history,/刷新状态后导出/,'legacy V183 refresh/export source remains for compatibility but is visually retired');
console.log('[V271/V270/V269] classification authority + CP-code integrity + Chinese status clarity + canonical dashboard trend ownership + lifecycle freshness gate passed');
