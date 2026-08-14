import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const DEFAULT_DATA_DIR = 'D:\\CE CCSL金边数据库';
const resolveProjectPath = value => path.isAbsolute(value) ? path.normalize(value) : path.resolve(root, value);
const dataDir = resolveProjectPath(process.env.DATA_DIR || DEFAULT_DATA_DIR);
const dbFile = resolveProjectPath(process.env.DB_FILE || path.join(dataDir, 'ce_qc_monitor.db'));
const beforeCommit = String(process.argv[2] || '').trim();
const targetCommit = String(process.argv[3] || '').trim();

function log(step, text) {
  console.log(`[BACKUP ${step}] ${text}`);
}
function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function sha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
    let bytes = 0;
    do {
      bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytes > 0) hash.update(buffer.subarray(0, bytes));
    } while (bytes > 0);
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

if (!fs.existsSync(dbFile)) {
  log('SKIP', `Database not found: ${dbFile}`);
  console.log(JSON.stringify({ ok: true, skipped: true, reason: 'DATABASE_NOT_FOUND', dbFile }));
  process.exit(0);
}

fs.mkdirSync(path.join(dataDir, 'backups', 'pre_update'), { recursive: true });
const dir = path.join(dataDir, 'backups', 'pre_update', stamp());
fs.mkdirSync(dir, { recursive: true });
const copyFile = path.join(dir, 'ce_qc_monitor.db');

log('1/5', 'Opening source SQLite and running quick_check...');
const source = new DatabaseSync(dbFile, { timeout: 10000 });
try {
  source.exec('PRAGMA busy_timeout=10000');
  const quick = source.prepare('PRAGMA quick_check(1)').get()?.quick_check || '';
  if (quick !== 'ok') throw new Error(`SOURCE_QUICK_CHECK_FAILED:${quick}`);

  log('2/5', 'Creating SQLite online backup...');
  let nextReport = 10;
  await backup(source, copyFile, {
    rate: 512,
    progress: ({ totalPages, remainingPages }) => {
      if (!Number.isFinite(totalPages) || totalPages <= 0) return;
      const pct = Math.max(0, Math.min(100, Math.floor(((totalPages - remainingPages) / totalPages) * 100)));
      if (pct >= nextReport || remainingPages === 0) {
        log('2/5', `SQLite backup ${remainingPages === 0 ? 100 : pct}%`);
        while (nextReport <= pct) nextReport += 10;
      }
    }
  });
} finally {
  source.close();
}

log('3/5', 'Opening backup read-only and running full integrity_check...');
const verify = new DatabaseSync(copyFile, { readOnly: true, timeout: 10000 });
try {
  verify.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=10000');
  const integrity = verify.prepare('PRAGMA integrity_check').get()?.integrity_check || '';
  if (integrity !== 'ok') throw new Error(`BACKUP_INTEGRITY_FAILED:${integrity}`);
} finally {
  verify.close();
}

log('4/5', 'Calculating backup SHA-256...');
const copySize = fs.statSync(copyFile).size;
if (copySize <= 0) throw new Error('BACKUP_EMPTY');
const copyHash = sha256(copyFile);

const manifest = {
  createdAt: new Date().toISOString(),
  reason: 'before-automatic-code-update',
  databasePath: dbFile,
  backupPath: copyFile,
  size: copySize,
  sha256: copyHash,
  beforeCommit,
  targetCommit,
  sourceQuickCheck: 'ok',
  integrity: 'ok',
  method: 'node-sqlite-online-backup'
};
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
log('5/5', `Verified backup ready: ${copyFile}`);
console.log(JSON.stringify({ ok: true, ...manifest }));
