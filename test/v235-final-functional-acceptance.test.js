import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { periodRange } from '../src/periodExporter.js';
import { classifyLatestSpecialNode } from '../src/specialNode.js';
import { resolveV202AttemptCycle } from '../src/v202DeliveryTruth.js';

const read = file => fs.readFileSync(file, 'utf8');

test('V235 day/week/month ranges stay Phnom Penh calendar exact', () => {
  assert.deepEqual(periodRange('daily', '2026-08-20'), { from: '2026-08-20', to: '2026-08-20', key: '2026-08-20' });
  assert.deepEqual(periodRange('weekly', '2026-08-20'), { from: '2026-08-17', to: '2026-08-23', key: '2026-08-17_2026-08-23' });
  assert.deepEqual(periodRange('monthly', '2026-08-20'), { from: '2026-08-01', to: '2026-08-31', key: '2026-08' });
});

test('V235 580/self-pickup are latest-node normal destinations, not generic anomalies', () => {
  for (const place of ['CE:580', 'CEL:580', 'CE:CCSL580', 'CEL:CCSL580']) {
    assert.equal(classifyLatestSpecialNode([{ eventTime: '2026-08-20 10:00:00', place }])?.specialState, 'CCSL580_RETENTION');
  }
  assert.equal(classifyLatestSpecialNode([{ eventTime: '2026-08-20 10:00:00', trackingEventDescZh: '仓库自提完成' }])?.specialState, 'SELF_PICKUP');
  assert.equal(classifyLatestSpecialNode([
    { eventTime: '2026-08-19 10:00:00', place: 'CE:580' },
    { eventTime: '2026-08-20 10:00:00', trackingEventDescZh: 'POD:签收完成' }
  ]), null);
});

test('V235 Shopee real 1/2/3 attempt truth only increments after failure then a new real dispatch start', () => {
  const first = resolveV202AttemptCycle([
    { kind: 'START', time: '2026-08-18 09:00:00', source: '4003' },
    { kind: 'START', time: '2026-08-18 10:00:00', source: '70 duplicate start' },
    { kind: 'POD', time: '2026-08-18 18:00:00', source: '80' }
  ]);
  assert.equal(first.attemptNo, 1);
  assert.equal(first.attemptStarts.length, 1);

  const second = resolveV202AttemptCycle([
    { kind: 'START', time: '2026-08-18 09:00:00', source: '4003' },
    { kind: 'FAIL', time: '2026-08-18 20:00:00', source: '150' },
    { kind: 'FAIL', time: '2026-08-18 21:00:00', source: '150 duplicate same day' },
    { kind: 'START', time: '2026-08-19 09:00:00', source: '日报W' },
    { kind: 'POD', time: '2026-08-19 16:00:00', source: '4004' }
  ]);
  assert.equal(second.attemptNo, 2);
  assert.equal(second.attemptStarts.length, 2);
  assert.deepEqual(second.failureDates, ['2026-08-18']);

  const third = resolveV202AttemptCycle([
    { kind: 'START', time: '2026-08-18 09:00:00', source: '4003' },
    { kind: 'FAIL', time: '2026-08-18 20:00:00', source: '150' },
    { kind: 'START', time: '2026-08-19 09:00:00', source: '70' },
    { kind: 'FAIL', time: '2026-08-19 20:00:00', source: '150' },
    { kind: 'START', time: '2026-08-20 09:00:00', source: '日报Y' },
    { kind: 'POD', time: '2026-08-20 16:00:00', source: '80' }
  ]);
  assert.equal(third.attemptNo, 3);
  assert.equal(third.attemptStarts.length, 3);

  const unknown = resolveV202AttemptCycle([{ kind: 'POD', time: '2026-08-20 16:00:00', source: '80 without real start evidence' }]);
  assert.equal(unknown.attemptNo, 0, 'POD without real dispatch-cycle evidence must not be fabricated into first attempt');
});

test('V235 attempt dashboard rates are POD-denominator and evidence-unknown remains explicit', () => {
  const source = read('src/v203DashboardIntegrityPatch.js');
  assert.match(source, /a1Rate:ratio\(stats\.a1,stats\.pod\)/);
  assert.match(source, /a2Rate:ratio\(stats\.a2,stats\.pod\)/);
  assert.match(source, /a3Rate:ratio\(stats\.a3,stats\.pod\)/);
  assert.match(source, /unknownRate:ratio\(stats\.attemptUnknown,stats\.pod\)/);
  assert.match(source, /派次占比以POD票数为分母/);
  assert.match(source, /证据不足单独显示，不强行算1派/);
});

test('V235 dashboard cards and click details share the same authoritative V55 source', () => {
  const source = read('src/rangeDashboardStoreV55.js');
  const ui = read('public/v55-dashboard-reconciliation.js');
  assert.match(source, /state\.detailTabs = \{ \.\.\.\(state\.detailTabs \|\| \{\}\), \.\.\.details \}/);
  assert.match(source, /v55Summary/);
  assert.match(source, /loadMetricDetail/);
  assert.match(ui, /\/api\/v55\/metric-detail/);
  assert.match(ui, /\/api\/v55\/reconciliation/);
});

test('V235 strict seven-business export blocks incomplete history and async export remains resumable', () => {
  const strict = read('src/v142SevenBusinessPeriodExporter.js');
  const preflight = read('src/v142AsyncExportPreflightPatch.js');
  const asyncExport = read('src/v84AsyncExportPatch.js');
  assert.match(strict, /ALL_TYPES=\[\.\.\.CORE_TYPES,'WHPP'\]/);
  assert.match(strict, /历史完整性校验未通过，已阻止缺数据导出/);
  assert.match(preflight, /SEVEN_BUSINESS_HISTORY_INCOMPLETE/);
  assert.match(asyncExport, /reusableJob/);
  assert.match(asyncExport, /detached: true/);
});

test('V235 managed updater is fail-closed: test:golive then verified backup then ff-only switch', () => {
  const launcher = read('tools/CE_QC_Managed_Launcher.ps1');
  const testAt = launcher.indexOf("Invoke-Exe $script:NpmExe @('run','test:golive')");
  const backupAt = launcher.indexOf("$candidateBackup = Join-Path $tempRoot 'scripts\\CE_QC_PreUpdate_Backup.mjs'");
  const pullAt = launcher.indexOf("@('pull','--ff-only'");
  assert.ok(testAt >= 0 && backupAt > testAt && pullAt > backupAt, 'candidate acceptance must precede backup and code switch');
  assert.match(launcher, /\$candidateAccepted = \(\$candidateResult\.Count -eq 1 -and \$candidateResult\[0\] -eq \$true\)/);
  assert.match(launcher, /Candidate validation did not return one clean TRUE result; installation blocked/);
  assert.doesNotMatch(launcher, /reset\s+--hard/i);
});
