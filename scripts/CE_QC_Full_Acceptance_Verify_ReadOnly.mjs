import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const DEFAULT_DB_FILE='D:\\CE CCSL金边数据库\\ce_qc_monitor.db';
const requestedDate=String(process.argv[2]||process.env.CE_QC_ACCEPTANCE_REPORT_DATE||'').trim();

function resolveDbFile(){
  const value=String(process.env.DB_FILE||DEFAULT_DB_FILE).trim();
  return path.isAbsolute(value)?path.normalize(value):path.resolve(root,value);
}
function resolveLatestPersistedDate(){
  const dbFile=resolveDbFile();
  if(!fs.existsSync(dbFile))return '';
  const db=new DatabaseSync(dbFile,{readOnly:true});
  try{
    db.exec('PRAGMA query_only=ON');
    db.exec('PRAGMA busy_timeout=1200');
    const exists=name=>{try{return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}catch{return false;}};
    const probes=[
      ['unified_import_batches',"SELECT COALESCE(MAX(reportDate),'') reportDate FROM unified_import_batches WHERE UPPER(COALESCE(status,'VALID'))='VALID'"],
      ['business_daily_reports',"SELECT COALESCE(MAX(reportDate),'') reportDate FROM business_daily_reports"],
      ['daily_reports',"SELECT COALESCE(MAX(reportDate),'') reportDate FROM daily_reports"],
      ['dashboard_daily_cache',"SELECT COALESCE(MAX(reportDate),'') reportDate FROM dashboard_daily_cache"],
      ['business_final_rows',"SELECT COALESCE(MAX(reportDate),'') reportDate FROM business_final_rows"],
      ['final_rows',"SELECT COALESCE(MAX(reportDate),'') reportDate FROM final_rows"],
      ['business_daily_parse_rows',"SELECT COALESCE(MAX(reportDate),'') reportDate FROM business_daily_parse_rows"]
    ];
    const dates=[];
    for(const [table,sql] of probes){
      if(!exists(table))continue;
      try{
        const value=String(db.prepare(sql).get()?.reportDate||'');
        if(/^\d{4}-\d{2}-\d{2}$/.test(value))dates.push(value);
      }catch{}
    }
    return dates.sort().at(-1)||'';
  }finally{
    try{db.close();}catch{}
  }
}

const reportDate=requestedDate||resolveLatestPersistedDate();
if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
  console.error('Unable to resolve a persisted report date. Optional usage: CE_QC_Full_Acceptance_Verify_ReadOnly.mjs YYYY-MM-DD');
  process.exit(2);
}

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
  emit('============================================================');
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

emit('CE QC FULL ACCEPTANCE VERIFY - READ ONLY / TEST ONLY');
emit(`Report date: ${reportDate} (${requestedDate ? 'EXPLICIT' : 'AUTO_LATEST_PERSISTED'})`);
emit(`Database: ${resolveDbFile()}`);
emit('This verifier does not re-import reports, does not delete source data, and does not rewrite source daily reports.');

const latestTruth = runPhase('A0. LATEST PERSISTED DATE + SEVEN-BOARD NON-ZERO TRUTH', process.execPath, ['scripts/v233-seven-board-local-truth-smoke.mjs'], 60000);
if(latestTruth.pass&&!requestedDate){
  const observed=latestTruth.stdout.match(/CE_QC_V233_LATEST_DATE=(\d{4}-\d{2}-\d{2})/)?.[1]||'';
  if(observed&&observed!==reportDate){
    blocked=true;
    emit(`[BLOCKED] full acceptance date ${reportDate} does not match V233 latest persisted date ${observed}`);
  }
}
const day = runPhase('A. DAILY DATA SOURCE -> NORMALIZED -> CURRENT CONSISTENCY', process.execPath, ['scripts/CE_QC_First_Day_GoLive_Verify_ReadOnly.mjs', reportDate], 60000);
const business = runPhase('B. SEVEN-BUSINESS SNAPSHOT CONSISTENCY + QUERY SPEED', process.execPath, ['scripts/CE_QC_Business_Snapshot_Audit_ReadOnly.mjs', reportDate, 'ALL'], 60000);
const terminal = runPhase('B2. WHPP TERMINAL AUTHORITY - ALL DATES + CE01072600002', process.execPath, ['scripts/CE_QC_WHPP_Terminal_Authority_Audit_ReadOnly.mjs', 'CE01072600002'], 60000);
const shopeeResume = runPhase('B3. SHOPEE RESUME AUDIT - BATCH IDENTITY + CURRENT CHECKPOINT', process.execPath, ['scripts/CE_QC_SHOPEE_Resume_Audit_ReadOnly.mjs'], 60000);
const shopeeWhppTruth = runPhase('B4. SHOPEE WHPP TERMINAL-LOCATION + CEAF DISPLAY SOURCE TRUTH', process.execPath, ['scripts/CE_QC_V94_SHOPEE_WHPP_SourceTruth_Audit_ReadOnly.mjs', reportDate], 60000);

const criticalTests = [
  'test/v86-strict-track-status-gate.test.js',
  'test/v92-whpp-terminal-authority.test.js',
  'test/v93-shopee-resume-resilience.test.js',
  'test/v94-shopee-whpp-source-truth.test.js',
  'test/v94-fast-dashboard-whpp-precedence.test.js',
  'test/v70-confirm-query-resilience.test.js',
  'test/v61-drilldown-route-bridge.test.js',
  'test/v55-dashboard-reconciliation.test.js',
  'test/v84-async-large-range-export.test.js',
  'test/v87-whpp-large-range-export.test.js',
  'test/v88-export-job-resume.test.js',
  'test/v89-fast-dashboard-source-truth.test.js',
  'test/v90-instant-whpp-navigation.test.js'
];
const critical = runPhase('C. CRITICAL SCAN/TRACK/RESUME/WHPP-SOURCE-TRUTH/DRILLDOWN/EXPORT/PERFORMANCE REGRESSION', process.execPath, ['--test', ...criticalTests], 120000);
const functional = runPhase('C2. FINAL USER-FACING FUNCTIONAL MATRIX - PERIOD/DETAIL/RULES/ATTEMPTS/WHPP/XLSX/UPDATE', process.execPath, ['scripts/v235-final-functional-acceptance.cjs'], 300000);
const full = runNpmPhase('D. COMPLETE GO-LIVE REGRESSION SUITE', 'test:golive', 420000);

const perfWarn = /PERFORMANCE_RESULT: WARN_QUERY_OVER_1S/.test(day.stdout) || /BLOCKED_SLOW_QUERY/.test(day.stdout) || /BLOCKED_SLOW_QUERY/.test(business.stdout);

emit(`\n============================================================`);
emit('FINAL ACCEPTANCE SUMMARY');
emit('============================================================');
emit(`Latest persisted seven-board truth: ${latestTruth.pass ? 'PASS' : 'BLOCKED'}`);
emit(`Daily data consistency: ${day.pass ? 'PASS' : 'BLOCKED'}`);
emit(`Seven-business consistency: ${business.pass ? 'PASS' : 'BLOCKED'}`);
emit(`WHPP terminal authority: ${terminal.pass ? 'PASS' : 'BLOCKED'}`);
emit(`SHOPEE resume integrity: ${shopeeResume.pass ? 'PASS' : 'BLOCKED'}`);
emit(`SHOPEE WHPP/CEAF source truth: ${shopeeWhppTruth.pass ? 'PASS' : 'BLOCKED'}`);
emit(`Critical scan/track/resume/WHPP-source-truth/drilldown/export tests: ${critical.pass ? 'PASS' : 'BLOCKED'}`);
emit(`Final period/detail/rules/Shopee-attempt/WHPP/XLSX/update functional matrix: ${functional.pass ? 'PASS' : 'BLOCKED'}`);
emit(`Full go-live regression: ${full.pass ? 'PASS' : 'BLOCKED'}`);
emit(`Live DB query speed: ${perfWarn ? 'WARN/BLOCKED - inspect PERF lines' : 'PASS'}`);
emit(`ACCEPTANCE_RESULT: ${blocked ? 'BLOCKED' : 'READY_FOR_MANAGED_UPDATE'}`);
emit(`Log: ${logFile}`);

fs.writeFileSync(logFile, `${lines.join('\n')}\n`, 'utf8');
process.exitCode = blocked ? 10 : 0;
