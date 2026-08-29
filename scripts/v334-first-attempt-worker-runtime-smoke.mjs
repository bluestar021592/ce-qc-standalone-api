import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ce-qc-v343-first-worker-'));
const env={...process.env,DATA_DIR:root,DB_FILE:path.join(root,'v343-first-worker.db'),ACCESS_MODE:'LOCAL',SQLITE_MMAP_BYTES:'0',SQLITE_CACHE_KIB:'8192',NODE_ENV:'test',CE_QC_DISABLE_V246_TRACKING:'1',REQUEST_TIMEOUT_MS:'1000'};
Object.assign(process.env,env);
const {getDb,closeDb}=await import('../src/db.js');
let db=getDb();const now='2026-07-15T20:00:00Z';
function seed(date,bill,events,{latestEventTime='',region='PP'}={}){
  const batch=`B-${date}`,snap=`S-${date}`;
  db.prepare(`INSERT INTO unified_snapshots(snapshotId,batchId,reportDate,status,payloadJson,createdAt) VALUES(?,?,?,?,?,?)`).run(snap,batch,date,'COMPLETED','{}',now);
  db.prepare(`INSERT INTO unified_import_batches(batchId,snapshotId,reportDate,sourceName,fileHash,status,summaryJson,warningsJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?)`).run(batch,snap,date,'cn-history.xlsx',`hash-${date}`,'VALID','{}','[]',now);
  db.prepare(`INSERT INTO unified_import_rows(batchId,snapshotId,reportDate,businessType,shipmentCode,regionCode,recipientRaw,recipientNormalized,sheetName,rowNumber,classificationReason,rowJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(batch,snap,date,'SHOPEECN',bill,region,'SHOPEECN','SHOPEECN','日报',1,'V343','{}',now);
  const terminal=latestEventTime||events.at(-1)?.[0]||'';
  db.prepare(`INSERT INTO business_final_rows(businessType,shipmentCode,reportDate,isPod,primaryCategory,recipient_group,latestEventTime,rawJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)`).run('SHOPEE',bill,date,1,'POD','CN',terminal,'{}',now,now);
  const stmt=db.prepare(`INSERT INTO business_track_events(businessType,shipmentCode,reportDate,eventTime,eventCode,rawJson,createdAt) VALUES(?,?,?,?,?,?,?)`);
  for(const [eventTime,eventCode,desc=''] of events)stmt.run('SHOPEE',bill,date,eventTime,eventCode,JSON.stringify({eventTime,eventCode,trackingEventDescZh:desc}),now);
}
seed('2026-07-13','CN-FIRST-1',[[ '2026-07-13 09:00:00','70','START'],['2026-07-13 18:00:00','80','POD']],{region:'PP'});
seed('2026-07-14','CN-SECOND-1',[[ '2026-07-14 08:00:00','70','START'],['2026-07-14 10:00:00','150','Pending'],['2026-07-14 14:00:00','70','START'],['2026-07-14 19:00:00','80','POD']],{region:'PV'});
// Terminal POD evidence without a real dispatch START is still POD truth, but it
// must not create a Shopee signing-day sample or a PP/PV signing average.
seed('2026-07-15','CN-TERMINAL-POD-ONLY',[],{latestEventTime:'2026-07-17 18:00:00',region:'PV'});
closeDb();
execFileSync(process.execPath,['scripts/v329-three-business-cache-worker.mjs','--type=SHOPEECN','--to=2026-07-15'],{cwd:process.cwd(),env,stdio:'pipe',timeout:30000});
db=getDb();
const rows=db.prepare(`SELECT reportDate,pod,attempt1,attempt2,firstAttemptEligible,firstAttemptSuccess,firstAttemptUnknownPod,signingDaysCount,signingDaysSum,ppSigningDaysCount,ppSigningDaysSum,pvSigningDaysCount,pvSigningDaysSum,cacheRevision,source FROM v329_three_business_daily_cache WHERE businessType='SHOPEECN' ORDER BY reportDate`).all();
assert.equal(rows.length,3);assert.deepEqual(rows.map(r=>r.reportDate),['2026-07-13','2026-07-14','2026-07-15']);
assert.equal(Number(rows[0].pod),1);assert.equal(Number(rows[0].attempt1),1);assert.equal(Number(rows[0].attempt2),0);assert.equal(Number(rows[0].firstAttemptEligible),1);assert.equal(Number(rows[0].firstAttemptSuccess),1);assert.equal(Number(rows[0].firstAttemptUnknownPod),0);assert.equal(Number(rows[0].signingDaysCount),1);assert.equal(Number(rows[0].signingDaysSum),1);assert.equal(Number(rows[0].ppSigningDaysCount),1);assert.equal(Number(rows[0].ppSigningDaysSum),1);assert.equal(Number(rows[0].pvSigningDaysCount),0);
assert.equal(Number(rows[1].pod),1);assert.equal(Number(rows[1].attempt1),0);assert.equal(Number(rows[1].attempt2),1);assert.equal(Number(rows[1].firstAttemptEligible),1);assert.equal(Number(rows[1].firstAttemptSuccess),0);assert.equal(Number(rows[1].firstAttemptUnknownPod),0);assert.equal(Number(rows[1].signingDaysCount),1);assert.equal(Number(rows[1].signingDaysSum),1);assert.equal(Number(rows[1].ppSigningDaysCount),0);assert.equal(Number(rows[1].pvSigningDaysCount),1);assert.equal(Number(rows[1].pvSigningDaysSum),1);assert.match(String(rows[1].source),/V343_FINAL_SAVED_MEMBER_ALIGNED_STRICT_START_POD_REGION/);
assert.equal(Number(rows[2].pod),1);assert.equal(Number(rows[2].attempt1),0);assert.equal(Number(rows[2].attempt2),0);assert.equal(Number(rows[2].signingDaysCount),0);assert.equal(Number(rows[2].signingDaysSum),0);assert.equal(Number(rows[2].pvSigningDaysCount),0);assert.equal(Number(rows[2].pvSigningDaysSum),0);assert.equal(Number(rows[2].firstAttemptUnknownPod),1);
assert.ok(rows.every(r=>String(r.cacheRevision).includes('member-aligned-region-signing-v2')));
const ledger=db.prepare(`SELECT firstReportDate,podDate,terminalReason FROM qc_tracking_ledger WHERE shipmentCode='CN-TERMINAL-POD-ONLY'`).get();assert.equal(ledger.firstReportDate,'2026-07-15');assert.equal(ledger.podDate,'2026-07-17');assert.equal(ledger.terminalReason,'POD');
const {readV329ThreeBusinessDailyCache}=await import('../src/v329ThreeBusinessDailyCache.js');const history=readV329ThreeBusinessDailyCache('SHOPEECN','2026-07-15',db);assert.equal(history.daily[0].firstAttemptRate,100);assert.equal(history.daily[1].firstAttemptRate,0);assert.equal(history.daily[0].firstAttemptEvidenceComplete,true);assert.equal(history.daily[1].firstAttemptEvidenceComplete,true);assert.equal(history.daily[0].avgSigningDays,1);assert.equal(history.daily[0].ppAvgSigningDays,1);assert.equal(history.daily[0].pvAvgSigningDays,null);assert.equal(history.daily[1].avgSigningDays,1);assert.equal(history.daily[1].pvAvgSigningDays,1);assert.equal(history.daily[2].avgSigningDays,null);assert.equal(history.daily[2].pvAvgSigningDays,null);assert.equal(history.daily[2].firstAttemptRate,null);assert.equal(history.daily[2].signingSampleAvailable,false);
closeDb();fs.rmSync(root,{recursive:true,force:true});
console.log('[V343/V342] history worker runtime smoke passed · strict START attempts independent · terminal POD without dispatch START stays signing-unknown · PP/PV averages use the exact same real START-to-POD sample set · no production DB/network');
