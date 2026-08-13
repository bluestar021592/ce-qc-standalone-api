import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const reportDate = String(process.argv[2] || '2026-08-01').trim();
const logsDir = path.join(root, 'logs');
fs.mkdirSync(logsDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = path.join(logsDir, `acceptance_${reportDate}_${stamp}.log`);
const lines = [];
let blocked = false;

function emit(text = '') {
  const value = String(text);
  lines.push(value);
  process.stdout.write(value.endsWith('\n') ? value : `${value}\n`);
}
function runPhase(name, command, args, timeoutMs = 180000) {
  emit(`\n============================================================`);
  emit(`[PHASE] ${name}`);
  emit(`============================================================`);
  const started = Date.now();
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: timeoutMs, env: process.env, shell: false });
  const elapsed = Date.now() - started;
  if (result.stdout) emit(result.stdout.trimEnd());
  if (result.stderr) emit(result.stderr.trimEnd());
  if (result.error) emit(`[ERROR] ${result.error.message}`);
  emit(`[PHASE_RESULT] ${name}: exit=${result.status ?? 'null'} duration=${elapsed}ms`);
  const pass = result.status === 0 && !result.error;
  if (!pass) blocked = true;
  return { pass, elapsed, status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}
function runNpmPhase(name, script, timeoutMs) {
  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe';
    return runPhase(name, comspec, ['/d', '/s', '/c', `npm run ${script}`], timeoutMs);
  }
  return runPhase(name, 'npm', ['run', script], timeoutMs);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
  console.error('Usage: CE_QC_Full_Acceptance_Verify_ReadOnly.mjs YYYY-MM-DD');
  process.exit(2);
}

emit('CE QC FULL ACCEPTANCE VERIFY - READ ONLY / TEST ONLY');
emit(`Report date: ${reportDate}`);
emit('This verifier does not re-import reports, does not delete source data, and does not rewrite source daily reports.');

const day = runPhase('A. DAILY DATA SOURCE -> NORMALIZED -> CURRENT CONSISTENCY', process.execPath, ['scripts/CE_QC_First_Day_GoLive_Verify_ReadOnly.mjs', reportDate], 60000);
const business = runPhase('B. SEVEN-BUSINESS SNAPSHOT CONSISTENCY + QUERY SPEED', process.execPath, ['scripts/CE_QC_Business_Snapshot_Audit_ReadOnly.mjs', reportDate, 'ALL'], 60000);
const terminal = runPhase('B2. WHPP TERMINAL AUTHORITY - ALL DATES + CE01072600002', process.execPath, ['scripts/CE_QC_WHPP_Terminal_Authority_Audit_ReadOnly.mjs', 'CE01072600002'], 60000);

const criticalTests = [
  'test/v86-strict-track-status-gate.test.js',
  'test/v92-whpp-terminal-authority.test.js',
  'test/v70-confirm-query-resilience.test.js',
  'test/v61-drilldown-route-bridge.test.js',
  'test/v55-dashboard-reconciliation.test.js',
  'test/v84-async-large-range-export.test.js',
  'test/v87-whpp-large-range-export.test.js',
  'test/v88-export-job-resume.test.js',
  'test/v89-fast-dashboard-source-truth.test.js',
  'test/v90-instant-whpp-navigation.test.js'
];
const critical = runPhase('C. CRITICAL SCAN/TRACK/WHPP-TERMINAL/DRILLDOWN/EXPORT/PERFORMANCE REGRESSION', process.execPath, ['--test', ...criticalTests], 120000);
const full = runNpmPhase('D. COMPLETE GO-LIVE REGRESSION SUITE', 'test:golive', 240000);

const perfWarn = /PERFORMANCE_RESULT: WARN_QUERY_OVER_1S/.test(day.stdout) || /BLOCKED_SLOW_QUERY/.test(day.stdout) || /BLOCKED_SLOW_QUERY/.test(business.stdout);

emit(`\n============================================================`);
emit('FINAL ACCEPTANCE SUMMARY');
emit('============================================================');
emit(`Daily data consistency: ${day.pass ? 'PASS' : 'BLOCKED'}`);
emit(`Seven-business consistency: ${business.pass ? 'PASS' : 'BLOCKED'}`);
emit(`WHPP terminal authority: ${terminal.pass ? 'PASS' : 'BLOCKED'}`);
emit(`Critical scan/track/WHPP-terminal/drilldown/export tests: ${critical.pass ? 'PASS' : 'BLOCKED'}`);
emit(`Full go-live regression: ${full.pass ? 'PASS' : 'BLOCKED'}`);
emit(`Live DB query speed: ${perfWarn ? 'WARN/BLOCKED - inspect PERF lines' : 'PASS'}`);
emit(`ACCEPTANCE_RESULT: ${blocked ? 'BLOCKED' : 'READY_FOR_UI_AND_EXPORT_ACCEPTANCE'}`);
emit(`Log: ${logFile}`);

fs.writeFileSync(logFile, `${lines.join('\n')}\n`, 'utf8');
process.exitCode = blocked ? 10 : 0;
