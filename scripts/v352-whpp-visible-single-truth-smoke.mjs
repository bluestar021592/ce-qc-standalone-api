import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildV352WhppVisibleDashboard,
  assertV352WhppVisibleConsistency,
  V352_WHPP_VISIBLE_TRUTH_OWNER_ID
} from '../src/v352WhppVisibleTruthOwnerPatch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'v352WhppVisibleTruthOwnerPatch.js'), 'utf8').replace(/\r\n/g, '\n');
const v85 = fs.readFileSync(path.join(__dirname, '..', 'src', 'v85ShopeeWhppMetricPatch.js'), 'utf8').replace(/\r\n/g, '\n');

assert.match(V352_WHPP_VISIBLE_TRUTH_OWNER_ID, /v352-whpp-visible-single-truth-owner/);
assert.match(v85, /import '\.\/v351WhppUnifiedDashboardBridgePatch\.js';\nimport '\.\/v352WhppVisibleTruthOwnerPatch\.js';/, 'V352 must wrap routes after V351 is loaded so it registers first at listen time');
assert.match(source, /\/api\/v132\/whpp-fast-summary/, 'visible V132 summary route must be owned by V352');
assert.match(source, /\/api\/v71\/whpp-summary/, 'legacy V71 summary route must share V352 truth');
assert.match(source, /\/api\/v172\/whpp-metric-detail/, 'visible drilldown must share V352 truth');
assert.match(source, /Number\(row\.isPod \|\| 0\) === 1/, 'persisted SQL isPod must be restored in memory');
assert.match(source, /normalized\.是否POD = '是'/, 'SQL POD must map to WHPP dashboard aliases');
assert.match(source, /memberSet\.has\(billOf\(row\)\)/, 'final facts must be bounded to current WHPP membership');
assert.match(source, /memberByBill/, 'membership region truth must be merged into final facts before region metrics');
assert.match(source, /TOP_EQUALS_PP_PLUS_PV_PLUS_UNKNOWN/, 'visible aggregate/region invariant must be explicit');
assert.doesNotMatch(source, /INSERT INTO|UPDATE\s+business_|DELETE FROM/, 'V352 visible owner must stay read-only');
const summaryStart = source.indexOf('function summaryPayload');
const summaryEnd = source.indexOf('function summaryHandler', summaryStart);
assert.ok(summaryStart >= 0 && summaryEnd > summaryStart, 'V352 summary payload source must exist');
const summarySource = source.slice(summaryStart, summaryEnd);
assert.match(summarySource, /slimDashboard/, 'first paint must use a slim summary object');
assert.doesNotMatch(summarySource, /detailTabs/, 'first-paint summary must not serialize per-ticket drilldown arrays');

const membershipRows = [];
for (let i = 0; i < 139; i += 1) membershipRows.push({ shipmentCode: `CEPP${String(i + 1).padStart(6, '0')}`, reportDate: '2026-08-14', businessType: 'WHPP', regionCode: 'PP' });
for (let i = 0; i < 97; i += 1) membershipRows.push({ shipmentCode: `CEPV${String(i + 1).padStart(6, '0')}`, reportDate: '2026-08-14', businessType: 'WHPP', regionCode: 'PV' });

const finalRows = [];
// Exact visible PP facts from the production screenshot: 139 total, 124 POD, 15 returned.
for (let i = 0; i < 124; i += 1) finalRows.push({ shipmentCode: `CEPP${String(i + 1).padStart(6, '0')}`, isPod: 1 });
for (let i = 124; i < 139; i += 1) finalRows.push({ shipmentCode: `CEPP${String(i + 1).padStart(6, '0')}`, isPod: 0, currentState: 'RETURNED', primaryCategory: '退回', 退回状态: '已退回' });
// Exact visible PV facts: 97 total, 62 POD, 4 returned, 3 unresolved; remaining 28 are terminal cancellations.
for (let i = 0; i < 62; i += 1) finalRows.push({ shipmentCode: `CEPV${String(i + 1).padStart(6, '0')}`, isPod: 1 });
for (let i = 62; i < 66; i += 1) finalRows.push({ shipmentCode: `CEPV${String(i + 1).padStart(6, '0')}`, isPod: 0, currentState: 'RETURNED', primaryCategory: '退回', 退回状态: '已退回' });
for (let i = 66; i < 94; i += 1) finalRows.push({ shipmentCode: `CEPV${String(i + 1).padStart(6, '0')}`, isPod: 0, currentState: 'ORDER_CANCELLED', primaryCategory: '订单取消', 订单取消: '是' });
for (let i = 94; i < 97; i += 1) finalRows.push({ shipmentCode: `CEPV${String(i + 1).padStart(6, '0')}`, isPod: 0, currentState: 'PENDING', primaryCategory: 'Pending', Pending当前次数: 1 });
// A stale same-day final row that is not in the 236-member daily set must never affect visible WHPP metrics.
finalRows.push({ shipmentCode: 'CE_STALE_NOT_IN_MEMBERSHIP', isPod: 1, currentState: 'POD', regionCode: 'PP' });

const dashboard = buildV352WhppVisibleDashboard({ reportDate: '2026-08-14', membershipRows, finalRows });
assertV352WhppVisibleConsistency(dashboard);
assert.equal(dashboard.metrics.total, 236);
assert.equal(dashboard.regions.PP.total, 139);
assert.equal(dashboard.regions.PP.pod, 124);
assert.equal(dashboard.regions.PP.returned, 15);
assert.equal(dashboard.regions.PP.podRate, 89.21);
assert.equal(dashboard.regions.PV.total, 97);
assert.equal(dashboard.regions.PV.pod, 62);
assert.equal(dashboard.regions.PV.returned, 4);
assert.equal(dashboard.regions.PV.unresolved, 3);
assert.equal(dashboard.regions.PV.pending1, 3, 'PV Pending facts must inherit current daily membership region');
assert.equal(dashboard.regions.UNKNOWN.pending1, 0, 'known PV Pending facts must not disappear into hidden UNKNOWN');
assert.equal(dashboard.regions.PV.podRate, 63.92);
assert.equal(dashboard.metrics.pod, 186, 'visible top POD must equal PP 124 + PV 62');
assert.equal(dashboard.metrics.returned, 19, 'visible top return must equal PP 15 + PV 4');
assert.equal(dashboard.metrics.cancelled, 28);
assert.equal(dashboard.metrics.unresolved, 3, 'visible top unresolved must equal regional unresolved, never stale 236');
assert.equal(dashboard.metrics.pending1, 3, 'top Pending1 must equal visible PV Pending1');
assert.equal(dashboard.metrics.podRate, 78.81);
assert.equal(dashboard.detailTabs.all.total, 236);
assert.equal(dashboard.detailTabs.pod.total, 186, 'POD card drilldown must match top POD');
assert.equal(dashboard.detailTabs.returned.total, 19);
assert.equal(dashboard.detailTabs.cancelled.total, 28);
assert.equal(dashboard.detailTabs.unresolved.total, 3);
assert.equal(dashboard.detailTabs.pending1.total, 3);
assert.equal(dashboard.accounting.accounted, 236);
assert.equal(dashboard.accounting.difference, 0);
assert.equal(dashboard.accounting.balanced, true);

console.log('[V352] WHPP visible single-truth smoke passed · exact production-shaped 236 = PP139 + PV97 · SQL isPod-only facts restore POD186 · returned19 · unresolved3 · PV Pending stays in PV · stale nonmember facts excluded · top=regions=drilldowns · slim first paint · read-only · no DB schema change');
