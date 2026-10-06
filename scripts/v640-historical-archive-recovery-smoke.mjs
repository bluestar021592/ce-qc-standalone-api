import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const evidence=fs.readFileSync(path.join(root,'src','historicalMemberEvidence.js'),'utf8');
const worker=fs.readFileSync(path.join(root,'src','historicalMemberEvidenceWorker.js'),'utf8');
const manager=fs.readFileSync(path.join(root,'src','historicalEvidenceWorkerManager.js'),'utf8');
const home=fs.readFileSync(path.join(root,'src','homeQualitySummary.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const js=fs.readFileSync(path.join(root,'public','v625-shell.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','v625-shell.html'),'utf8');

assert.match(evidence,/recoverV485ArchivedTrackEvents/,'V485 archived track recovery missing');
assert.match(evidence,/recoverV497ArchivedConfirmPodDates/,'V497 archived confirm POD recovery missing');
assert.match(evidence,/recoverV498SavedShopeePodDates/,'V498 saved Shopee POD recovery missing');
assert.match(evidence,/const podBills=new Set\(\)/,'historical POD membership set missing');
assert.match(evidence,/archiveEventPod/,'track-80\/POD detection missing');
assert.match(evidence,/recoverHistoricalGroupedEvidence/,'grouped archive recovery missing');

assert.match(worker,/recoverHistoricalGroupedEvidence/,'archive worker must run grouped recovery');
assert.match(manager,/fork\(WORKER_FILE/,'archive recovery must run in child process');
assert.match(manager,/JOB_TIMEOUT_MS=10\*60_000/,'archive worker must be bounded');
assert.match(manager,/readOnly:true,networkCalls:0,databaseWrites:0/,'archive worker public contract must remain read-only');
assert.match(manager,/function covers\(/,'covering job reuse missing');

assert.match(home,/ensureHistoricalEvidenceJob/,'home timing must use non-blocking evidence worker');
assert.match(home,/historicalEvidenceRecovery:\{state:job\.state/,'home must expose archive recovery state');
assert.match(home,/timingForBatchWithArchive/,'selected-day timing enrichment missing');
assert.match(home,/historical_archive/,'archive-derived timing evidence source missing');

assert.match(server,/historicalEvidenceRecovery:\{state:recoveryJob\.state/,'WHPP board must expose recovery state');
assert.match(server,/archivePod:true/,'WHPP board must mark archive-proven POD');
assert.match(server,/async \(req, res\) =>/,'business route must support non-blocking archive job');

assert.match(js,/scheduleHistoricalEvidenceRefresh/,'browser auto-refresh after archive recovery missing');
assert.match(js,/historicalEvidenceRecovery\?\.state==='RUNNING'/,'home auto-poll trigger missing');
assert.match(js,/state\?\.historicalEvidenceRecovery\?\.state/,'business auto-poll trigger missing');

assert.match(html,/v625-shell\.js\?v=\d{8}-v\d{3,}-1/,'V640+ JS cache bust missing');
assert.match(html,/v625-shell\.css\?v=\d{8}-v\d{3,}-1/,'V640+ CSS cache bust missing');

console.log('[V640] non-blocking exact-member archive recovery + auto-refresh smoke passed');
