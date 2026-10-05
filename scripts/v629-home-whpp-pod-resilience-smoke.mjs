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
assert.match(js,/setText\('kpiReturned',fmt\(m\.returned\|\|0\)\)/,'business return card must use same-state return truth');
assert.match(js,/function renderKpiDetail\(kind\)/,'KPI detail drilldown must remain installed');

assert.match(server,/import \{ loadWhppState \} from '\.\/src\/whppStore\.js'/,'WHPP dedicated state import missing');
assert.match(server,/requestedType === 'WHPP'[\s\S]*loadWhppState\(\)[\s\S]*buildWhppDashboard/,'WHPP business board must use dedicated state');
assert.match(server,/\['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'\]\.map\(type => loadLightweightUnifiedBusinessState/,'POD workspace lightweight readers must exclude WHPP');
assert.match(server,/const whppState = loadWhppState\(\)/,'POD workspace must add WHPP through dedicated state');
assert.doesNotMatch(server,/\['CE', 'CEAF', 'TBKH', 'ALI1688', 'WHPP', 'SHOPEECN', 'SHOPEEVN'\]\.map\(type => loadLightweightUnifiedBusinessState/,'WHPP must never enter unsupported lightweight reader');

assert.match(html,/v625-shell\.js\?v=202610(?:04-v6(?:29|30)-1|05-v631-1)/,'V629 JS cache bust missing');
assert.match(html,/v625-shell\.css\?v=202610(?:04-v6(?:29|30)-1|05-v631-1)/,'V629 CSS cache bust missing');

console.log('[V629] resilient home + null-safe KPI detail + dedicated WHPP POD workspace smoke passed');
