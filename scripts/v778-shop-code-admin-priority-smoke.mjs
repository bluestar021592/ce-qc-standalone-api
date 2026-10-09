import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {
  LATEST_SHOP_STORES, SHOP_WHITELIST_VERSION, seedLatestShopWhitelist
} from '../src/shopWhitelist.js';

const db=new DatabaseSync(':memory:');
try {
  db.exec(`
    CREATE TABLE shop_whitelist_versions (
      version TEXT PRIMARY KEY, sourceFile TEXT, sourceSha256 TEXT,
      fileSha256 TEXT, active INTEGER, storeCount INTEGER, createdAt TEXT
    );
    CREATE TABLE shop_whitelist_entries (
      version TEXT, shopCode TEXT, shopName TEXT, prefix TEXT,
      classificationEnabled INTEGER, createdAt TEXT, updatedAt TEXT,
      PRIMARY KEY(version,shopCode)
    );
    CREATE TABLE shop_whitelist_aliases (
      version TEXT, shopCode TEXT, alias TEXT, createdAt TEXT,
      PRIMARY KEY(version,shopCode,alias)
    );
    CREATE TABLE shop_cp_codes (
      shopCode TEXT PRIMARY KEY, shopName TEXT, sourceFile TEXT,
      createdAt TEXT, updatedAt TEXT
    );
  `);
  assert.ok(LATEST_SHOP_STORES.length>=1,'built-in CP baseline must exist');
  const testStore=LATEST_SHOP_STORES[0];
  const code=testStore.code;
  const row=()=>db.prepare('SELECT shopName,sourceFile FROM shop_cp_codes WHERE shopCode=?').get(code);
  seedLatestShopWhitelist(db);
  assert.equal(row().shopName,testStore.name,'baseline should seed a newly known code');
  assert.equal(row().sourceFile,'whitelist:'+SHOP_WHITELIST_VERSION);
  const officialLatestName='LOCAL ADMIN VERIFIED CP NAME';
  db.prepare('UPDATE shop_cp_codes SET shopName=?,sourceFile=?,updatedAt=? WHERE shopCode=?')
    .run(officialLatestName,'latest_admin_cp_2026_10.xlsx','2026-10-09',code);
  for(let i=0;i<3;i++){
    seedLatestShopWhitelist(db);
    assert.equal(row().shopName,officialLatestName,'daily store detection must not override imported code/name');
    assert.equal(row().sourceFile,'latest_admin_cp_2026_10.xlsx','admin source must stay auditable');
  }
  // Existing rows with unknown/missing provenance also may be manually
  // maintained and must not silently be overwritten by bootstrap.
  db.prepare('UPDATE shop_cp_codes SET shopName=?,sourceFile=? WHERE shopCode=?')
    .run('PREVIOUS MANUAL CODE NAME','',code);
  seedLatestShopWhitelist(db);
  assert.equal(row().shopName,'PREVIOUS MANUAL CODE NAME');
  // Older bundled rows, unlike administrator rows, may be refreshed safely.
  db.prepare('UPDATE shop_cp_codes SET shopName=?,sourceFile=? WHERE shopCode=?')
    .run('STALE BUILTIN NAME','whitelist:OLD_VERSION',code);
  seedLatestShopWhitelist(db);
  assert.equal(row().shopName,testStore.name,'outdated built-in seed may be upgraded');
  assert.equal(row().sourceFile,'whitelist:'+SHOP_WHITELIST_VERSION);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM shop_whitelist_entries').get().n,LATEST_SHOP_STORES.length);
  console.log('[V778 SHOP CP PRIORITY] latest admin Excel CP names, manual names and baseline aliases retained across repeated store lookups; whitelist-only seed refreshed PASS');
}finally{db.close()}
