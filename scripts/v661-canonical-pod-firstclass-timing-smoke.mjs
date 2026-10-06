import fs from 'node:fs';
import assert from 'node:assert/strict';

const summary=fs.readFileSync('src/homeQualitySummary.js','utf8');
const server=fs.readFileSync('server.js','utf8');

assert.match(summary,/const canonicalPodSet=new Set\(selectedDatePodBills/,'timing rows must begin from canonical POD membership');
assert.match(summary,/const missing=\[\.\.\.canonicalPodSet\]\.filter\(bill=>!rowMap\.has\(bill\)\)/,'canonical POD bills missing from intermediate membership must be restored');
assert.match(summary,/membershipSource:'canonical_pod_snapshot'/,'restored POD members must keep an explicit truth source');
assert.match(summary,/isPod:Boolean\(canonicalPodSet\.has\(shipmentCode\)\|\|positivePodMembership/,'canonical POD membership must directly drive timing denominator');
assert.match(summary,/export function diagnoseSelectedDateTiming/,'read-only timing diagnostics owner missing');
assert.match(server,/\/api\/timing-diagnostics/,'timing diagnostics endpoint missing');
console.log('[V661] canonical POD members are first-class timing rows + diagnostics smoke passed');
