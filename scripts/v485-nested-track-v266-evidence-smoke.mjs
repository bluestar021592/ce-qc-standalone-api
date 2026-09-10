import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { normalizeV485TrackRows, requestBillsFromV485Archive, V485_STRICT_TRACK_EVIDENCE_ID } from '../src/v485StrictTrackEvidence.js';
import { extractV497ConfirmPodEvidence, V497_ARCHIVED_CONFIRM_POD_DATE_ID } from '../src/v497ArchivedConfirmPodEvidence.js';
import { analyzeV246ShopeeAttemptCycle } from '../src/shopeeAttemptCycleV246.js';

for(const file of ['src/v485StrictTrackEvidence.js','src/v497ArchivedConfirmPodEvidence.js','src/v484StrictExportEvidenceOwner.js','src/v381ExportEvidenceRepair.js','src/v84ExportJobWorker.js']){
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}

const nested=[{
  shipmentCode:'TBKH-V485-001',
  events:[
    {trackingEventCode:'70',eventTime:'2026-07-01 09:00:00',trackingEventDescZh:'派送开始'},
    {eventCode:'150',eventTime:'2026-07-01 18:00:00',trackingEventDescZh:'Pending 派送失败'},
    {eventCode:'70',eventTime:'2026-07-02 08:00:00',trackingEventDescZh:'重新派送'},
    {eventCode:'80',eventTime:'2026-07-02 15:30:00',trackingEventDescZh:'签收成功'}
  ]
}];
const normalized=normalizeV485TrackRows(nested);
assert.equal(normalized.length,4,'nested child events must be flattened');
assert.ok(normalized.every(row=>row.shipmentCode==='TBKH-V485-001'),'child events must inherit parent shipmentCode');
const strict=analyzeV246ShopeeAttemptCycle(normalized);
assert.equal(strict.attemptNo,2,'70→failure→70 must resolve to attempt 2 after normalization');
assert.equal(strict.podDate,'2026-07-02','nested POD 80 must recover the real POD date');

const mixed=normalizeV485TrackRows([
  {shipmentCode:'TBKH-A',trackList:[{eventCode:70,eventTime:'2026-07-01 08:00:00'}]},
  {shipmentCode:'TBKH-B',trackList:[{eventCode:80,eventTime:'2026-07-01 16:00:00'}]}
],{fallbackBills:['TBKH-A','TBKH-B']});
assert.deepEqual([...new Set(mixed.map(row=>row.shipmentCode))].sort(),['TBKH-A','TBKH-B'],'multiple parent shipments must never bleed fallback identity across bills');
assert.deepEqual(requestBillsFromV485Archive(['TBKH-A','TBKH-B']),['TBKH-A','TBKH-B']);
assert.equal(V485_STRICT_TRACK_EVIDENCE_ID,'2026-09-09-v485-nested-track-normalizer-v266-archive-reuse-v1');

const confirmPayload={
  requestBody:{shipmentCodes:['SPE-V497-1','SPE-OTHER']},
  responseData:{success:true,data:[
    {shipmentCode:'SPE-V497-1',orderStatus:'85',updateTime:'2026-07-13 16:45:00',updatedAt:'2026-09-10 09:00:00'},
    {shipmentCode:'SPE-OTHER',orderStatus:'85',updateTime:'2026-07-14 10:00:00'}
  ]}
};
const confirmEvidence=extractV497ConfirmPodEvidence(confirmPayload,['SPE-V497-1']);
assert.equal(confirmEvidence.size,1,'V497 must recover only exact target members from archived confirm-query evidence');
assert.equal(confirmEvidence.get('SPE-V497-1')?.podDate,'2026-07-13');
assert.equal(confirmEvidence.get('SPE-V497-1')?.field,'updateTime');
assert.equal(confirmEvidence.get('SPE-V497-1')?.terminalProof,'orderStatus=85');
assert.equal(V497_ARCHIVED_CONFIRM_POD_DATE_ID,'2026-09-10-v497-v266-confirm85-pod-date-recovery-v1');
assert.equal(extractV497ConfirmPodEvidence({requestBody:{shipmentCodes:['SPE-V497-2']},responseData:{data:[{shipmentCode:'SPE-V497-2',orderStatus:'70',updateTime:'2026-07-13 12:00:00'}]}},['SPE-V497-2']).size,0,'nonterminal confirm updateTime must never become POD');
assert.equal(extractV497ConfirmPodEvidence({requestBody:{shipmentCodes:['SPE-V497-3']},responseData:{data:[{shipmentCode:'SPE-V497-3',orderStatus:'85',updatedAt:'2026-07-13 12:00:00'}]}},['SPE-V497-3']).size,0,'updatedAt alone must never become a POD timestamp even under orderStatus=85');
assert.equal(extractV497ConfirmPodEvidence(confirmPayload,['SPE-NOT-REQUESTED']).size,0,'archive request identity must match the exact export member');

const helper=fs.readFileSync('src/v485StrictTrackEvidence.js','utf8');
const confirmHelper=fs.readFileSync('src/v497ArchivedConfirmPodEvidence.js','utf8');
const owner=fs.readFileSync('src/v484StrictExportEvidenceOwner.js','utf8');
const repair=fs.readFileSync('src/v381ExportEvidenceRepair.js','utf8');
const parent=fs.readFileSync('src/v84ExportJobWorker.js','utf8');
assert.match(helper,/TRACK_FOLDER='tms-shipment-event_query'/,'V485 archive reuse must read only archived track-query evidence');
assert.match(helper,/payload\?\.responseData\?\.data\?\?payload\?\.responseData/,'archived successful CE response payload must be normalized');
assert.match(helper,/export async function archiveV485TrackQueryResponse/,'successful residual CE track responses must become reusable offline evidence');
assert.match(helper,/kind:'CE_API_EVIDENCE'/,'V485 residual archive must stay V266-compatible');
assert.match(helper,/mode==='recent'/);
assert.match(helper,/mode==='history'/);
assert.match(confirmHelper,/CONFIRM_FOLDER='otwms_order_confirm-query'/,'V497 must read only V266 confirm-query archives');
assert.match(confirmHelper,/text\(row\.orderStatus\)===\'85\'/,'V497 generic response timestamps require saved terminal orderStatus=85 proof');
assert.match(confirmHelper,/TERMINAL_STATUS_TIME_KEYS=\['updateTime','lastUpdateDate','scanTime','statusTime','modifyTime'\]/,'V497 terminal timestamp allowlist must exclude updatedAt/export time');
assert.match(confirmHelper,/requestBills\(payload\?\.requestBody\)/,'V497 archive reads must be exact-request-member gated');
assert.match(owner,/recoverV497ArchivedConfirmPodDates/,'V484 owner must reuse V266 archived confirm terminal evidence');
assert.match(owner,/recoverV485ArchivedTrackEvents/,'V484 owner must reuse V266 archive track evidence');
const saved=owner.indexOf("phase:'strictExportEvidenceSavedDone'");
const confirmRecent=owner.indexOf("applyConfirmArchivePass({businessType,range,rows,gaps,onProgress,mode:'recent'})");
const confirmHistory=owner.indexOf("applyConfirmArchivePass({businessType,range,rows,gaps,onProgress,mode:'history'})");
const trackRecent=owner.indexOf("applyArchivePass({businessType,range,rows,gaps,db,onProgress,mode:'recent'})");
const trackHistory=owner.indexOf("applyArchivePass({businessType,range,rows,gaps,db,onProgress,mode:'history'})");
const remote=owner.indexOf('await repairV483StrictExportRows');
assert.ok(saved>0&&confirmRecent>saved&&confirmHistory>confirmRecent&&trackRecent>confirmHistory&&trackHistory>trackRecent&&remote>trackHistory,'formal strict evidence order must be SQLite → V266 confirm recent/history → V266 track recent/history → residual CE 50x4');
assert.match(owner,/podSource='V497_V266_CONFIRM_TERMINAL_TIME'/,'V497 recovered POD date must be marked on the actual export row');
assert.match(repair,/normalizeV485TrackRows\(rawEvents,\{fallbackBills:bills\}\)/,'V483 remote evidence must normalize nested CE track responses before grouping');
assert.match(repair,/archiveV485TrackQueryResponse\(bills,rawEvents\)/,'successful residual CE track response must be archived before the batch is discarded');
assert.match(repair,/queried=\$\{result\.queried\}:failed=\$\{result\.failed\}:eventBills=\$\{result\.eventBills\}:normalizedEvents=\$\{result\.normalizedEvents\}/,'unresolved strict evidence error must expose remote request and event coverage diagnostics');
assert.match(repair,/V381_EXPORT_TRACK_BATCH=50/);
assert.match(repair,/V381_EXPORT_TRACK_CONCURRENCY=4/);
for(const phase of ['strictexportevidencesaved','strictexportevidencearchive','strictexportevidence'])assert.match(parent,new RegExp(phase),'V84 parent must surface strict evidence phase '+phase);
assert.match(parent,/V266离线轨迹档案/,'operator must see archive progress instead of a frozen business percentage');
assert.match(parent,/50×4补核剩余严格轨迹/,'operator must see residual CE query progress and failure/event counts');

console.log('[V497/V485] archived confirm POD + nested CE track evidence smoke passed · exact-member orderStatus85 saved timestamp only · updatedAt/export time rejected · SQLite→confirm archive→track archive→50x4 order locked · successful residual track responses archived');
