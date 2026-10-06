import fs from 'node:fs';
import assert from 'node:assert/strict';

const v689=fs.readFileSync('scripts/v689-completed-snapshot-timing-fallback-smoke.mjs','utf8');
const v690=fs.readFileSync('scripts/v690-saved-terminal-pod-timing-smoke.mjs','utf8');
const home=fs.readFileSync('src/homeQualitySummary.js','utf8');

assert.match(home,/strictLedger\|\|savedTerminalFallback\|\|snapshotFallback\|\|direct/,'V690 timing priority missing');
assert.match(v689,/savedTerminalFallback/,'legacy V689 gate must understand V690 saved-terminal layer');
assert.doesNotMatch(v689,/strictLedger\\\|\\\|snapshotFallback\\\|\\\|direct/,'legacy V689 gate must not require retired priority');
assert.match(v690,/saved terminal evidence must never outrank strict track or strict ledger/,'V690 gate must protect strict evidence priority');

console.log('[V691] V689 legacy snapshot gate aligned with V690 saved-terminal POD timing priority');
