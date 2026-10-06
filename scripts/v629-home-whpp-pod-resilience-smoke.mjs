import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const home=fs.readFileSync(path.join(root,'src','homeQualitySummary.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const js=fs.readFileSync(path.join(root,'public','v625-shell.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','v625-shell.html'),'utf8');

assert.match(home,/function safeTimingForBatch\(batch,type\)/,'home timing must degrade independently');
assert.match(home,/function safeReturnSummaryForBatch\(batch,type\)/,'home return metrics must degrade independently');
assert.match(home,/const classified=TYPES\.reduce[\s\S]*return classified>0/,'default home must require actual classified business rows');
assert.match(home,/safeTimingForBatch\(latest,type\)/,'home must use resilient timing');
assert.match(home,/safeReturnSummaryForBatch\(latest,type\)/,'home must use resilient return summary');

assert.match(js,/summary\?\.reportDate===reportDate/,'business timing read must be null-safe');
assert.match(js,/setText\('kpiReturned',fmt\(\(counts\.returned\?\?m\.returned\)\|\|0\)\)/,'business return card must use exclusive same-state return truth');
assert.match(js,/function renderKpiDetail\(kind\)/,'KPI detail drilldown must remain installed');

assert.match(server,/import \{ loadWhppState, saveWhppDailyImport \} from '\.\/src\/whppStore\.js'/,'WHPP state/import integration missing');
assert.match(server,/requestedType === 'WHPP'[\s\S]*loadWhppState\(\)[\s\S]*loadWhppCanonicalTruth\([\s\S]*buildWhppDashboard/,'WHPP business board must use canonical merged truth');
assert.match(server,/\['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'\]\.map\(type => loadLightweightUnifiedBusinessState/,'POD workspace lightweight readers must exclude WHPP');
assert.match(server,/const whppState = loadWhppState\(\)/,'POD workspace must add WHPP through dedicated state');
assert.doesNotMatch(server,/\['CE', 'CEAF', 'TBKH', 'ALI1688', 'WHPP', 'SHOPEECN', 'SHOPEEVN'\]\.map\(type => loadLightweightUnifiedBusinessState/,'WHPP must never enter unsupported lightweight reader');

assert.match(html,/v625-shell\.js\?v=\d{8}-v6\d{2}-1/,'V629+ JS cache bust missing');
assert.match(html,/v625-shell\.css\?v=\d{8}-v6\d{2}-1/,'V629+ CSS cache bust missing');


const assetBuild=Number((html.match(/v625-shell\.js\?v=\d{8}-v(6\d{2})-1/)||[])[1]||0);
assert.ok(assetBuild>=629,'asset cache build must not predate V629');
console.log('[V629] resilient home + null-safe KPI detail + dedicated WHPP POD workspace smoke passed');
