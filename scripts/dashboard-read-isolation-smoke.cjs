const fs = require('fs');
const assert = require('assert/strict');

const read = path => fs.readFileSync(path, 'utf8');
const v90 = read('public/v90-instant-whpp-navigation.js');
const v132 = read('public/v132-whpp-seven-business-fast.js');
const v44 = read('src/v44WhppUiPatch.js');
const v161 = read('src/v161UnifiedImportRuntimeTruthPatch.js');

assert.doesNotThrow(() => new Function(v90), 'V90 compatibility navigation must compile as browser JavaScript');
assert.doesNotThrow(() => new Function(v132), 'V132 canonical WHPP page must compile as browser JavaScript');

assert.doesNotMatch(v90, /getElementById\(['"]shopeePage['"]\)/, 'legacy WHPP navigation must never reuse the SHOPEE page host');
assert.doesNotMatch(v90, /getElementById\(['"]tbkhPage['"]\)/, 'legacy WHPP navigation must never reuse the TBKH page host');
assert.match(v90, /legacyShopeeHostRetired:true/, 'V90 must advertise that shared SHOPEE host ownership is retired');
assert.match(v90, /__CE_QC_V132_WHPP_FAST__\?\.navigate/, 'V90 must delegate WHPP navigation to canonical V132 when available');

assert.doesNotMatch(v44, /<script src=\"\/whpp-v44\.js/, 'legacy V44 WHPP body renderer must not be injected');
assert.doesNotMatch(v44, /<script src=\"\/whpp-v45-cleanup\.js/, 'legacy cleanup observer must not own the shared SHOPEE DOM');
assert.match(v44, /v132-whpp-seven-business-fast\.js\?v=20260831-v393-1/, 'canonical V132 asset must be cache-busted after route isolation fix');

assert.match(v132, /let navigationEpoch=0/, 'V132 must own a navigation generation');
assert.match(v132, /function isWhppRoute\(epoch=0\)/, 'V132 must fail closed outside the WHPP route');
assert.match(v132, /if\(!isWhppRoute\(epoch\)\)return;const page=activatePage\(false\)/, 'V132 render must refuse stale cross-route writes');
assert.match(v132, /const value=await fetchFast\(date\);if\(!isWhppRoute\(epoch\)\)return;render\(value,'',epoch\)/, 'late WHPP summary responses must be discarded after navigation changes');
assert.match(v132, /location\.pathname!==['"]\/whpp['"]\)return null/, 'V132 activation must not reactivate WHPP while another business route is active');

assert.match(v161, /FAST_HISTORY_ROUTE = ['"]\/api\/unified-history['"]/, 'V161 must own the lightweight unified history route');
assert.match(v161, /historyMetadataOnly: true/, 'unified history must disclose metadata-only semantics');
assert.match(v161, /carryoverRecomputed: false/, 'unified history must explicitly avoid per-date carryover recomputation');
const fastHistory = (v161.match(/function fastUnifiedHistory[\s\S]*?\n}\n\nfunction wrapRoute/) || [''])[0];
assert.ok(fastHistory, 'V161 fast unified history handler must exist');
assert.doesNotMatch(fastHistory, /carryoverSummary|runtimeCarry|carryover_open_items/, 'history list must never scan/recompute carryover per report date');
assert.match(v161, /route === FAST_HISTORY_ROUTE[\s\S]*previousGet\.call\(this, args\[0\], fastUnifiedHistory\)/, 'server registration must replace the legacy heavy unified-history handler');

console.log('[dashboard-read-isolation] WHPP route isolation + lightweight unified history gate passed');
