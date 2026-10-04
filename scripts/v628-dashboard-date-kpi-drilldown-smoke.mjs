import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=fs.readFileSync(path.join(root,'public','v625-shell.html'),'utf8');
const js=fs.readFileSync(path.join(root,'public','v625-shell.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const home=fs.readFileSync(path.join(root,'src','homeQualitySummary.js'),'utf8');

assert.match(home,/function hasBusinessData\(batch\)/,'home summary must identify non-empty business batches');
assert.match(home,/function selectUnifiedBatch\(\{ reportDate='', snapshotId='' \}=\{\}\)/,'home summary must support exact date/snapshot selection');
assert.match(home,/history\.find\(hasBusinessData\)/,'empty newest import must not zero the default home dashboard');
assert.match(home,/export function buildHomeQualitySummary\(options=\{\}\)/,'home summary must accept selection options');
assert.match(server,/buildHomeQualitySummary\(\{[\s\S]*reportDate:String\(req\.query\.reportDate/,'home API must pass reportDate');

assert.match(js,/const selectedReportDate=\(\)=>\{[\s\S]*p\.get\('reportDate'\)/,'dashboard date must come from URL selection');
assert.match(js,/summaryUrl='\/api\/home-quality-summary'[\s\S]*reportDate=/,'home must request selected date');
assert.match(js,/p\.set\('reportDate',reportDate\)/,'query button must persist selected report date');
assert.match(js,/p\.delete\('snapshotId'\)/,'changing date must not retain stale snapshot');
assert.match(js,/summary=await json\('\/api\/home-quality-summary\?'/,'business board must resolve selected date to exact summary/snapshot');
assert.match(js,/new URLSearchParams\(\{scope:'all'\}\)/,'business KPI drilldown must load all membership rows');
assert.match(js,/function renderKpiDetail\(kind\)/,'business KPI drilldown renderer missing');
assert.match(js,/kind==='delivery'\)return rows\.filter\(row=>!row\.isClosed\)/,'delivery drilldown must show all non-terminal parcels');

for(const kind of ['total','delivery','pod','pending','abnormal']){
  assert.ok(html.includes(`data-kpi-detail="${kind}"`),`missing clickable KPI ${kind}`);
}
for(const id of ['v628KpiDetailPanel','v628KpiDetailTitle','v628KpiDetailMeta','v628KpiDetailRows']){
  assert.ok(html.includes(`id="${id}"`),`missing KPI detail UI ${id}`);
}
assert.match(html,/v625-shell\.js\?v=20261004-v62[89]-1/,'V628+ JS cache bust missing');
assert.match(html,/v625-shell\.css\?v=20261004-v62[89]-1/,'V628+ CSS cache bust missing');

const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const dupes=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
assert.deepEqual(dupes,[],'duplicate DOM ids: '+dupes.join(', '));

console.log('[V628] dashboard date authority + latest non-empty fallback + business KPI drilldown smoke passed');
