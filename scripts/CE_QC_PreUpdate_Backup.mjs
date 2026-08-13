import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
  console.log(JSON.stringify({ ok: true, skipped: true, reason: 'DATABASE_NOT_FOUND', dbFile }));
  process.exit(0);
}

fs.mkdirSync(path.join(dataDir, 'backups', 'pre_update'), { recursive: true });
const source = new DatabaseSync(dbFile);
try {
  source.exec('PRAGMA busy_timeout=10000');
  const integrity = source.prepare('PRAGMA integrity_check').get()?.integrity_check || '';
  if (integrity !== 'ok') throw new Error(`SOURCE_INTEGRITY_FAILED:${integrity}`);
  source.exec('PRAGMA wal_checkpoint(FULL)');
} finally {
  source.close();
}

const dir = path.join(dataDir, 'backups', 'pre_update', stamp());
fs.mkdirSync(dir, { recursive: true });
const copyFile = path.join(dir, 'ce_qc_monitor.db');
fs.copyFileSync(dbFile, copyFile);
const sourceSize = fs.statSync(dbFile).size;
const copySize = fs.statSync(copyFile).size;
if (sourceSize <= 0 || copySize !== sourceSize) throw new Error(`BACKUP_SIZE_MISMATCH:${sourceSize}:${copySize}`);
const sourceHash = sha256(dbFile);
const copyHash = sha256(copyFile);
if (sourceHash !== copyHash) throw new Error('BACKUP_SHA256_MISMATCH');

const verify = new DatabaseSync(copyFile, { readOnly: true });
try {
  verify.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000');
  const integrity = verify.prepare('PRAGMA integrity_check').get()?.integrity_check || '';
  if (integrity !== 'ok') throw new Error(`BACKUP_INTEGRITY_FAILED:${integrity}`);
} finally { verify.close(); }

const manifest = {
  createdAt: new Date().toISOString(),
  reason: 'before-automatic-code-update',
  databasePath: dbFile,
  backupPath: copyFile,
  size: copySize,
  sha256: copyHash,
  beforeCommit,
  targetCommit,
  integrity: 'ok'
};
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log(JSON.stringify({ ok: true, ...manifest }));
