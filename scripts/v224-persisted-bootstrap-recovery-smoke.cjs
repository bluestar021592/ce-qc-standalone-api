const fs = require('fs');

const recovery = fs.readFileSync('src/v221BootstrapRecoveryPatch.js', 'utf8');
const v46 = fs.readFileSync('src/v46ColdStartIndexPatch.js', 'utf8');

const must = (source, token) => {
  if (!source.includes(token)) throw new Error(`V224 recovery gate missing: ${token}`);
};

must(v46, "import './v221BootstrapRecoveryPatch.js';");
must(recovery, "bootstrapMode: 'PERSISTED_RECOVERY_SUMMARY'");
must(recovery, "source: 'DASHBOARD_DAILY_CACHE'");
must(recovery, "'LEGACY_PERSISTED_TABLES'");
must(recovery, 'function makeWhppState()');
must(recovery, "WHERE b.status='VALID'");
must(recovery, 'canonical ledger first, persisted dashboard cache/legacy summary fallback');

console.log('[V224] persisted bootstrap recovery smoke passed: canonical-first, cache/legacy fallback, WHPP persisted summary, no reupload.');
