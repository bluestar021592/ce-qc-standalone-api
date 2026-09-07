import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

for (const file of ['src/v142SevenBusinessHistoryAudit.js','public/v142-history-integrity-audit.js','public/v246-qc-tracking.js']) {
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}
const audit=fs.readFileSync('src/v142SevenBusinessHistoryAudit.js','utf8');
assert.match(audit,/2026-09-07-v450-bulk-readonly-history-audit-v1/);
assert.match(audit,/scanMode:'V450_BULK_RANGE_READ'/);
assert.doesNotMatch(audit,/function whppDay\(/);
assert.doesNotMatch(audit,/function airMismatch\(/);
const auditUi=fs.readFileSync('public/v142-history-integrity-audit.js','utf8');
assert.match(auditUi,/AUDIT_TIMEOUT_MS=60000/);
assert.match(auditUi,/new AbortController\(\)/);
const trackingUi=fs.readFileSync('public/v246-qc-tracking.js','utf8');
assert.match(trackingUi,/2026-09-07-v450-tracking-summary-auto-read-v1/);
assert.match(trackingUi,/queueMicrotask\(\(\)=>void read\(\)\)/);
assert.match(trackingUi,/\/api\/v246\/tracking\/summary\?/);
console.log('[V450] readonly observability source smoke passed');
