import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('V543 keeps browser history audit off 5177 and preserves read-only safety',()=>{
  const patch=fs.readFileSync('src/v142SevenBusinessExportPatch.js','utf8');
  const worker=fs.readFileSync('scripts/CE_QC_HistoryIntegrityAuditWorker.mjs','utf8');
  const audit=fs.readFileSync('src/v142SevenBusinessHistoryAudit.js','utf8');
  const ui=fs.readFileSync('public/v142-history-integrity-audit.js','utf8');
  assert.match(patch,/spawn\(process\.execPath,\[AUDIT_WORKER\]/);
  assert.match(patch,/history-integrity-job\/:jobId/);
  assert.match(worker,/new DatabaseSync\(dbFile,\{readOnly:true\}\)/);
  assert.match(worker,/PRAGMA query_only=ON/);
  assert.match(audit,/auditSevenBusinessHistoryWithDb/);
  assert.match(audit,/INDEXED BY idx_business_daily_rows/);
  assert.match(ui,/history-integrity-job/);
  assert.match(ui,/后台只读核对/);
  assert.doesNotMatch(ui,/AUDIT_TIMEOUT_MS=60000/);
});
