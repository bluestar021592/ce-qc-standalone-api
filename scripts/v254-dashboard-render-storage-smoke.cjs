const fs=require('fs');
const assert=require('assert/strict');
const {execFileSync}=require('child_process');
const read=p=>fs.readFileSync(p,'utf8');
const dashboard=read('public/dashboard-v18.js');
const chart=read('public/dashboard-chart-v18.js');
const fastOwner=read('public/v253-dashboard-fast-owner.js');
const inject=read('src/v231MetricTruthUiInjectionPatch.js');
const cachePatch=read('src/v89StaticAssetCachePatch.js');
const storage=read('src/v254StorageHealthPatch.js');
const r2guard=read('src/v256R2ZeroCostGuard.js');
const strictBackfill=read('src/v262ShopeeStrictEvidenceBackfill.js');
const trend=read('src/v263DeliveryKpiTrendPatch.js');
const runtime=read('src/v206InteractiveFirstRuntimePatch.js');

const runtimeImports=[...runtime.matchAll(/^import\s+['"]\.\/(.+?\.js)['"];?$/gm)].map(match=>`src/${match[1]}`);
assert.ok(runtimeImports.length>=10,'V206 startup bridge must expose all direct runtime imports including V263');
for(const file of runtimeImports)execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
for(const file of ['public/dashboard-v18.js','public/dashboard-chart-v18.js','public/v253-dashboard-fast-owner.js','src/v89StaticAssetCachePatch.js','src/v262ShopeeStrictEvidenceBackfill.js','src/v263DeliveryKpiTrendPatch.js','scripts/v262-shopee-strict-evidence-smoke.mjs','scripts/v263-delivery-kpi-trend-smoke.mjs'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
assert.doesNotThrow(()=>new Function(dashboard),'canonical dashboard-v18 must compile');
assert.doesNotThrow(()=>new Function(chart),'canonical dashboard chart must compile');
assert.doesNotThrow(()=>new Function(fastOwner),'V253 fetch bridge must compile');

assert.match(dashboard,/DELIVERY_KPI_TYPES=new Set\(\['TBKH','SHOPEECN','SHOPEEVN'\]\)/,'canonical UI scope must be exactly TBKH + SHOPEECN + SHOPEEVN');
assert.match(dashboard,/\/api\/v263\/delivery-trends/,'canonical DashboardV18 must read V263 delivery KPI truth directly');
assert.match(dashboard,/平均签收天数趋势/,'target boards must replace duplicate first-day trend with average signing days');
assert.match(dashboard,/1\/2\/3派与平均签收天数/,'target boards must expose one authoritative attempt/signing panel');
assert.match(dashboard,/70 START优先/,'UI must disclose strict START evidence rule');
assert.match(dashboard,/function renderHome\(/,'home must remain canonical DashboardV18');
assert.doesNotMatch(dashboard,/派送概率分布（按派次）/,'home must not duplicate the three-business attempt mechanism');
assert.match(chart,/type === 'days'/,'shared chart renderer must support signing-day values');

assert.match(cachePatch,/CORE_LIVE_ASSET_RE/,'critical dashboard assets must have an explicit live-cache rule');
assert.match(cachePatch,/Clear-Site-Data', '\"cache\"'/,'HTML navigation must clear only browser HTTP cache after V263 upgrade');
assert.match(cachePatch,/no-store, max-age=0, must-revalidate/,'critical core dashboard assets must not remain in 24-hour cache');

assert.match(inject,/V234\/V248\/V251\/V252\/V254\/V261 visual owners retired/,'UI delivery must explicitly retire all historical visual trend owners');
for(const old of ['v234-dashboard-live.js','v237-home-dashboard-owner.js','v244-shopee-trend-owner.js','v250-shopee-metric-visibility.js','v252-qc-lifecycle-ui.js','v254-dashboard-render-rescue.js','v261-dashboard-final-owner.js'])assert.ok(inject.includes(`'${old}'`),`V263 must strip old overlay ${old}`);
assert.doesNotMatch(inject,/tags\.push\(`\s*<script src=\\"\$\{LEGACY_GATE_/,'legacy compatibility markers must never be pushed into delivered HTML');
assert.match(inject,/X-CE-QC-V263-UI/,'V263 canonical delivery must be observable');
assert.match(fastOwner,/fetch acceleration only/,'V253 must be fetch-only after V263');
assert.match(fastOwner,/function renderGeneric\(\)\{return false;\}/,'V253 generic visible rendering must be disabled');
assert.match(fastOwner,/function renderShopee\(\)\{return false;\}/,'V253 Shopee visible rendering must be disabled');
assert.doesNotMatch(fastOwner,/读取已落库日报数据/,'V253 must no longer create stale loading trend placeholders');

assert.match(strictBackfill,/V263_DELIVERY_KPI_TYPES=Object\.freeze\(\['TBKH','SHOPEECN','SHOPEEVN'\]\)/,'evidence retry scope must be exactly the three requested businesses');
assert.match(strictBackfill,/businessType IN \('TBKH','SHOPEECN','SHOPEEVN'\)/,'delivery evidence retry query must include TBKH and both Shopee boards');
assert.match(strictBackfill,/attemptNo=0 OR podDate='' OR podDate IS NULL OR signingDays IS NULL OR signingDays<=0/,'attempt and signing-day evidence must retry independently');
assert.match(strictBackfill,/保留已锁定派次并补POD日期\/签收天数/,'known attempt must be preserved while missing signing evidence is backfilled');
assert.match(strictBackfill,/business_track_events/,'stored trajectory must be used before CE retry');
assert.match(strictBackfill,/CE_TRACK_RETRY_UNKNOWN/,'remaining missing evidence must retry CE trajectory');
assert.match(strictBackfill,/TWO_HOUR_AUTO/,'attempt/signing evidence retry must remain continuous');
assert.doesNotMatch(strictBackfill,/businessType IN \('CE','CEAF'|businessType IN \('ALI1688'|businessType IN \('WHPP'/,'other boards must not enter attempt/signing evidence retry');

assert.match(trend,/new Set\(\['TBKH','SHOPEECN','SHOPEEVN'\]\)/,'V263 read endpoint scope must be exact');
assert.match(trend,/signingDaysSum/,'average signing days must come from locked per-shipment signing days');
assert.match(trend,/attemptNo=1/,'reader must expose first-attempt POD evidence');
assert.match(trend,/attemptNo=2/,'reader must expose second-attempt POD evidence');
assert.match(trend,/attemptNo>=3/,'reader must expose third-plus attempt POD evidence');
assert.match(runtime,/import '\.\/v263DeliveryKpiTrendPatch\.js';/,'V263 trend route must activate in normal runtime');

execFileSync(process.execPath,['scripts/v262-shopee-strict-evidence-smoke.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/v263-delivery-kpi-trend-smoke.mjs'],{stdio:'inherit'});

assert.match(inject,/import '\.\/v254StorageHealthPatch\.js';/,'read-only storage health audit must stay active');
assert.match(storage,/READ_ONLY_SIZE_SCAN_NO_DELETE_NO_VACUUM_NO_CHECKPOINT/,'storage audit must remain read-only');
assert.doesNotMatch(storage,/fs\.(?:unlinkSync|rmSync|unlink|rm)\s*\(/,'storage audit must not delete files');
assert.doesNotMatch(storage,/\bgetDb\s*\(/,'storage audit must not open business SQLite');
assert.doesNotMatch(runtime,/^import '\.\/v255RetentionStorageGuard\.js';/m,'broken V255 must remain excluded');
assert.match(runtime,/V255 retention guard is intentionally disabled from startup/,'V255 exclusion must remain documented');
assert.match(runtime,/import '\.\/v256R2ZeroCostGuard\.js';/,'V256 zero-cost guard must stay active');
assert.match(r2guard,/DEFAULT_SAFE_STORAGE_BYTES=8\*GIB/,'R2 zero-cost guard must remain below free storage limit');
assert.match(r2guard,/storageClass:'STANDARD'/,'R2 must remain Standard-only');
assert.doesNotMatch(r2guard,/postgresql:\/\/|npg_[A-Za-z0-9]+|BEGIN PRIVATE KEY|AKIA[0-9A-Z]{16}/,'secrets must never be committed');
execFileSync(process.execPath,['scripts/v257-system-calibration-smoke.cjs'],{stdio:'inherit'});
console.log('[V263] canonical DashboardV18 + all legacy visual owners retired + cache reset + exact three-business attempt/signing tracking + storage safety gate passed');
