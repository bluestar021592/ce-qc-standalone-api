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
const v132Source = fs.readFileSync(path.join(__dirname, '..', 'src', 'v132WhppFastIntegrationPatch.js'), 'utf8').replace(/\r\n/g, '\n');
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
assert.match(source, /const expected = Number\(daily\.totalCount \|\| 0\);[\s\S]*const present = expected === rows\.length;/, 'V352 standard membership must require exact header/member equality');
assert.match(source, /WHPP_STANDARD_DAILY_ZERO/, 'V352 must keep exact persisted zero as a real daily truth');
assert.match(source, /const standard = loadStandardMembership\(db, date\);[\s\S]*const fallback = standard\.present[\s\S]*loadV351UnifiedWhppMembership\(date, db\)/, 'V352 must read direct normalized WHPP daily membership before V351 fallback');
assert.match(source, /WHPP_STANDARD_DAILY_INCLUDING_EXACT_ZERO_THEN_V351_SAFE_HISTORY_DISASTER_FALLBACK/, 'V352 must declare exact-zero standard daily truth before V351 fallback');
assert.doesNotMatch(source, /INSERT INTO|UPDATE\s+business_|DELETE FROM/, 'V352 visible owner must stay read-only');
const summaryStart = source.indexOf('function summaryPayload');
const summaryEnd = source.indexOf('function summaryHandler', summaryStart);
assert.ok(summaryStart >= 0 && summaryEnd > summaryStart, 'V352 summary payload source must exist');
const summarySource = source.slice(summaryStart, summaryEnd);
assert.match(summarySource, /slimDashboard/, 'first paint must use a slim summary object');
assert.doesNotMatch(summarySource, /detailTabs/, 'first-paint summary must not serialize per-ticket drilldown arrays');

// The primary WHPP browser calls V132. That older route is registered earlier than
// the V352 listen-time wrapper, so it must itself use current membership + final
// facts instead of stale business_history_summary metrics.
assert.match(v132Source, /import \{ buildWhppDashboard \} from '\.\/whppReporting\.js';/, 'V132 must build the same canonical WHPP dashboard');
assert.match(v132Source, /loadUnifiedMembership/, 'V132 must retain V351 only as the safe fallback path');
assert.match(v132Source, /const present=expected===rows\.length/, 'V132 must require exact standard header/member equality');
assert.match(v132Source, /WHPP_STANDARD_DAILY_ZERO/, 'V132 must keep exact persisted zero authoritative');
assert.match(v132Source, /const standard=loadStandardMembership\(db,reportDate\);[\s\S]*const unified=standard\.present\?\{present:false,rows:\[\],source:'STANDARD_PRIMARY_NO_FALLBACK'\}:loadUnifiedMembership\(db,reportDate\)/, 'V132 must use the normalized WHPP daily cohort before invoking V351 fallback');
assert.match(v132Source, /const membershipRows=standard\.present\?standard\.rows:unified\.rows/, 'V132 selected membership must prefer direct standard daily rows');
assert.match(v132Source, /loadFinalFacts/, 'V132 must read current WHPP final facts');
assert.match(v132Source, /memberSet\.has\(billOf\(row\)\)/, 'V132 final facts must be bounded to selected membership');
assert.match(v132Source, /normalized\.是否POD='是'/, 'V132 must restore SQL isPod into dashboard aliases');
assert.match(v132Source, /assertVisibleConsistency\(dashboard\)/, 'V132 must reject top/region divergence');
assert.match(v132Source, /Cache-Control','no-store/, 'V132 visible truth must not be browser-cached as a stale summary');
const v132BuildStart = v132Source.indexOf('function buildFastSummary');
const v132BuildEnd = v132Source.indexOf('const previousListen', v132BuildStart);
assert.ok(v132BuildStart >= 0 && v132BuildEnd > v132BuildStart, 'V132 canonical summary builder must exist');
const v132Build = v132Source.slice(v132BuildStart, v132BuildEnd);
assert.doesNotMatch(v132Build, /const metrics=\{\.\.\.source/, 'V132 must never publish stale history summary metrics as visible truth');
assert.match(v132Build, /const metrics=\{\.\.\.dashboard\.metrics,retryPending\}/, 'V132 top cards must come from the same dashboard object as regions');

const membershipRows = [];
for (let i = 0; i < 139; i += 1) membershipRows.push({ shipmentCode: `CEPP${String(i + 1).padStart(6, '0')}`, reportDate: '2026-08-14', businessType: 'WHPP', regionCode: 'PP' });
for (let i = 0; i < 97; i += 1) membershipRows.push({ shipmentCode: `CEPV${String(i + 1).padStart(6, '0')}`, reportDate: '2026-08-14', businessType: 'WHPP', regionCode: 'PV' });

const finalRows = [];
for (let i = 0; i < 124; i += 1) finalRows.push({ shipmentCode: `CEPP${String(i + 1).padStart(6, '0')}`, isPod: 1 });
for (let i = 124; i < 139; i += 1) finalRows.push({ shipmentCode: `CEPP${String(i + 1).padStart(6, '0')}`, isPod: 0, currentState: 'RETURNED', primaryCategory: '退回', 退回状态: '已退回' });
for (let i = 0; i < 62; i += 1) finalRows.push({ shipmentCode: `CEPV${String(i + 1).padStart(6, '0')}`, isPod: 1 });
for (let i = 62; i < 66; i += 1) finalRows.push({ shipmentCode: `CEPV${String(i + 1).padStart(6, '0')}`, isPod: 0, currentState: 'RETURNED', primaryCategory: '退回', 退回状态: '已退回' });
for (let i = 66; i < 94; i += 1) finalRows.push({ shipmentCode: `CEPV${String(i + 1).padStart(6, '0')}`, isPod: 0, currentState: 'ORDER_CANCELLED', primaryCategory: '订单取消', 订单取消: '是' });
for (let i = 94; i < 97; i += 1) finalRows.push({ shipmentCode: `CEPV${String(i + 1).padStart(6, '0')}`, isPod: 0, currentState: 'PENDING', primaryCategory: 'Pending', Pending当前次数: 1 });
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

const zeroDashboard = buildV352WhppVisibleDashboard({ reportDate: '2026-08-15', membershipRows: [], finalRows: [] });
assertV352WhppVisibleConsistency(zeroDashboard);
assert.equal(zeroDashboard.metrics.total, 0, 'an exact standard zero must remain zero without resurrecting historical members');
assert.equal(zeroDashboard.accounting.balanced, true);

console.log('[V352] WHPP visible single-truth smoke passed · exact normalized standard membership including zero is primary · V351 is missing/history disaster fallback only · production-shaped 236 = PP139 + PV97 · SQL isPod-only facts restore POD186 · stale nonmember facts excluded · top=regions=drilldowns · read-only');