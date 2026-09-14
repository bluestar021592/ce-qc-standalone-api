const fs=require('fs');
const assert=require('assert/strict');
const {execFileSync}=require('child_process');
const read=p=>fs.readFileSync(p,'utf8');
const dashboard=read('public/dashboard-v18.js');
const chart=read('public/dashboard-chart-v18.js');
const css=read('public/dashboard-v18.css');
const fastOwner=read('public/v253-dashboard-fast-owner.js');
const generic=read('public/v263-generic-trend-hydrator.js');
const reportOwner=read('public/v267-report-export-owner.js');
const inject=read('src/v231MetricTruthUiInjectionPatch.js');
const cachePatch=read('src/v89StaticAssetCachePatch.js');
const storage=read('src/v254StorageHealthPatch.js');
const r2guard=read('src/v256R2ZeroCostGuard.js');
const strictBackfill=read('src/v262ShopeeStrictEvidenceBackfill.js');
const attemptCycle=read('src/shopeeAttemptCycleV246.js');
const trend=read('src/v263DeliveryKpiTrendPatch.js');
const runtime=read('src/v206InteractiveFirstRuntimePatch.js');

const runtimeImports=[...runtime.matchAll(/^import\s+['"]\.\/(.+?\.js)['"];?$/gm)].map(match=>`src/${match[1]}`);
assert.ok(runtimeImports.length>=10,'V206 startup bridge must expose all direct runtime imports including V263');
for(const file of runtimeImports)execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
for(const file of ['public/dashboard-v18.js','public/dashboard-chart-v18.js','public/v253-dashboard-fast-owner.js','public/v263-generic-trend-hydrator.js','public/v267-report-export-owner.js','src/v89StaticAssetCachePatch.js','src/shopeeAttemptCycleV246.js','src/v262ShopeeStrictEvidenceBackfill.js','src/v263DeliveryKpiTrendPatch.js','src/v264TbkhOpenAttemptLifecycle.js','scripts/v262-shopee-strict-evidence-smoke.mjs','scripts/v263-delivery-kpi-trend-smoke.mjs'])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
assert.doesNotThrow(()=>new Function(dashboard),'canonical dashboard-v18 must compile');
assert.doesNotThrow(()=>new Function(chart),'canonical dashboard chart must compile');
assert.doesNotThrow(()=>new Function(fastOwner),'V253 fetch bridge must compile');
assert.doesNotThrow(()=>new Function(generic),'V263 generic trend hydrator must compile');
assert.doesNotThrow(()=>new Function(reportOwner),'V267 report export owner must compile');

assert.match(dashboard,/DELIVERY_KPI_TYPES=new Set\(\['TBKH','SHOPEECN','SHOPEEVN'\]\)/,'canonical UI scope must be exactly TBKH + SHOPEECN + SHOPEEVN');
assert.match(dashboard,/\/api\/v263\/delivery-trends/,'canonical DashboardV18 must read V263 delivery KPI truth directly');
assert.doesNotMatch(dashboard,/平均签收天数趋势/,'live boards must not restore the retired average-signing-days trend chart');
assert.match(dashboard,/1\/2\/3派与平均签收天数/,'target boards must expose one authoritative attempt/signing summary panel');
assert.match(dashboard,/趋势图仅保留在导出报表，实时看板不再渲染/,'target boards must disclose that trend charts are export-only after V509');
assert.match(dashboard,/70 START优先/,'UI must disclose strict START evidence rule');
assert.match(dashboard,/function renderHome\(/,'home must remain canonical DashboardV18');
assert.doesNotMatch(dashboard,/派送概率分布（按派次）/,'home must not duplicate the three-business attempt mechanism');
assert.match(chart,/type === 'days'/,'shared chart renderer must support signing-day values for retained report/export surfaces');
assert.match(chart,/adaptiveAttemptMax/,'low-coverage attempt chart must use readable adaptive scale instead of pinning sub-1% evidence to a 0-100 axis');
assert.match(chart,/v265-attempt-evidence-status/,'attempt chart must disclose evidence completion status');
assert.match(chart,/待补抓/,'zero values under incomplete evidence must not be presented as final 0%');
assert.match(chart,/当前曲线只表示已获得的真实轨迹证据，不作为最终派次率/,'incomplete attempt curves must be explicitly provisional');
assert.match(css,/#v263DeliveryKpiPanel \.v18-chart-grid\{grid-template-columns:minmax\(0,1fr\)!important/,'legacy chart layout CSS may remain source-compatible even though live trend mount is retired');
assert.match(css,/v265-attempt-evidence-status\.incomplete/,'incomplete evidence must have a visible status treatment');
assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important/,'delivery KPI summary must use a balanced four-column layout');

assert.match(generic,/PAGE_TYPE=\{ce:'CE',ceaf:'CEAF',ali1688:'ALI1688'\}/,'generic hydrator must be scoped to CE + CEAF + ALI1688 only');
assert.match(generic,/\/api\/v253\/trends/,'generic non-target boards must use V253 cache-independent truth');
assert.doesNotMatch(generic,/TBKH|SHOPEECN|SHOPEEVN|WHPP/,'generic hydrator must not compete with the three specialized boards or WHPP dedicated owner');
assert.doesNotMatch(generic,/读取已落库日报数据/,'generic hydrator must not create indefinite loading placeholders');
assert.match(inject,/v263-generic-trend-hydrator\.js\?v=20260823-v263-1/,'legacy resource-version gate marker must remain source-compatible while live delivery uses the newer marker');

assert.match(cachePatch,/CORE_LIVE_ASSET_RE/,'critical dashboard assets must have an explicit live-cache rule');
assert.match(cachePatch,/dashboard-v18\\\.css/,'dashboard layout CSS must be no-store together with core JS');
assert.match(cachePatch,/Clear-Site-Data', '\"cache\"'/,'HTML navigation must clear only browser HTTP cache after dashboard upgrade');
assert.match(cachePatch,/no-store, max-age=0, must-revalidate/,'critical core dashboard assets must not remain in 24-hour cache');

assert.match(inject,/V234\/V248\/V251\/V252\/V254\/V261 visual owners retired/,'UI delivery must explicitly retire all historical visual trend owners');
for(const old of ['v234-dashboard-live.js','v237-home-dashboard-owner.js','v244-shopee-trend-owner.js','v250-shopee-metric-visibility.js','v252-qc-lifecycle-ui.js','v254-dashboard-render-rescue.js','v261-dashboard-final-owner.js'])assert.ok(inject.includes(`'${old}'`),`V263 must strip old overlay ${old}`);
assert.doesNotMatch(inject,/tags\.push\(`\s*<script src=\\"\$\{LEGACY_GATE_/,'legacy compatibility markers must never be pushed into delivered HTML');
assert.match(inject,/X-CE-QC-V263-UI/,'V263 canonical delivery must be observable');
assert.match(inject,/v267-report-export-owner\.js\?v=20260823-v267-1/,'V267 report-export owner must be delivered after app.js');
assert.match(inject,/X-CE-QC-V267-UI/,'V267 report-export owner must be observable');
assert.match(fastOwner,/fetch acceleration only/,'V253 must be fetch-only after V263');
assert.match(fastOwner,/function renderGeneric\(\)\{return false;\}/,'V253 generic visible rendering must be disabled');
assert.match(fastOwner,/function renderShopee\(\)\{return false;\}/,'V253 Shopee visible rendering must be disabled');
assert.doesNotMatch(fastOwner,/读取已落库日报数据/,'V253 must no longer create stale loading trend placeholders');

// V267: report page must expose a real selectable date range, separate scope from
// concrete anomalies, and retire controls that previously looked functional but were not.
assert.match(reportOwner,/reportRangeFrom/,'report preview must expose selectable start date');
assert.match(reportOwner,/reportRangeTo/,'report preview must expose selectable end date');
assert.match(reportOwner,/loadCustomDashboardRange/,'report preview date selection must load stored period truth');
assert.match(reportOwner,/reportDataScope/,'all/core/province groups must be separated as data scope');
assert.match(reportOwner,/reportAnomalyType/,'concrete anomaly must have its own selector');
assert.match(reportOwner,/ANOMALY_RE/,'concrete anomaly selector must be classified semantically');
assert.match(reportOwner,/no-op-closure-filter/,'the legacy no-op closure control must be explicitly retired');
assert.match(reportOwner,/duplicate-single-snapshot-export/,'duplicate lower export button must be retired in favor of the period exporter');
assert.match(reportOwner,/不重新调用CE API/,'report preview must disclose stored-snapshot read semantics');
assert.doesNotMatch(reportOwner,/fetch\s*\(\s*['"]\/api\//,'V267 report UI must not directly call CE or invent a second backend read path');

assert.match(strictBackfill,/V263_DELIVERY_KPI_TYPES=Object\.freeze\(\['TBKH','SHOPEECN','SHOPEEVN'\]\)/,'evidence retry scope must be exactly the three requested businesses');
assert.match(strictBackfill,/businessType IN \('TBKH','SHOPEECN','SHOPEEVN'\)/,'delivery evidence retry query must include TBKH and both Shopee boards');
assert.match(strictBackfill,/attemptNo=0 OR podDate='' OR podDate IS NULL OR signingDays IS NULL OR signingDays<=0/,'attempt and signing-day evidence must retry independently');
assert.match(strictBackfill,/保留已锁定派次并补POD日期\/签收天数/,'known attempt must be preserved while missing signing evidence is backfilled');
assert.match(strictBackfill,/business_track_events/,'stored trajectory must be used before CE retry');
assert.match(strictBackfill,/CE_TRACK_RETRY_UNKNOWN/,'remaining missing evidence must retry CE trajectory');
assert.match(strictBackfill,/TWO_HOUR_AUTO/,'attempt/signing evidence retry must remain continuous');
assert.match(strictBackfill,/START_DELAY_MS[\s\S]*20_000/,'first automatic evidence pass must start quickly instead of waiting four minutes');
assert.match(strictBackfill,/ORDER BY firstReportDate DESC/,'recent report dates must be repaired before old history');
assert.match(strictBackfill,/requestV263DeliveryEvidenceBackfill/,'dashboard must be able to request a low-coverage repair without blocking first paint');
assert.match(strictBackfill,/nodeCode|eventStatusCode|operationCode|scanCode/,'CE event wrappers must normalize alternate real node-code fields');
assert.doesNotMatch(strictBackfill,/businessType IN \('CE','CEAF'|businessType IN \('ALI1688'|businessType IN \('WHPP'/,'other boards must not enter attempt/signing evidence retry');
assert.match(attemptCycle,/CODE_KEY_RE/,'strict attempt analyzer must recursively normalize CE node-code keys');
assert.match(attemptCycle,/nodeCode|scanCode|operationCode/,'strict attempt analyzer must support alternate real CE code fields');
assert.match(attemptCycle,/const hasDeliveryStart = sorted\.some\(isDeliveryStart\)/,'strict attempt owner must evaluate whole-trajectory delivery START evidence before fallback');
assert.match(attemptCycle,/const isStart = hasDeliveryStart \? isDeliveryStart : isAssignStart/,'assign START may be used only when no real delivery START exists');
assert.match(attemptCycle,/eventCode\(event\) === '70'/,'numeric 70 START compatibility must remain');
assert.match(attemptCycle,/eventCode\(event\) === '60'/,'numeric 60 fallback compatibility must remain');
assert.match(attemptCycle,/DELIVERY_START_RE\.test\(value\) && !FAILURE_RE\.test\(value\)/,'semantic delivery START must reject Pending/delivery-failure text');

assert.match(trend,/new Set\(\['TBKH','SHOPEECN','SHOPEEVN'\]\)/,'V263 read endpoint scope must be exact');
assert.match(trend,/signingDaysSum/,'average signing days must come from locked per-shipment signing days');
assert.match(trend,/attempt1Known:knownAttempt1[\s\S]*attempt1:attemptEvidenceComplete\?knownAttempt1:null/,'reader must retain first-attempt evidence and publish it only when complete');
assert.match(trend,/attempt2Known:knownAttempt2[\s\S]*attempt2:attemptEvidenceComplete\?knownAttempt2:null/,'reader must retain second-attempt evidence and publish it only when complete');
assert.match(trend,/attempt3Known:knownAttempt3[\s\S]*attempt3:attemptEvidenceComplete\?knownAttempt3:null/,'reader must retain third-plus attempt evidence and publish it only when complete');
assert.match(trend,/evidenceIncomplete/,'read model must disclose incomplete evidence instead of presenting partial numbers as final');
assert.match(trend,/DASHBOARD_LOW_COVERAGE/,'low-coverage dashboard reads must trigger scoped background repair');
assert.match(runtime,/import '\.\/v263DeliveryKpiTrendPatch\.js';/,'V263 trend route must activate in normal runtime as data source even though live chart rendering is retired');

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
console.log('[V509/V487/V267/V265] report export clarity + evidence-aware delivery summary + no-live-trend contract + storage safety gate passed · V486 semantic START behavior verified structurally');
