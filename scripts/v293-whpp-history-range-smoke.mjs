import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { readV293WhppHistoricalRangeFacts,mergeV293WhppHistoricalRange,V293_WHPP_HISTORICAL_RANGE_TRUTH_ID } from '../src/v293WhppHistoricalRangeTruth.js';

const source=fs.readFileSync('src/v293WhppHistoricalRangeTruth.js','utf8');
const rangeSource=fs.readFileSync('src/rangeDashboardStoreV284.js','utf8');
assert.match(source,/2026-08-25-v293-whpp-history-range-fallback-v1/);
assert.match(source,/FROM business_daily_reports r/,'WHPP historical denominator must use its preserved daily report ledger');
assert.match(source,/LEFT JOIN business_history_summary h/,'WHPP historical status facts must use its completed history summary');
assert.doesNotMatch(source,/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b\s+(?:INTO|FROM|business_)/i,'V293 historical fallback must stay read-only');
assert.match(rangeSource,/mergeV293WhppHistoricalRange/,'V284 visible range must merge the WHPP historical fallback');
assert.match(rangeSource,/visibleWhpp=mergeFacts\('WHPP',whppDaily\)/,'homepage WHPP card must aggregate the merged five-day facts');
assert.match(rangeSource,/visibleSourceTotal=n\(truth\.ccsl\?\.total\)\+n\(truth\.shopee\?\.total\)\+n\(visibleWhpp\.total\)/,'seven-business homepage total must include full WHPP period');

const db=new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE business_daily_reports(businessType TEXT,reportDate TEXT,totalCount INTEGER,summaryJson TEXT);
  CREATE TABLE business_history_summary(businessType TEXT,reportDate TEXT,summaryJson TEXT);
`);
const report=db.prepare('INSERT INTO business_daily_reports(businessType,reportDate,totalCount,summaryJson) VALUES(?,?,?,?)');
const history=db.prepare('INSERT INTO business_history_summary(businessType,reportDate,summaryJson) VALUES(?,?,?)');
const fixtures=[
  ['2026-08-17',22,10],['2026-08-18',36,14],['2026-08-19',156,113],['2026-08-20',25,15],['2026-08-21',140,59]
];
for(const [reportDate,total,pod] of fixtures){
  report.run('WHPP',reportDate,total,'{}');
  history.run('WHPP',reportDate,JSON.stringify({reportDate,total,pod,podRate:Number((pod*100/total).toFixed(2)),pending1:reportDate==='2026-08-21'?1:0,ocCurrent:0,oc1:0,returned:0}));
}
const changesBefore=db.prepare('SELECT total_changes() changes').get().changes;
const historical=readV293WhppHistoricalRangeFacts('2026-08-17','2026-08-21',db);
assert.deepEqual(historical.map(row=>row.total),[22,36,156,25,140]);
assert.deepEqual(historical.map(row=>row.pod),[10,14,113,15,59]);
assert.ok(historical.every(row=>row.ready),'completed WHPP history summaries must be publishable facts');

const canonical=[{reportDate:'2026-08-21',businessType:'WHPP',regionCode:'UNKNOWN',total:140,matched:140,pod:59,ready:true,historyFallback:false}];
const merged=mergeV293WhppHistoricalRange(canonical,'2026-08-17','2026-08-21',db);
assert.equal(merged.length,5,'four rotated historical days plus current canonical day must be visible');
assert.deepEqual(merged.map(row=>row.total),[22,36,156,25,140]);
assert.equal(merged.reduce((sum,row)=>sum+Number(row.total||0),0),379,'08-17..08-21 WHPP period must total 379');
assert.equal(merged.reduce((sum,row)=>sum+Number(row.pod||0),0),211,'historical WHPP POD facts must remain available across the range');
assert.equal(merged.at(-1).historyFallback,false,'the complete current canonical V284 day must outrank history fallback');
const changesAfter=db.prepare('SELECT total_changes() changes').get().changes;
assert.equal(changesAfter,changesBefore,'V293 reads must not mutate SQLite');
assert.equal(V293_WHPP_HISTORICAL_RANGE_TRUTH_ID,'2026-08-25-v293-whpp-history-range-fallback-v1');

db.close();
console.log('[V293] WHPP history range smoke passed · rotated parse rows restored from preserved history · 22+36+156+25+140=379 · canonical 08-21 retained · SQLite unchanged');
