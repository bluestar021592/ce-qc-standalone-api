import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_DATA_DIR='D:\\CE CCSL金边数据库';
const LEGACY_DB_NAME='ce_qc_monitor.db';
let systemDb=null;
let dataDb=null;

export function nextRuntime(){
  const dataDir=path.resolve(process.env.CE_QC_NEXT_DATA_DIR||process.env.DATA_DIR||DEFAULT_DATA_DIR);
  fs.mkdirSync(dataDir,{recursive:true});
  return {
    dataDir,
    systemDbFile:path.join(dataDir,'ce_qc_next_system.db'),
    dataDbFile:path.join(dataDir,'ce_qc_next_data.db'),
    legacyDbFile:path.resolve(process.env.CE_QC_LEGACY_DB_FILE||process.env.DB_FILE||path.join(dataDir,LEGACY_DB_NAME)),
    tokenDir:path.join(dataDir,'next-token'),
    importsDir:path.join(dataDir,'next-imports'),
    exportsDir:path.join(dataDir,'next-exports')
  };
}

function open(file){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const db=new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout=3000');
  try{db.exec('PRAGMA journal_mode=WAL');}catch{}
  db.exec('PRAGMA synchronous=NORMAL');
  db.exec('PRAGMA foreign_keys=ON');
  return db;
}

export function getSystemDb(){
  if(!systemDb){systemDb=open(nextRuntime().systemDbFile);migrateSystem(systemDb);migrateLegacyUsersOnce(systemDb);}
  return systemDb;
}

export function getDataDb(){
  if(!dataDb){dataDb=open(nextRuntime().dataDbFile);migrateData(dataDb);}
  return dataDb;
}

export function closeNextDbs(){try{systemDb?.close();}catch{}try{dataDb?.close();}catch{}systemDb=null;dataDb=null;}
export function nowIso(){return new Date().toISOString();}

function migrateSystem(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY,value TEXT,updatedAt TEXT);
    CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      displayName TEXT NOT NULL,
      departmentCompany TEXT DEFAULT '',
      email TEXT,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'VIEWER',
      businessScope TEXT NOT NULL DEFAULT 'ALL',
      enabled INTEGER NOT NULL DEFAULT 1,
      mustChangePassword INTEGER NOT NULL DEFAULT 0,
      lastLoginAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      sessionHash TEXT NOT NULL UNIQUE,
      expiresAt TEXT NOT NULL,
      revokedAt TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(userId) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,valueJson TEXT NOT NULL,updatedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS shop_cp_codes(shopCode TEXT PRIMARY KEY,shopName TEXT,updatedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,userId INTEGER,action TEXT NOT NULL,detailJson TEXT,createdAt TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_next_sessions_active ON sessions(sessionHash,expiresAt,revokedAt);
    CREATE INDEX IF NOT EXISTS idx_next_users_enabled ON users(enabled,username);
  `);
  db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES('schema_version','1',?) ON CONFLICT(key) DO UPDATE SET value='1',updatedAt=excluded.updatedAt`).run(nowIso());
}

function migrateData(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS import_batches(
      batchId TEXT PRIMARY KEY, reportDate TEXT NOT NULL, sourceName TEXT NOT NULL,
      fileHash TEXT NOT NULL, status TEXT NOT NULL, summaryJson TEXT NOT NULL,
      warningsJson TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_next_import_unique ON import_batches(reportDate,fileHash,status);
    CREATE TABLE IF NOT EXISTS import_rows(
      id INTEGER PRIMARY KEY AUTOINCREMENT,batchId TEXT NOT NULL,reportDate TEXT NOT NULL,
      businessType TEXT NOT NULL,shipmentCode TEXT NOT NULL,regionCode TEXT,
      recipientRaw TEXT,customerNameRaw TEXT,classificationReason TEXT,rowJson TEXT NOT NULL,createdAt TEXT NOT NULL,
      UNIQUE(batchId,shipmentCode)
    );
    CREATE INDEX IF NOT EXISTS idx_next_import_rows_board ON import_rows(reportDate,businessType,shipmentCode);
    CREATE TABLE IF NOT EXISTS shipment_state(
      shipmentCode TEXT PRIMARY KEY,businessType TEXT NOT NULL,reportDate TEXT NOT NULL,
      state TEXT NOT NULL,isPod INTEGER NOT NULL DEFAULT 0,isReturned INTEGER NOT NULL DEFAULT 0,
      pendingDays INTEGER NOT NULL DEFAULT 0,ocDays INTEGER NOT NULL DEFAULT 0,
      specialState TEXT,lastEventTime TEXT,lastEventDesc TEXT,stateJson TEXT NOT NULL,updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_next_state_board ON shipment_state(reportDate,businessType,state);
    CREATE TABLE IF NOT EXISTS track_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,shipmentCode TEXT NOT NULL,businessType TEXT NOT NULL,reportDate TEXT NOT NULL,
      eventCode TEXT,eventTime TEXT,eventDesc TEXT,place TEXT,rawJson TEXT NOT NULL,createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_next_track_lookup ON track_events(shipmentCode,eventTime);
    CREATE TABLE IF NOT EXISTS carryover(
      shipmentCode TEXT PRIMARY KEY,businessType TEXT NOT NULL,sourceReportDate TEXT NOT NULL,lastReportDate TEXT NOT NULL,
      status TEXT NOT NULL,reason TEXT,stateJson TEXT NOT NULL,updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_metrics(
      reportDate TEXT NOT NULL,businessType TEXT NOT NULL,metricKey TEXT NOT NULL,metricValue REAL NOT NULL,
      payloadJson TEXT NOT NULL,createdAt TEXT NOT NULL,PRIMARY KEY(reportDate,businessType,metricKey)
    );
    CREATE TABLE IF NOT EXISTS export_jobs(
      jobId TEXT PRIMARY KEY,status TEXT NOT NULL,periodType TEXT NOT NULL,businessType TEXT NOT NULL,
      fromDate TEXT,toDate TEXT,filePath TEXT,errorMessage TEXT,createdAt TEXT NOT NULL,completedAt TEXT
    );
  `);
}

function migrateLegacyUsersOnce(target){
  const marker=target.prepare("SELECT value FROM app_meta WHERE key='legacy_users_migrated' LIMIT 1").get()?.value;
  if(marker==='1')return;
  const legacyFile=nextRuntime().legacyDbFile;
  if(!fs.existsSync(legacyFile)){target.prepare("INSERT INTO app_meta(key,value,updatedAt) VALUES('legacy_users_migrated','1',?) ON CONFLICT(key) DO UPDATE SET value='1',updatedAt=excluded.updatedAt").run(nowIso());return;}
  let legacy;
  try{
    legacy=new DatabaseSync(legacyFile,{readOnly:true});
    legacy.exec('PRAGMA query_only=ON');
    const exists=legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users' LIMIT 1").get();
    if(exists){
      const rows=legacy.prepare("SELECT username,displayName,departmentCompany,email,passwordHash,role,businessScope,enabled,mustChangePassword,lastLoginAt,createdAt,updatedAt FROM users WHERE COALESCE(status,'ACTIVE')='ACTIVE'").all();
      const insert=target.prepare(`INSERT INTO users(username,displayName,departmentCompany,email,passwordHash,role,businessScope,enabled,mustChangePassword,lastLoginAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(username) DO NOTHING`);
      target.exec('BEGIN');
      try{for(const row of rows)insert.run(row.username,row.displayName||row.username,row.departmentCompany||'',row.email||null,row.passwordHash,row.role||'VIEWER',row.businessScope||'ALL',Number(row.enabled??1),Number(row.mustChangePassword||0),row.lastLoginAt||null,row.createdAt||nowIso(),row.updatedAt||nowIso());target.exec('COMMIT');}catch(error){target.exec('ROLLBACK');throw error;}
    }
  }catch(error){console.error('[QC-NEXT] legacy user migration skipped:',error?.message||error);}
  finally{try{legacy?.close();}catch{}}
  target.prepare("INSERT INTO app_meta(key,value,updatedAt) VALUES('legacy_users_migrated','1',?) ON CONFLICT(key) DO UPDATE SET value='1',updatedAt=excluded.updatedAt").run(nowIso());
}
