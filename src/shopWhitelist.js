import crypto from 'crypto';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  BUILTIN_SHOP_STORES,
  BUILTIN_SHOP_WHITELIST_SOURCE_FILE,
  BUILTIN_SHOP_WHITELIST_SOURCE_SHA256,
  BUILTIN_SHOP_WHITELIST_VERSION
} from './shopWhitelistBuiltin.js';

const WHITELIST_FILE = fileURLToPath(new URL('./data/shop-whitelist-2026-08-03.json', import.meta.url));
const EXPECTED_WHITELIST_FILE_SHA256 = '4a79222e578de38ad97abd4f34a8545bdf95d626d023bf6cb60be8381de6afe5';

export const SHOP_WHITELIST_AVAILABLE = fs.existsSync(WHITELIST_FILE);

let raw = null;
let payload = {
  version: BUILTIN_SHOP_WHITELIST_VERSION,
  source_file: BUILTIN_SHOP_WHITELIST_SOURCE_FILE,
  source_sha256: BUILTIN_SHOP_WHITELIST_SOURCE_SHA256,
  stores: BUILTIN_SHOP_STORES
};
let loadedFileSha256 = crypto.createHash('sha256').update(JSON.stringify(BUILTIN_SHOP_STORES)).digest('hex');

if (SHOP_WHITELIST_AVAILABLE) {
  raw = fs.readFileSync(WHITELIST_FILE);
  loadedFileSha256 = crypto.createHash('sha256').update(raw).digest('hex');
  if (loadedFileSha256 !== EXPECTED_WHITELIST_FILE_SHA256) {
    throw new Error('门店白名单文件校验失败，已停止加载。');
  }
  payload = JSON.parse(raw.toString('utf8'));
}

export const SHOP_WHITELIST_VERSION = String(payload.version || BUILTIN_SHOP_WHITELIST_VERSION);
export const SHOP_WHITELIST_SOURCE_KIND = SHOP_WHITELIST_AVAILABLE ? 'SIGNED_FILE' : 'BUILTIN_EXECUTION_COPY';
export const SHOP_WHITELIST_SOURCE_SHA256 = String(payload.source_sha256 || '');
export const SHOP_WHITELIST_FILE_SHA256 = loadedFileSha256 || EXPECTED_WHITELIST_FILE_SHA256;
export const SHOP_WHITELIST_PREFIXES = Object.freeze(['CP', 'FS', 'PV', 'PNH']);
export const LATEST_SHOP_STORES = Object.freeze((payload.stores || [])
  .filter(row => row.classification_enabled === true)
  .map(row => Object.freeze({
    code: normalizeShopCode(row.shop_code),
    name: String(row.canonical_name || row.shop_code || '').trim(),
    prefix: String(row.prefix || '').toUpperCase(),
    aliases: Object.freeze((row.aliases || []).map(value => String(value || '').trim()).filter(Boolean))
  }))
  .filter(row => isSupportedShopCode(row.code)));

const STORE_BY_CODE = new Map(LATEST_SHOP_STORES.map(row => [row.code, row]));

export function normalizeShopCode(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase();
}

export function isSupportedShopCode(value) {
  const code = normalizeShopCode(value);
  return /^(?:CP|FS)\d{6}$/.test(code) || /^(?:PV|PNH)\d{3}$/.test(code);
}

export function getLatestShopByCode(value) {
  return STORE_BY_CODE.get(normalizeShopCode(value)) || null;
}

export function extractStructuredShopCodes(value) {
  const text = String(value || '').normalize('NFKC').toUpperCase();
  const matches = text.matchAll(/(?:^|[^A-Z0-9])((?:CP|FS)\s*\d{6}|(?:PV|PNH)\s*\d{3})(?![A-Z0-9])/g);
  return [...new Set([...matches]
    .map(match => normalizeShopCode(match[1]))
    .filter(code => STORE_BY_CODE.has(code)))];
}

export function latestShopCodeMap() {
  return new Map(LATEST_SHOP_STORES.map(row => [row.code, row.name || row.code]));
}

/**
 * Seed the signed whitelist when its source JSON is present.
 *
 * The production whitelist JSON intentionally lives under an ignored data path. A clean Git
 * checkout therefore may not contain that file. In that case we MUST NOT throw, deactivate,
 * truncate, or replace the whitelist already persisted in SQLite. The caller can continue to
 * read the persisted whitelist/shop_cp_codes through shopCodes.js.
 */
export function seedLatestShopWhitelist(db) {
  if (!LATEST_SHOP_STORES.length) {
    return persistedWhitelistSummary(db);
  }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO shop_whitelist_versions(version, sourceFile, sourceSha256, fileSha256, active, storeCount, createdAt)
    VALUES(?,?,?,?,1,?,?)
    ON CONFLICT(version) DO UPDATE SET
      sourceFile=excluded.sourceFile,
      sourceSha256=excluded.sourceSha256,
      fileSha256=excluded.fileSha256,
      active=1,
      storeCount=excluded.storeCount
  `).run(SHOP_WHITELIST_VERSION, String(payload.source_file || ''), SHOP_WHITELIST_SOURCE_SHA256, SHOP_WHITELIST_FILE_SHA256, LATEST_SHOP_STORES.length, now);
  db.prepare('UPDATE shop_whitelist_versions SET active=0 WHERE version<>?').run(SHOP_WHITELIST_VERSION);

  const entry = db.prepare(`
    INSERT INTO shop_whitelist_entries(version, shopCode, shopName, prefix, classificationEnabled, createdAt, updatedAt)
    VALUES(?,?,?,?,1,?,?)
    ON CONFLICT(version,shopCode) DO UPDATE SET
      shopName=excluded.shopName,
      prefix=excluded.prefix,
      classificationEnabled=1,
      updatedAt=excluded.updatedAt
  `);
  const alias = db.prepare(`
    INSERT INTO shop_whitelist_aliases(version, shopCode, alias, createdAt)
    VALUES(?,?,?,?) ON CONFLICT(version,shopCode,alias) DO NOTHING
  `);
  const legacy = db.prepare(`
    INSERT INTO shop_cp_codes(shopCode, shopName, sourceFile, createdAt, updatedAt)
    VALUES(?,?,?,?,?)
    ON CONFLICT(shopCode) DO UPDATE SET shopName=excluded.shopName,sourceFile=excluded.sourceFile,updatedAt=excluded.updatedAt
  `);
  for (const store of LATEST_SHOP_STORES) {
    entry.run(SHOP_WHITELIST_VERSION, store.code, store.name, store.prefix, now, now);
    legacy.run(store.code, store.name, `whitelist:${SHOP_WHITELIST_VERSION}`, now, now);
    for (const name of store.aliases) alias.run(SHOP_WHITELIST_VERSION, store.code, name, now);
  }
  return {
    version: SHOP_WHITELIST_VERSION,
    sourceSha256: SHOP_WHITELIST_SOURCE_SHA256,
    fileSha256: SHOP_WHITELIST_FILE_SHA256,
    count: LATEST_SHOP_STORES.length,
    source: SHOP_WHITELIST_SOURCE_KIND
  };
}

function persistedWhitelistSummary(db) {
  let version = SHOP_WHITELIST_VERSION;
  let sourceSha256 = '';
  let fileSha256 = '';
  let count = 0;

  try {
    const hasVersions = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='shop_whitelist_versions'").get();
    const hasEntries = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='shop_whitelist_entries'").get();
    if (hasVersions && hasEntries) {
      const active = db.prepare(`
        SELECT version, sourceSha256, fileSha256, storeCount
        FROM shop_whitelist_versions
        WHERE active=1
        ORDER BY createdAt DESC
        LIMIT 1
      `).get();
      if (active?.version) version = String(active.version);
      sourceSha256 = String(active?.sourceSha256 || '');
      fileSha256 = String(active?.fileSha256 || '');
      count = Number(db.prepare(`
        SELECT COUNT(*) AS count
        FROM shop_whitelist_entries
        WHERE version=? AND classificationEnabled=1
      `).get(version)?.count || 0);
    }
  } catch {}

  if (!count) {
    try {
      const hasLegacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='shop_cp_codes'").get();
      if (hasLegacy) count = Number(db.prepare('SELECT COUNT(*) AS count FROM shop_cp_codes').get()?.count || 0);
    } catch {}
  }

  return { version, sourceSha256, fileSha256, count, source: 'SQLITE_PERSISTED' };
}
