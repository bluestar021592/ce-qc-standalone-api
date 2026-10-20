import assert from 'node:assert/strict';
import {validateIsolatedCopy,acceptanceText,DEFAULT_COPY} from './v788-run-isolated-readonly-acceptance.mjs';
assert.equal(validateIsolatedCopy(DEFAULT_COPY),DEFAULT_COPY);
for(const disallowed of [
  'D:\\CE CCSL金边数据库\\ce_qc_monitor.db',
  'C:\\CE_QC_V788_验收副本\\ce_qc_monitor.db',
  'D:\\CE_QC_V788_验收副本\\..\\CE CCSL金边数据库\\ce_qc_monitor.db',
  'D:\\CE_QC_V788_验收副本\\other.db']){
  assert.throws(()=>validateIsolatedCopy(disallowed),/安全拦截/,
    'never audit alternate or production DB');
}
const verdict={releaseDecision:'BLOCKED',gates:[{id:'CP72',status:'BLOCK',detail:{count:71}}]};
const audit={active72:{count:71},whpp:{totals:{sourceMembers:346,normalizedPOD:290,
  normalizedReturned:56,trustedPodLockOnPOD:0,ledgerOpenWithNormalizedTerminal:346,
  trustedPodTimeCoveragePct:0},
  byDate:[{date:'2026-07-01',sourceMembers:190,normalizedPOD:166,normalizedReturned:24,returning80:0},
    {date:'2026-07-02',sourceMembers:156,normalizedPOD:124,normalizedReturned:32,returning80:0}]},
  sevenBusinessSource:{datesChecked:2,blockedDates:[]}};
const text=acceptanceText(audit,verdict);
assert.match(text,/346/);
assert.match(text,/290/);
assert.match(text,/190/);
assert.match(text,/156/);
assert.match(text,/阻断发布/);
assert.ok(!text.includes('CE020726')&&!text.includes('D:\\CE'));
console.log('[V788 ISOLATED RUNNER] exact-copy path safety, no production reads and privacy-only aggregate summaries PASS');