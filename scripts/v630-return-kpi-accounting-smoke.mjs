import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const home=fs.readFileSync(path.join(root,'src','homeQualitySummary.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const js=fs.readFileSync(path.join(root,'public','v625-shell.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','v625-shell.html'),'utf8');

assert.match(home,/const negative=\/\^\(未退回\|非退回\|待退回\|NOT_RETURNED\|NO_RETURN\|PENDING_RETURN\)\$\//,'return detector must reject negative return states');
assert.match(home,/const positive=\/\^\(已退回\|退回\|退回完成\|RETURN\|RETURNED\|RETURN_COMPLETED\)\$\//,'return detector must require terminal return state');
assert.match(server,/const returnText =/,'workspace return detector missing');
assert.match(server,/已退回|RETURN_COMPLETED/,'workspace positive return terminal missing');
assert.match(server,/未退回|NOT_RETURNED/,'workspace negative return guard missing');

assert.match(js,/let v630BusinessDetailTabs=\{\}/,'business detail tabs cache missing');
assert.match(js,/function tabRows\(\.\.\.keys\)/,'same-state detail tab reader missing');
assert.match(js,/function buildBusinessAccounting\(state=\{\},fallback=\{\}\)/,'delivery drilldown must use exclusive same-state accounting');
assert.match(js,/rowsByKind\.delivery\.push\(row\)/,'delivery detail must come from exclusive accounting');
assert.match(js,/v630BusinessDetailTabs=state\.detailTabs\|\|state\?\.dashboard\?\.detailTabs\|\|\{\}/,'business state or canonical dashboard detail tabs must feed drilldown');
assert.match(js,/setText\('kpiReturned',fmt\(\(counts\.returned\?\?m\.returned\)\|\|0\)\)/,'business returned card must use same-state accounting metric');
assert.match(js,/setText\('kpiOtherNormal',fmt\(counts\.otherNormal\|\|0\)\)/,'other-normal status must be visible from exclusive accounting');
assert.match(html,/data-kpi-detail="returned"/,'returned KPI must be clickable');
assert.match(html,/data-kpi-detail="otherNormal"/,'other-normal KPI must be clickable');
assert.match(html,/v625-shell\\.js\\?v=\\d{8}-v6\\d{2}-1/,'V630+ JS cache bust missing');
assert.match(html,/v625-shell\\.css\\?v=\\d{8}-v6\\d{2}-1/,'V630+ CSS cache bust missing');


const assetBuild=Number((html.match(/v625-shell\\.js\\?v=\\d{8}-v(6\\d{2})-1/)||[])[1]||0);
assert.ok(assetBuild>=630,'asset cache build must not predate V630');
console.log('[V630] strict return truth + same-state KPI drilldown + WHPP remainder visibility smoke passed');
