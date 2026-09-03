import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  readV293WhppHistoricalRangeFacts,
  mergeV293WhppHistoricalRange,
  V293_WHPP_HISTORICAL_RANGE_TRUTH_ID,
  V293_WHPP_HISTORY_MEMBERSHIP_INTEGRITY_ID,
  V419_WHPP_HISTORY_SUMMARY_FAILCLOSED_ID,
  V419_WHPP_HISTORY_FULL_METRIC_ID
} from '../src/v293WhppHistoricalRangeTruth.js';
import {
  readV284RegionFacts,
  readV284DailyFacts,
  invalidateV284DailyMembershipTruth,
  V419_WHPP_RANGE_METRIC_PARITY_ID
} from '../src/v284DailyMembershipTruth.js';
import { readV237DashboardTrends, V419_WHPP_TREND_TRUTH_ID } from '../src/v237DashboardTrendRead.js';

for(const file of [
  'src/v284DailyMembershipTruth.js',
  'src/v284MembershipEvidenceCoverage.js',
  'src/v293WhppHistoricalRangeTruth.js',
  'src/rangeDashboardStoreV284.js',
  'src/v236DashboardCurrentRoutePatch.js',
  'src/v237DashboardTrendRead.js',
  'public/v132-whpp-seven-business-fast.js'
])execFileSync(process.execPath,['--check',file],{stdio:'pipe'});

const source=fs.readFileSync('src/v293WhppHistoricalRangeTruth.js','utf8');
const dailyTruthSource=fs.readFileSync('src/v284DailyMembershipTruth.js','utf8');
const coverageSource=fs.readFileSync('src/v284MembershipEvidenceCoverage.js','utf8');
const rangeSource=fs.readFileSync('src/rangeDashboardStoreV284.js','utf8');
const routeSource=fs.readFileSync('src/v236DashboardCurrentRoutePatch.js','utf8');
const trendSource=fs.readFileSync('src/v237DashboardTrendRead.js','utf8');
const publicWhppSource=fs.readFileSync('public/v132-whpp-seven-business-fast.js','utf8');
assert.match(source,/2026-08-25-v293-whpp-history-range-fallback-v1/);
assert.match(source,/2026-08-29-v293-whpp-history-membership-integrity-v2/);
assert.match(source,/2026-09-03-v419-whpp-history-summary-metric-failclosed-v1/);
assert.match(source,/2026-09-03-v419-whpp-history-full-range-metrics-v1/);
assert.match(source,/FROM business_daily_reports r/,'WHPP historical denominator must use its preserved daily report ledger');
assert.match(source,/LEFT JOIN business_history_summary h/,'WHPP historical status facts must use its completed history summary');
assert.match(source,/FROM business_daily_parse_rows/,'V293 must distinguish fully rotated WHPP parse rows from partial membership damage');
assert.match(source,/WHPP_STANDARD_DAILY_INCOMPLETE/,'partial WHPP membership must fail closed instead of being history-filled');
assert.match(source,/WHPP_HISTORY_SUMMARY_REJECTED_DENOMINATOR/,'mismatched WHPP history summary must be explicitly rejected as analysis truth');
assert.doesNotMatch(source,/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b\s+(?:INTO|FROM|business_)/i,'V293 historical fallback must stay read-only');

assert.match(dailyTruthSource,/V419_WHPP_RANGE_METRIC_PARITY_ID/,'V284 daily truth must identify the WHPP full-range parity revision');
assert.match(dailyTruthSource,/pendingDays>=1/,'WHPP range truth must calculate Pending1+ from daily immutable membership');
assert.match(dailyTruthSource,/pendingDays>=2/,'WHPP range truth must calculate Pending2+ from daily immutable membership');
assert.match(dailyTruthSource,/ocDays>=3/,'WHPP range truth must calculate OC3+ instead of silently publishing zero');
assert.match(dailyTruthSource,/activeShopFlag=0/,'active shop rows must stay out of ordinary WHPP Pending\/OC\/cycle anomaly buckets');
assert.match(dailyTruthSource,/SUM\(isCancelled\) cancelled/,'WHPP range truth must preserve order-cancelled as its own normal terminal bucket');
assert.match(dailyTruthSource,/SUM\(CASE WHEN isTerminal=0 AND isSpecial=0 AND activeShopFlag=0 THEN 1 ELSE 0 END\) unresolved/,'WHPP unresolved must use the single-day actionable rule instead of subtraction');
assert.match(coverageSource,/WHPP_EXTRA_KEYS/,'proven-range aggregation must carry the complete WHPP metric set');
assert.match(coverageSource,/V419_WHPP_PROVEN_RANGE_METRIC_PARITY_ID/);
assert.match(rangeSource,/mergeV293WhppHistoricalRange/,'V284 visible range must merge the WHPP historical fallback');
assert.match(rangeSource,/visibleWhpp=mergeFacts\('WHPP',whppDaily\)/,'homepage WHPP card must aggregate the merged five-day facts');
assert.match(rangeSource,/visibleSourceTotal=n\(truth\.ccsl\?\.total\)\+n\(truth\.shopee\?\.total\)\+n\(visibleWhpp\.total\)/,'seven-business homepage total must include full WHPP period');
assert.match(rangeSource,/aggregateFlatWhppRegions/,'WHPP period state must expose PP\/PV region facts from the same daily membership truth');
assert.match(rangeSource,/regionCoverageComplete/,'WHPP range must explicitly disclose whether PP\/PV region evidence covers the whole denominator');
assert.match(rangeSource,/V419_WHPP_RANGE_VISIBLE_METRIC_ID/);
assert.match(routeSource,/const exactUnresolved=isWhpp\?optionalNumber/,'exact unresolved override must be scoped to WHPP only');
assert.match(routeSource,/if\(isWhpp&&!coverageComplete\)/,'PP\/PV fail-closed null behavior must be scoped to WHPP only');
assert.match(routeSource,/regionCoverageComplete/,'range API must propagate WHPP PP\/PV coverage truth');
assert.match(routeSource,/normalized\[key\]=null/,'incomplete WHPP region coverage must fail closed to null, not fake zero');
assert.match(trendSource,/V419_WHPP_TREND_TRUTH_ID/,'WHPP trend truth must have an explicit owner id');
assert.match(trendSource,/FROM business_daily_reports WHERE businessType='WHPP'/,'WHPP trend dates must come from the WHPP daily report ledger, not unified-import dates');
assert.match(trendSource,/mergeV293WhppHistoricalRange/,'WHPP trend must restore verified rotated history through V293');
assert.match(trendSource,/type==='WHPP'\?readWhppTrendDaily/,'only WHPP trends may switch to the new ledger/history path');
assert.match(trendSource,/V240_EXACT_DAILY_RATE_CACHE_ONLY/,'all non-WHPP trend ownership must remain on the existing V240 cache-only path');
assert.match(publicWhppSource,/incomplete\?'—'/,'WHPP range UI must render incomplete PP\/PV evidence as dash');
assert.match(publicWhppSource,/历史PP\/PV区域证据不完整/,'WHPP UI must explain why incomplete historical region values are not shown as zero');
assert.match(publicWhppSource,/ce_qc_v132_whpp_fast_summary_v419_2/,'WHPP V419 range truth must not reuse the stale pre-parity browser cache');

const db=new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE business_daily_reports(businessType TEXT,reportDate TEXT,totalCount INTEGER,summaryJson TEXT);
  CREATE TABLE business_history_summary(businessType TEXT,reportDate TEXT,summaryJson TEXT);
  CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT,rowJson TEXT);
  CREATE TABLE unified_import_batches(reportDate TEXT,snapshotId TEXT,createdAt TEXT,batchId TEXT,status TEXT);
  CREATE TABLE unified_import_rows(snapshotId TEXT,reportDate TEXT,businessType TEXT,shipmentCode TEXT,regionCode TEXT);
  CREATE TABLE final_rows(shipmentCode TEXT,reportDate TEXT,isPod INTEGER,rawJson TEXT,primaryCategory TEXT,category TEXT,lastEventTime TEXT,pendingDays INTEGER,ocDays INTEGER,cycleCountDays INTEGER,shopState TEXT,shopRetentionNaturalDays INTEGER);
  CREATE TABLE business_final_rows(businessType TEXT,shipmentCode TEXT,reportDate TEXT,isPod INTEGER,rawJson TEXT,currentMainCategory TEXT,primaryCategory TEXT,podAttemptNo INTEGER,currentAttemptNo INTEGER,latestEventTime TEXT,shopState TEXT,shopRetentionNaturalDays INTEGER);
`);
const report=db.prepare('INSERT INTO business_daily_reports(businessType,reportDate,totalCount,summaryJson) VALUES(?,?,?,?)');
const history=db.prepare('INSERT INTO business_history_summary(businessType,reportDate,summaryJson) VALUES(?,?,?)');
const member=db.prepare('INSERT INTO business_daily_parse_rows(businessType,reportDate,shipmentCode) VALUES(?,?,?)');
const fixtures=[
  ['2026-08-17',22,10],['2026-08-18',36,14],['2026-08-19',156,113],['2026-08-20',25,15],['2026-08-21',140,59]
];
for(const [reportDate,total,pod] of fixtures){
  report.run('WHPP',reportDate,total,'{}');
  const fullMetricFixture=reportDate==='2026-08-17'?{
    pending1:3,pending2:2,pending3:1,oc3:1,returned:2,cancelled:1,unresolved:5,delivery:2,
    ccslCnDiversion:1,ccslZtDiversion:1,ccsl580Retention:1,phnomPenhShop:2,provinceShop:1,shopTotal:3
  }:{};
  history.run('WHPP',reportDate,JSON.stringify({reportDate,total,pod,podRate:Number((pod*100/total).toFixed(2)),pending1:reportDate==='2026-08-21'?1:0,ocCurrent:0,oc1:0,returned:0,...fullMetricFixture}));
}
for(let i=1;i<=140;i++)member.run('WHPP','2026-08-21',`WHPP-CURRENT-${String(i).padStart(3,'0')}`);

// A standard zero day is a complete 0/0 truth, not a reason to resurrect history.
report.run('WHPP','2026-08-22',0,'{}');
history.run('WHPP','2026-08-22',JSON.stringify({reportDate:'2026-08-22',total:0,pod:0}));

// Partial membership damage must never be hidden by a perfect-looking history summary.
report.run('WHPP','2026-08-23',236,'{}');
history.run('WHPP','2026-08-23',JSON.stringify({reportDate:'2026-08-23',total:236,pod:180}));
for(let i=1;i<=235;i++)member.run('WHPP','2026-08-23',`WHPP-PARTIAL-${String(i).padStart(3,'0')}`);

// Fully rotated membership with a denominator-mismatched history summary is
// deliberately stuffed with stale-looking analysis facts. None may be published.
report.run('WHPP','2026-08-24',10,'{}');
history.run('WHPP','2026-08-24',JSON.stringify({
  reportDate:'2026-08-24',total:9,pod:8,sameDayPod:7,ocCurrent:6,pendingNonContinuous:5,pending1:5,pending2:4,pending3:4,oc1:3,oc2:2,oc3:2,cycle2:2,
  shopRetention2:2,workOrder:2,inboundNoScan:2,provinceOpen:2,returned:2,cancelled:2,unresolved:7,delivery:3,
  ccslCnDiversion:2,ccslZtDiversion:2,ccsl580Retention:2,phnomPenhShop:2,provinceShop:2,shopTotal:4,
  attempt1:5,attempt2:2,attempt3:1,attemptUnknown:1,signingDaysSum:33,signingDaysCount:8
}));

// History without a WHPP daily report is phantom data and must never enter the range.
history.run('WHPP','2026-08-25',JSON.stringify({reportDate:'2026-08-25',total:999,pod:999}));

const changesBefore=db.prepare('SELECT total_changes() changes').get().changes;
const historical=readV293WhppHistoricalRangeFacts('2026-08-17','2026-08-22',db);
assert.deepEqual(historical.map(row=>row.total),[22,36,156,25,140,0]);
assert.deepEqual(historical.map(row=>row.pod),[10,14,113,15,59,0]);
assert.ok(historical.every(row=>row.ready),'exact completed WHPP history summaries plus 0/0 must be publishable facts');
const fullHistory=historical.find(row=>row.reportDate==='2026-08-17');
assert.deepEqual({
  pending1:fullHistory.pending1,pending2:fullHistory.pending2,pending3:fullHistory.pending3,oc3:fullHistory.oc3,returned:fullHistory.returned,cancelled:fullHistory.cancelled,
  unresolved:fullHistory.unresolved,delivery:fullHistory.delivery,ccslCnDiversion:fullHistory.ccslCnDiversion,ccslZtDiversion:fullHistory.ccslZtDiversion,
  ccsl580Retention:fullHistory.ccsl580Retention,phnomPenhShop:fullHistory.phnomPenhShop,provinceShop:fullHistory.provinceShop,shopTotal:fullHistory.shopTotal
},{pending1:3,pending2:2,pending3:1,oc3:1,returned:2,cancelled:1,unresolved:5,delivery:2,ccslCnDiversion:1,ccslZtDiversion:1,ccsl580Retention:1,phnomPenhShop:2,provinceShop:1,shopTotal:3},'verified rotated WHPP history must restore the complete visible range metric set');
assert.equal(fullHistory.historyFullMetricId,V419_WHPP_HISTORY_FULL_METRIC_ID);

const canonical=[{reportDate:'2026-08-21',businessType:'WHPP',regionCode:'UNKNOWN',total:140,matched:140,pod:59,ready:true,historyFallback:false}];
const merged=mergeV293WhppHistoricalRange(canonical,'2026-08-17','2026-08-22',db);
assert.equal(merged.length,6,'four fully rotated historical days, one current canonical day and one true-zero day must be visible');
assert.deepEqual(merged.map(row=>row.total),[22,36,156,25,140,0]);
assert.equal(merged.reduce((sum,row)=>sum+Number(row.total||0),0),379,'08-17..08-22 WHPP period must total 379');
assert.equal(merged.reduce((sum,row)=>sum+Number(row.pod||0),0),211,'verified historical WHPP POD facts must remain available across the range');
assert.equal(merged.find(row=>row.reportDate==='2026-08-21').historyFallback,false,'the complete current canonical V284 day must outrank history fallback');
assert.equal(merged.find(row=>row.reportDate==='2026-08-22').historyFallback,false,'0/0 is standard truth and must not be history-recovered');

assert.throws(
  ()=>mergeV293WhppHistoricalRange([{reportDate:'2026-08-23',businessType:'WHPP',total:235,matched:235,pod:180,ready:true}],'2026-08-23','2026-08-23',db),
  error=>error?.code==='WHPP_STANDARD_DAILY_INCOMPLETE'&&error?.expected===236&&error?.actual===235,
  '236/235 partial membership must fail closed even when history also says 236'
);

const unverified=mergeV293WhppHistoricalRange([],'2026-08-24','2026-08-24',db);
assert.equal(unverified.length,1);
assert.equal(unverified[0].total,10,'daily report denominator must remain visible when parse rows were fully rotated');
assert.equal(unverified[0].ready,false,'history total 9 cannot publish as completed truth against daily denominator 10');
assert.equal(unverified[0].historyFallback,false,'mismatched history must not be accepted as fallback');
assert.equal(unverified[0].historySummaryVerified,false);
assert.equal(unverified[0].historySource,'WHPP_HISTORY_SUMMARY_REJECTED_DENOMINATOR');
assert.equal(unverified[0].historyFailClosedId,V419_WHPP_HISTORY_SUMMARY_FAILCLOSED_ID);
assert.equal(unverified[0].historyFullMetricId,V419_WHPP_HISTORY_FULL_METRIC_ID);
for(const key of ['pod','sameDayPod','ocCurrent','pendingNonContinuous','pending1','pending2','pending3','oc1','oc2','oc3','cycle2','shopRetention2','workOrder','inboundNoScan','provinceOpen','returned','cancelled','unresolved','delivery','ccslCnDiversion','ccslZtDiversion','ccsl580Retention','phnomPenhShop','provinceShop','shopTotal','attempt1','attempt2','attempt3','attemptUnknown','signingDaysSum','signingDaysCount']){
  assert.equal(unverified[0][key],0,`unverified WHPP history metric ${key} must fail closed to zero instead of leaking stale summary data`);
}
assert.equal(unverified[0].podRate,0);
assert.equal(unverified[0].ocRate,0);
assert.equal(unverified[0].attemptCoverageRate,null);
assert.equal(unverified[0].avgPodDays,null);

const phantom=readV293WhppHistoricalRangeFacts('2026-08-25','2026-08-25',db);
assert.equal(phantom.length,0,'history without a WHPP daily report must stay invisible');
const changesAfter=db.prepare('SELECT total_changes() changes').get().changes;
assert.equal(changesAfter,changesBefore,'V293 reads must not mutate SQLite');

// Execute the real V419 WHPP trend path against rotated history. There are no
// unified-import dates in this fixture, so any returned points prove the trend
// dates come from business_daily_reports and V293 restores the archived metrics.
const whppTrend=readV237DashboardTrends('WHPP','2026-08-17','2026-08-20',db);
assert.deepEqual(whppTrend.dates,['2026-08-17','2026-08-18','2026-08-19','2026-08-20']);
assert.equal(whppTrend.source,'V419_WHPP_DAILY_LEDGER_MEMBERSHIP_PLUS_VERIFIED_HISTORY');
assert.equal(whppTrend.whppTrendTruthId,V419_WHPP_TREND_TRUTH_ID);
assert.deepEqual(whppTrend.ticket,[22,36,156,25]);
assert.deepEqual(whppTrend.pod,[10,14,113,15]);
assert.deepEqual(whppTrend.podRate,[45.45,38.89,72.44,60]);
assert.deepEqual(whppTrend.returned,[2,0,0,0]);
assert.deepEqual(whppTrend.returnRate,[9.09,0,0,0]);
assert.deepEqual(whppTrend.pending1,[3,0,0,0]);
assert.deepEqual(whppTrend.pendingRate,[13.64,0,0,0]);
assert.deepEqual(whppTrend.missingDates,[],'verified rotated WHPP history must remain publishable in trend charts');
const whppRecentTrend=readV237DashboardTrends('WHPP','2026-08-20','2026-08-20',db);
assert.deepEqual(whppRecentTrend.dates,['2026-08-17','2026-08-18','2026-08-19','2026-08-20'],'single-day WHPP board must use the latest seven WHPP report-ledger dates, not unified-import dates');

// Execute the real V284 WHPP SQL. This catches SQL errors that would otherwise be
// hidden by queryWhppRegionFacts' defensive fallback and proves single-day parity.
const v284Date='2026-08-26';
const insertV284Member=db.prepare('INSERT INTO business_daily_parse_rows(businessType,reportDate,shipmentCode,rowJson) VALUES(?,?,?,?)');
const insertV284Final=db.prepare('INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,rawJson,currentMainCategory,primaryCategory,podAttemptNo,currentAttemptNo,latestEventTime,shopState,shopRetentionNaturalDays) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
const v284Rows=[
  ['WH-RANGE-PENDING2','PP','Pending2次',0,{currentState:'PENDING',Pending当前次数:2,Pending不连续:'是'}],
  ['WH-RANGE-OC3','PV','OC3天及以上',0,{currentState:'OC',OC天数:3}],
  ['WH-RANGE-SHOP','PP','门店滞留',0,{currentState:'SHOP_RETENTION',shopState:'SHOP_ARRIVED_CURRENT',shopRetentionNaturalDays:2,Pending当前次数:3,OC天数:3}],
  ['WH-RANGE-580','PV','CCSL580_RETENTION',0,{currentState:'CCSL580_RETENTION',specialState:'CCSL580_RETENTION',Pending当前次数:3,OC天数:3}],
  ['WH-RANGE-CANCEL','PP','订单取消',0,{currentState:'ORDER_CANCELLED',订单取消:'是'}],
  ['WH-RANGE-POD','PP','POD',1,{currentState:'POD',是否POD:'是',POD时间:v284Date}],
  ['WH-RANGE-DELIVERY','PP','派送中',0,{currentState:'DELIVERY',派送中停留天数:1}],
  ['WH-RANGE-CN','PV','CCSLCN_DIVERSION',0,{currentState:'CCSLCN_DIVERSION',specialState:'CCSLCN_DIVERSION'}],
  ['WH-RANGE-ZT','PP','CCSLZT_DIVERSION',0,{currentState:'CCSLZT_DIVERSION',specialState:'CCSLZT_DIVERSION'}]
];
for(const [bill,region,category,isPod,raw] of v284Rows){
  insertV284Member.run('WHPP',v284Date,bill,JSON.stringify({shipmentCode:bill,regionCode:region}));
  insertV284Final.run('WHPP',bill,v284Date,isPod,JSON.stringify({shipmentCode:bill,regionCode:region,...raw}),'',category,0,0,isPod?v284Date:'',String(raw.shopState||''),Number(raw.shopRetentionNaturalDays||0));
}
invalidateV284DailyMembershipTruth();
const regionFacts=readV284RegionFacts(v284Date,v284Date,db).rows.filter(row=>row.businessType==='WHPP');
const regionTotals=Object.fromEntries(regionFacts.map(row=>[row.regionCode,row.total]));
assert.deepEqual(regionTotals,{PP:6,PV:3},'WHPP V284 PP/PV region totals must come directly from the same nine daily members');
const v284Fact=readV284DailyFacts(v284Date,v284Date,db).find(row=>row.businessType==='WHPP');
assert.ok(v284Fact,'V284 WHPP SQL must return a daily fact instead of silently falling back to an empty array');
assert.deepEqual({
  total:v284Fact.total,matched:v284Fact.matched,pod:v284Fact.pod,pendingNonContinuous:v284Fact.pendingNonContinuous,
  pending1:v284Fact.pending1,pending2:v284Fact.pending2,pending3:v284Fact.pending3,ocCurrent:v284Fact.ocCurrent,oc1:v284Fact.oc1,oc2:v284Fact.oc2,oc3:v284Fact.oc3,
  cancelled:v284Fact.cancelled,unresolved:v284Fact.unresolved,delivery:v284Fact.delivery,shopRetention2:v284Fact.shopRetention2,
  ccslCnDiversion:v284Fact.ccslCnDiversion,ccslZtDiversion:v284Fact.ccslZtDiversion,ccsl580Retention:v284Fact.ccsl580Retention,
  phnomPenhShop:v284Fact.phnomPenhShop,provinceShop:v284Fact.provinceShop,shopTotal:v284Fact.shopTotal
},{total:9,matched:9,pod:1,pendingNonContinuous:1,pending1:1,pending2:1,pending3:0,ocCurrent:1,oc1:1,oc2:1,oc3:1,cancelled:1,unresolved:3,delivery:1,shopRetention2:1,ccslCnDiversion:1,ccslZtDiversion:1,ccsl580Retention:1,phnomPenhShop:1,provinceShop:0,shopTotal:1},'WHPP V284 must match single-day actionable rules: shop/special rows excluded from ordinary anomalies while their own buckets stay visible');

assert.equal(V293_WHPP_HISTORICAL_RANGE_TRUTH_ID,'2026-08-25-v293-whpp-history-range-fallback-v1');
assert.equal(V293_WHPP_HISTORY_MEMBERSHIP_INTEGRITY_ID,'2026-08-29-v293-whpp-history-membership-integrity-v2');
assert.equal(V419_WHPP_HISTORY_SUMMARY_FAILCLOSED_ID,'2026-09-03-v419-whpp-history-summary-metric-failclosed-v1');
assert.equal(V419_WHPP_HISTORY_FULL_METRIC_ID,'2026-09-03-v419-whpp-history-full-range-metrics-v1');
assert.equal(V419_WHPP_RANGE_METRIC_PARITY_ID,'2026-09-03-v419-whpp-range-daily-metric-parity-v1');
assert.equal(V419_WHPP_TREND_TRUTH_ID,'2026-09-03-v419-whpp-ledger-history-trend-truth-v1');

db.close();
console.log('[V419/V293] WHPP range smoke passed · real V284 SQL + V237 trend truth executed · full Pending1/2/3 + OC1/2/3 + terminal/shop/diversion metrics preserved · verified history restores full cards and trends · mismatched history publishes denominator only · incomplete PP/PV evidence renders dash');
