import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2] || 'test-full.log';
const file = path.resolve(process.cwd(), input);

if (!fs.existsSync(file)) {
  console.error(`[CE-QC] Test log not found: ${file}`);
  process.exit(2);
}

const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const lines = text.split('\n');

const summaryKeys = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms'];
const summary = new Map();
for (const line of lines) {
  const match = line.match(/^#\s+(tests|pass|fail|cancelled|skipped|todo|duration_ms)\s+(.+)$/);
  if (match) summary.set(match[1], match[2].trim());
}

const failures = lines
  .filter((line) => /^not ok\s+\d+\s+-\s+/.test(line))
  .map((line) => line.replace(/^not ok\s+\d+\s+-\s+/, '').trim());

console.log('==================== TEST SUMMARY ====================');
for (const key of summaryKeys) {
  if (summary.has(key)) console.log(`# ${key} ${summary.get(key)}`);
}
if (!summary.has('tests')) console.log('# tests summary missing');
if (!summary.has('pass')) console.log('# pass summary missing');
if (!summary.has('fail')) console.log('# fail summary missing');
console.log('======================================================');

if (failures.length) {
  console.log('');
  console.log(`[CE-QC] FAILING TESTS (${failures.length})`);
  for (const [index, name] of failures.entries()) {
    console.log(`${index + 1}. ${name}`);
  }
} else if (summary.get('fail') === '0') {
  console.log('');
  console.log('[CE-QC] FAILING TESTS: none');
}

const failCount = Number(summary.get('fail'));
if (Number.isFinite(failCount) && failCount > 0) process.exitCode = 1;
