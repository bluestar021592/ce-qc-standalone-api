import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const home=fs.readFileSync(path.join(root,'src','homeQualitySummary.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');

assert.match(home,/FROM track_events WHERE shipmentCode IN \(\$\{marks\}\) ORDER BY eventTime,id/,'timing must read full saved core lifecycle by shipment');
assert.match(home,/FROM business_track_events WHERE businessType=\? AND shipmentCode IN \(\$\{marks\}\) ORDER BY eventTime,id/,'timing must read full saved business lifecycle by shipment');
assert.doesNotMatch(home,/FROM track_events WHERE reportDate=\?/,'timing must not truncate lifecycle to the report date');
assert.doesNotMatch(home,/FROM business_track_events WHERE businessType=\? AND reportDate=\?/,'business timing must not truncate lifecycle to the report date');

assert.match(home,/function positivePodMembership\(row=\{\},ledgerRow=\{\}\)/,'canonical POD membership resolver missing');
assert.match(home,/ledgerRow\.terminalReason[\s\S]*===\s*'POD'/,'POD membership must accept canonical tracking ledger terminal truth');
assert.match(home,/status==='85'/,'saved terminal orderStatus 85 must remain valid POD proof');
assert.match(home,/membershipSource:/,'timing diagnostics must expose POD membership provenance');

assert.match(server,/function localTrackEvidence\(shipmentCodes=\[\]/,'local track detail evidence reader missing');
assert.match(server,/FROM track_events WHERE shipmentCode IN \(\$\{marks\}\) ORDER BY eventTime,id/,'track detail must show full saved core lifecycle');
assert.match(server,/FROM business_track_events WHERE businessType=\? AND shipmentCode IN \(\$\{marks\}\) ORDER BY eventTime,id/,'track detail must show full saved business lifecycle');

console.log('[V634] full lifecycle timing + canonical POD membership + traceable single-ticket evidence smoke passed');
