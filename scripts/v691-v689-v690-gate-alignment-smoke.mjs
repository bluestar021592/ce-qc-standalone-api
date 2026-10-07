import fs from 'node:fs';
import assert from 'node:assert/strict';

const v689=fs.readFileSync('scripts/v689-completed-snapshot-timing-fallback-smoke.mjs','utf8');
const v690=fs.readFileSync('scripts/v690-saved-terminal-pod-timing-smoke.mjs','utf8');
const home=fs.readFileSync('src/homeQualitySummary.js','utf8');

assert.match(home,/const trackEvidence=direct\.ok\?[\s\S]*?\(strictLedger\|\|savedTerminalFallback\|\|snapshotFallback\|\|direct\)/,'V690 track fallback priority missing');
assert.match(home,/evidence:dailyReportFallback\|\|trackEvidence/,'V742 daily-report signing priority missing');
assert.match(v689,/savedTerminalFallback/,'legacy V689 gate must understand V690 saved-terminal layer');
assert.match(v689,/dailyReportFallback/,'legacy V689 gate must understand V742 daily-report signing layer');
assert.match(v690,/saved terminal evidence must never outrank strict track or strict ledger/,'V690 gate must protect strict evidence priority');

console.log('[V691] V689/V690 fallback gates aligned with V742 daily-report signing-day ownership');
