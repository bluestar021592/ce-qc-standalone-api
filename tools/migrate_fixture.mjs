const dbFile = process.argv[2];
const dataDir = process.argv[3];
if (!dbFile || !dataDir) throw new Error('Usage: node tools/migrate_fixture.mjs <database-file> <data-dir>');

process.env.DB_FILE = dbFile;
process.env.DATA_DIR = dataDir;
process.env.EXPORTS_DIR = `${dataDir}\\exports`;

const { getDb, closeDb } = await import('../src/db.js');
const db = getDb();
try {
  console.log(JSON.stringify({
    userVersion: Number(db.prepare('PRAGMA user_version').get()?.user_version || 0),
    integrity: db.prepare('PRAGMA integrity_check').get()?.integrity_check || '',
    shopCodeCount: Number(db.prepare('SELECT count(*) AS count FROM shop_cp_codes').get()?.count || 0),
    businessTables: db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'business_%' ORDER BY name").all().map(row => row.name),
    migrationBackups: db.prepare("SELECT backupPath FROM migration_log WHERE toVersion=9 AND status='success' ORDER BY id DESC LIMIT 1").all()
  }, null, 2));
} finally {
  closeDb();
}
