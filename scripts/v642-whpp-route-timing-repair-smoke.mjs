import fs from 'node:fs';
import assert from 'node:assert/strict';

const v137=fs.readFileSync('src/v137WhppUnifiedBusinessStatePatch.js','utf8');
const server=fs.readFileSync('server.js','utf8');
const js=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
const repair=fs.readFileSync('src/whppSigningEvidenceRepair.js','utf8');
const home=fs.readFileSync('src/homeQualitySummary.js','utf8');

assert.match(v137,/retire the legacy WHPP interception/,'legacy WHPP business-state interception must be retired');
assert.match(v137,/if\(route===BUSINESS_ROUTE\)[\s\S]*return previousGet\.apply\(this,args\)/,'WHPP business-state must pass through to current server owner');
assert.doesNotMatch(v137,/if\(String\(req\.params\?\.businessType\|\|''\)\.toUpperCase\(\)==='WHPP'\)return sendBusinessState/,'legacy early WHPP response must be gone');

assert.match(server,/requestedType === 'WHPP'[\s\S]*loadWhppCanonicalTruth/,'current server owner must serve WHPP canonical truth');
assert.match(server,/canonicalTruthEvidence/,'WHPP current state must expose canonical evidence');

assert.match(js,/const allComplete=completeFamilies===3/,'completed-family owner must derive one exact allComplete flag');
assert.match(js,/const scanStage=allComplete\?'完成'/,'completed families must close scan stage');
assert.match(js,/const trackStage=allComplete\?'完成'/,'completed families must close track stage');
assert.match(js,/const showWhppScan=business==='WHPP'&&waiting>0/,'WHPP pending scan visibility must depend on actual waiting members');
assert.match(js,/btn\.hidden=!showWhppScan/,'finished WHPP scan action must hide');

assert.match(repair,/queryTrackBatchWithFallback/,'WHPP signing repair must use bounded track query');
assert.match(repair,/splitTrackBatches/,'WHPP signing repair must use 50-ticket track batches');
assert.match(repair,/for\(let offset=0;offset<batches\.length;offset\+=4\)/,'WHPP signing repair must use four-way waves');
assert.match(repair,/business_final_rows WHERE businessType='WHPP'.*isPod=1/s,'WHPP signing repair must target POD members only');
assert.match(repair,/business_track_events/,'WHPP signing repair must persist track evidence');

assert.match(home,/requestV328EvidenceRepair/,'TBKH and Shopee signing evidence repair must be queued');
assert.match(home,/requestWhppSigningEvidenceRepair/,'WHPP signing evidence repair must be queued');
assert.match(js,/timingRepairRunning/,'browser must keep polling while timing repair runs');

assert.match(html,/v625-shell\.js\?v=\d{8}-v\d{3,}-1/,'V642+ JS cache bust missing');
assert.match(html,/v625-shell\.css\?v=\d{8}-v\d{3,}-1/,'V642+ CSS cache bust missing');

console.log('[V642] canonical WHPP route + complete live stages + POD signing evidence repair smoke passed');
