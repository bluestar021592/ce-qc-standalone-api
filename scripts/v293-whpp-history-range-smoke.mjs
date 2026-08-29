import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  readV293WhppHistoricalRangeFacts,
  mergeV293WhppHistoricalRange,
  V293_WHPP_HISTORICAL_RANGE_TRUTH_ID,
  V293_WHPP_HISTORY_MEMBERSHIP_INTEGRITY_ID
} from '../src/v293WhppHistoricalRangeTruth.js';

const source=fs.readFileSync('src/v293WhppHistoricalRangeTruth.js','utf8');
const rangeSource=fs.readFileSync('src/rangeDashboardStoreV284.js','utf8');
assert.match(source,/2026-08-25-v293-whpp-history-range-fallback-v1/);
assert.match(source,/2026-08-29-v293-whpp-history-membership-integrity-v2/);
assert.match(source,/FROM business_daily_reports r/,'WHPP historical denominator must use its preserved daily report ledger');
assert.match(source,/LEFT JOIN business_history_summary h/,'WHPP historical status facts must use its completed history summary');
assert.match(source,/FROM business_daily_parse_rows/,'V293 must distinguish fully rotated WHPP parse rows from partial membership damage');
assert.match(source,/WHPP_STANDARD_DAILY_INCOMPLETE/,'partial WHPP membership must fail closed instead of being history-filled');
assert.doesNotMatch(source,/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b\s+(?:INTO|FROM|business_)/i,'V293 historical fallback must stay read-only');
assert.match(rangeSource,/mergeV293WhppHistoricalRange/,'V284 visible range must merge the WHPP historical fallback');
assert.match(rangeSource,/visibleWhpp=mergeFacts\('WHPP',whppDaily\)/,'homepage WHPP card must aggregate the merged five-day facts');
assert.match(rangeSource,/visibleSourceTotal=n\(truth\.ccsl\?\.total\)\+n\(truth\.shopee\?\.total\)\+n\(visibleWhpp\.total\)/,'seven-business homepage total must include full WHPP period');

const db=new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE business_daily_reports(businessType TEXT,reportDate TEXT,totalCount INTEGER,summaryJson TEXT);
  CREATE TABLE business_history_summary(businessType TEXT,reportDate TEXT,summaryJson TEXT);
  CREATE TABLE business_daily_parse_rows(businessType TEXT,reportDate TEXT,shipmentCode TEXT);
`);
const report=db.prepare('INSERT INTO business_daily_reports(businessType,reportDate,totalCount,summaryJson) VALUES(?,?,?,?)');
const history=db.prepare('INSERT INTO business_history_summary(businessType,reportDate,summaryJson) VALUES(?,?,?)');
const member=db.prepare('INSERT INTO business_daily_parse_rows(businessType,reportDate,shipmentCode) VALUES(?,?,?)');
const fixtures=[
  ['2026-08-17',22,10],['2026-08-18',36,14],['2026-08-19',156,113],['2026-08-20',25,15],['2026-08-21',140,59]
];
for(const [reportDate,total,pod] of fixtures){
  report.run('WHPP',reportDate,total,'{}');
  history.run('WHPP',reportDate,JSON.stringify({reportDate,total,pod,podRate:Number((pod*100/total).toFixed(2)),pending1:reportDate==='2026-08-21'?1:0,ocCurrent:0,oc1:0,returned:0}));
}
for(let i=1;i<=140;i++)member.run('WHPP','2026-08-21',`WHPP-CURRENT-${String(i).padStart(3,'0')}`);

// A standard zero day is a complete 0/0 truth, not a reason to resurrect history.
report.run('WHPP','2026-08-22',0,'{}');
history.run('WHPP','2026-08-22',JSON.stringify({reportDate:'2026-08-22',total:0,pod:0}));

// Partial membership damage must never be hidden by a perfect-looking history summary.
report.run('WHPP','2026-08-23',236,'{}');
history.run('WHPP','2026-08-23',JSON.stringify({reportDate:'2026-08-23',total:236,pod:180}));
for(let i=1;i<=235;i++)member.run('WHPP','2026-08-23',`WHPP-PARTIAL-${String(i).padStart(3,'0')}`);

// Fully rotated membership without an exact completed history total remains visible but unready.
report.run('WHPP','2026-08-24',10,'{}');
history.run('WHPP','2026-08-24',JSON.stringify({reportDate:'2026-08-24',total:9,pod:8}));

// History without a WHPP daily report is phantom data and must never enter the range.
history.run('WHPP','2026-08-25',JSON.stringify({reportDate:'2026-08-25',total:999,pod:999}));

const changesBefore=db.prepare('SELECT total_changes() changes').get().changes;
const historical=readV293WhppHistoricalRangeFacts('2026-08-17','2026-08-22',db);
assert.deepEqual(historical.map(row=>row.total),[22,36,156,25,140,0]);
assert.deepEqual(historical.map(row=>row.pod),[10,14,113,15,59,0]);
assert.ok(historical.every(row=>row.ready),'exact completed WHPP history summaries plus 0/0 must be publishable facts');

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

const phantom=readV293WhppHistoricalRangeFacts('2026-08-25','2026-08-25',db);
assert.equal(phantom.length,0,'history without a WHPP daily report must stay invisible');

const changesAfter=db.prepare('SELECT total_changes() changes').get().changes;
assert.equal(changesAfter,changesBefore,'V293 reads must not mutate SQLite');
assert.equal(V293_WHPP_HISTORICAL_RANGE_TRUTH_ID,'2026-08-25-v293-whpp-history-range-fallback-v1');
assert.equal(V293_WHPP_HISTORY_MEMBERSHIP_INTEGRITY_ID,'2026-08-29-v293-whpp-history-membership-integrity-v2');

db.close();
console.log('[V293] WHPP history range smoke passed · exact current vs fully rotated vs partial-damage membership separated · 236/235 rejected · 0/0 retained · SQLite unchanged');
