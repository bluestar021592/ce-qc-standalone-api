import XLSX from 'xlsx';
import crypto from 'node:crypto';
import { getDb, nowIso } from './db.js';
import {
  SHOP_WHITELIST_VERSION,
  SHOP_WHITELIST_SOURCE_SHA256,
  SHOP_WHITELIST_AVAILABLE,
  SHOP_WHITELIST_SOURCE_KIND,
  normalizeShopCode as normalizeLatestShopCode,
  normalizeShopAlias,
  isSupportedShopCode,
  latestShopCodeMap,
  latestShopAliasMap,
  seedLatestShopWhitelist
} from './shopWhitelist.js';

export const SHOP_CODE_RUNTIME_VERSION = '2026-10-09-v780-complete-72-active-set-v1';
const ACTIVE_COMPLETE_SHOP_KEY = 'shop_current_complete_codes_v780';
const COMPLETE_SHOP_EXPECTED_COUNT = 72;
const SHOP_CODE_RE = /(?:^|[^A-Z0-9])((?:CP|FS)\s*\d{6}|(?:PV|PNH)\s*\d{3})(?![A-Z0-9])/gi;
const SHOP_LIKE_RE = /\b(?:CP|FS|PV|PNH)\s*[A-Z0-9-]{2,12}\b/gi;
const SHOP_INBOUND_RE = /入库|到达网点|货物到达|到达门店|抵达|\bINBOUND\b|\bARRIV(?:E|ED|AL)?\b|\bRECEIVED\b/i;
const SHOP_OUTBOUND_RE = /离开网点|货物离开|下一个网点|发往|转往|转运至|送往|\bOUTBOUND\b|\bDEPART(?:ED|URE)?\b|\bLEFT\b|\bNEXT\s+(?:STATION|SITE|BRANCH|NODE)\b/i;
const NORMAL_FINAL_HUB_CODES = new Set(['CCSLCN', 'CCSLPDD']);

export function ensureDefaultShopCodes() {
  return seedLatestShopWhitelist(getDb());
}

/**
 * Runtime authority rule (V306):
 * 1) shop code is the strongest identity and never changes a shipment's business board;
 * 2) the signed 95-code workbook is the safe baseline;
 * 3) every alternate name from that same workbook is an alias for the SAME code;
 * 4) ADMIN-uploaded canonical names still override display names without weakening code identity.
 */
// The complete active list is a snapshot, not a union with the historical 95-code
// whitelist or old admin uploads. Keep the original shop_cp_codes/whitelist rows
// for audit and historical evidence. Only THIS map is used by current detection.
export function getActiveCompleteShopSet(db = getDb()) {
  const row=db.prepare('SELECT value FROM app_meta WHERE key=?').get(ACTIVE_COMPLETE_SHOP_KEY);
  if (!row) return null;
  let config;
  try { config=JSON.parse(String(row.value||'')); }
  catch { throw new Error('ACTIVE_SHOP_SET_CORRUPT: 完整门店名单记录无法读取，已禁止回退到旧白名单'); }
  const members=Array.isArray(config?.members) ? config.members : [];
  const codes=new Set();
  for (const member of members) {
    const code=normalizeShopCode(member?.code);
    if (!isSupportedShopCode(code) || !String(member?.name||'').trim() || codes.has(code))
      throw new Error('ACTIVE_SHOP_SET_INVALID: 完整门店名单包含重复、无效或空名称编码');
    codes.add(code);
  }
  if (config?.mode!=='COMPLETE' || members.length!==COMPLETE_SHOP_EXPECTED_COUNT)
    throw new Error('ACTIVE_SHOP_SET_INCOMPLETE: 已保存完整门店名单数量不符，拒绝使用旧名单兜底');
  return config;
}

function newestSavedAdminUpload(db) {
  // New imports have immutable batch membership, even if their filenames are
  // reused. Pre-V780 (already uploaded) workbooks fall back to saved source
  // rows, so the existing 72-file can be activated without reuploading.
  const hasBatch=db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='shop_cp_import_snapshots'").get();
  if(hasBatch){
    const row=db.prepare('SELECT sourceFile,membersJson,createdAt FROM shop_cp_import_snapshots ORDER BY id DESC LIMIT 1').get();
    if(row){
      const members=JSON.parse(String(row.membersJson||'[]'));
      return {sourceFile:String(row.sourceFile||''),latest:String(row.createdAt||''),count:members.length,members};
    }
  }
  const file=db.prepare(`
    SELECT sourceFile, COUNT(*) AS count, MAX(updatedAt) AS latest
    FROM shop_cp_codes
    WHERE sourceFile IS NOT NULL AND TRIM(sourceFile)<>'' AND sourceFile NOT LIKE 'whitelist:%'
      AND (LOWER(sourceFile) LIKE '%.xlsx' OR LOWER(sourceFile) LIKE '%.xls')
    GROUP BY sourceFile
    ORDER BY MAX(updatedAt) DESC, sourceFile ASC LIMIT 1
  `).get();
  if (!file) return null;
  const members=db.prepare('SELECT shopCode,shopName FROM shop_cp_codes WHERE sourceFile=? ORDER BY shopCode').all(file.sourceFile)
    .map(row=>({code:normalizeShopCode(row.shopCode),name:String(row.shopName||'').trim()}));
  return {sourceFile:String(file.sourceFile),latest:String(file.latest||''),count:members.length,members};
}

export function getCompleteShopActivationStatus() {
  const db=getDb();
  const active=getActiveCompleteShopSet(db);
  const latest=newestSavedAdminUpload(db);
  return {
    active:!!active,
    mode:active?.mode || 'LEGACY_UNION',
    activeCount:active?.members?.length || 0,
    activeSource:active?.sourceFile || '',
    activatedAt:active?.activatedAt || '',
    activeVersion:active?.hash || '',
    candidateSource:latest?.sourceFile || '',
    candidateCount:latest?.count || 0,
    readyToActivate:Boolean(latest && latest.count===COMPLETE_SHOP_EXPECTED_COUNT)
  };
}

export function activateSavedCompleteShopList({sourceFile='',expectedCount=COMPLETE_SHOP_EXPECTED_COUNT}={}) {
  const db=getDb();
  const newest=newestSavedAdminUpload(db);
  if(!newest || newest.count!==COMPLETE_SHOP_EXPECTED_COUNT || Number(expectedCount)!==COMPLETE_SHOP_EXPECTED_COUNT)
    throw new Error('COMPLETE_SHOP_LIST_NOT_72: 最新已保存的门店文件不是72个有效编码，请重新上传正确的完整Excel后激活');
  if(String(sourceFile||'').trim() && String(sourceFile).trim()!==newest.sourceFile)
    throw new Error('COMPLETE_SHOP_SOURCE_CHANGED: 文件来源已发生变化，重新检查后再激活');
  const codes=new Set();
  for(const item of newest.members){
    if(!isSupportedShopCode(item.code)||!item.name||codes.has(item.code))
      throw new Error('COMPLETE_SHOP_LIST_INVALID: 存在无效、重复或缺失名称的门店编码');
    codes.add(item.code);
  }
  const now=nowIso();
  const hash=crypto.createHash('sha256').update(JSON.stringify(newest.members)).digest('hex');
  const record={mode:'COMPLETE',sourceFile:newest.sourceFile,activatedAt:now,hash,members:newest.members};
  db.exec(`CREATE TABLE IF NOT EXISTS shop_active_code_set_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sourceFile TEXT NOT NULL, fileHash TEXT NOT NULL,
    membersJson TEXT NOT NULL, activatedAt TEXT NOT NULL
  )`);
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare('INSERT INTO shop_active_code_set_history(sourceFile,fileHash,membersJson,activatedAt) VALUES(?,?,?,?)')
      .run(newest.sourceFile,hash,JSON.stringify(newest.members),now);
    db.prepare(`INSERT INTO app_meta(key,value,updatedAt) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt`)
      .run(ACTIVE_COMPLETE_SHOP_KEY,JSON.stringify(record),now);
    db.exec('COMMIT');
  }catch(error){ db.exec('ROLLBACK');throw error; }
  return {ok:true,mode:'COMPLETE',activeCount:newest.members.length,sourceFile:newest.sourceFile,
    version:hash,activatedAt:now,historyPreserved:true};
}

export function getShopCodeMap() {
  const db = getDb();
  seedLatestShopWhitelist(db);
  const active=getActiveCompleteShopSet(db);
  if(active) return new Map(active.members.map(item=>[item.code,item.name]));
  const merged = latestShopCodeMap();
  const persisted = loadAllPersistedShopCodes(db);
  for (const [code, name] of persisted) merged.set(code, name);
  return merged;
}

export function getShopAliasMap() {
  const db = getDb();
  seedLatestShopWhitelist(db);
  const codeMap = getShopCodeMap();
  const active=getActiveCompleteShopSet(db);
  // In complete-list mode, old aliases (including deactivated store names)
  // cannot create new current-arrival matches; only 72 current names qualify.
  if(active){
    const direct=new Map();
    const collisions=new Set();
    for(const [code,name] of codeMap){
      const alias=normalizeShopAlias(name);
      if(!alias)continue;
      if(direct.has(alias)&&direct.get(alias).code!==code){direct.delete(alias);collisions.add(alias);continue}
      if(!collisions.has(alias))direct.set(alias,{code,name});
    }
    return direct;
  }
  const merged = latestShopAliasMap();
  const blocked = new Set();
  const add = (rawName, rawCode) => {
    const code = normalizeShopCode(rawCode);
    const key = normalizeShopAlias(rawName);
    if (!key || !isSupportedShopCode(code) || blocked.has(key)) return;
    const name = codeMap.get(code) || code;
    const prior = merged.get(key);
    if (prior && prior.code !== code) {
      merged.delete(key);
      blocked.add(key);
      return;
    }
    merged.set(key, { code, name });
  };
  try {
    for (const row of db.prepare('SELECT shopCode, shopName FROM shop_cp_codes ORDER BY shopCode').all() || []) add(row.shopName, row.shopCode);
  } catch {}
  try {
    const rows = db.prepare(`
      SELECT a.shopCode, a.alias
      FROM shop_whitelist_aliases a
      JOIN shop_whitelist_versions v ON v.version=a.version
      WHERE v.active=1
      ORDER BY a.shopCode,a.alias
    `).all();
    for (const row of rows || []) add(row.alias, row.shopCode);
  } catch {}
  return merged;
}

export function getShopCodeSummary() {
  const db = getDb();
  const seeded = seedLatestShopWhitelist(db);
  const builtin = latestShopCodeMap();
  const persisted = loadAllPersistedShopCodes(db);
  const active=getActiveCompleteShopSet(db);
  const merged = active ? new Map(active.members.map(item=>[item.code,item.name])) : new Map(builtin);
  if(!active) for (const [code, name] of persisted) merged.set(code, name);
  let userCount = 0;
  let latestUserUpdateAt = '';
  try {
    const row = db.prepare(`SELECT COUNT(*) count, MAX(updatedAt) latest FROM shop_cp_codes WHERE COALESCE(sourceFile,'') NOT LIKE 'whitelist:%'`).get();
    userCount = Number(row?.count || 0);
    latestUserUpdateAt = String(row?.latest || '');
  } catch {}
  return {
    count: merged.size,
    builtinCount: builtin.size,
    persistedCount: persisted.size,
    aliasCount: getShopAliasMap().size,
    userUploadedCount: userCount,
    latestUserUpdateAt,
    version: seeded?.version || SHOP_WHITELIST_VERSION,
    runtimeVersion: SHOP_CODE_RUNTIME_VERSION,
    sourceSha256: seeded?.sourceSha256 || SHOP_WHITELIST_SOURCE_SHA256,
    source: userCount > 0 ? 'BUILTIN_PLUS_ADMIN_UPLOAD' : (builtin.size ? SHOP_WHITELIST_SOURCE_KIND : 'SQLITE_PERSISTED'),
    activeMode:active?'COMPLETE_72':'LEGACY_UNION',
    activeSource:active?.sourceFile||'',
    activatedAt:active?.activatedAt||'',
    authority: active?'ACTIVE_72_CODES_ONLY_HISTORICAL_PRESERVED':'SHOP_CODE_FIRST_ALIAS_SECOND_BUSINESS_BOARD_UNCHANGED'
  };
}

export function importShopCodesFromWorkbook(filePath, sourceFile = '') {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const found = new Map();
  const conflicts = [];
  const invalidCandidates = [];
  let nonEmptyRows = 0;
  for (const sheetName of wb.SheetNames || []) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });
    for (let index = 0; index < rows.length; index += 1) {
      const cells = (rows[index] || []).map(cell => String(cell || '').normalize('NFKC').trim()).filter(Boolean);
      if (!cells.length) continue;
      nonEmptyRows += 1;
      const text = cells.join(' ');
      const structured = new Set(cells.map(normalizeShopCode).filter(isSupportedShopCode));
      const codes = extractShopCodes(text, structured);
      if (!codes.length) {
        const looksLike = [...text.toUpperCase().matchAll(SHOP_LIKE_RE)].map(match => normalizeShopCode(match[0]));
        if (looksLike.length && !/门店编码|门店名称|POD\s*Data/i.test(text)) {
          invalidCandidates.push({ sheetName, rowNumber: index + 1, values: looksLike.slice(0, 5) });
        }
        continue;
      }
      for (const code of codes) {
        const name = pickShopName(cells, code);
        const previous = found.get(code);
        if (previous && normalizeShopName(previous) !== normalizeShopName(name)) {
          conflicts.push({ sheetName, rowNumber: index + 1, shopCode: code, firstName: previous, secondName: name });
          continue;
        }
        found.set(code, name);
      }
    }
  }
  if (conflicts.length) {
    const sample = conflicts.slice(0, 5).map(row => `${row.shopCode}:“${row.firstName}”/“${row.secondName}”`).join('；');
    const error = new Error(`门店CP码文件存在同码不同名称冲突，已阻止导入：${sample}`);
    error.code = 'SHOP_CODE_NAME_CONFLICT';
    error.conflicts = conflicts;
    throw error;
  }
  if (!found.size) {
    const error = new Error('没有识别到有效门店编码。支持格式：CP/FS+6位数字、PV/PNH+3位数字。');
    error.code = 'NO_VALID_SHOP_CODES';
    error.invalidCandidates = invalidCandidates;
    throw error;
  }

  const db = getDb();
  seedLatestShopWhitelist(db);
  const before = loadAllPersistedShopCodes(db);
  const now = nowIso();
  db.exec(`CREATE TABLE IF NOT EXISTS shop_cp_import_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sourceFile TEXT NOT NULL, membersJson TEXT NOT NULL, createdAt TEXT NOT NULL
  )`);
  const stmt = db.prepare(`
    INSERT INTO shop_cp_codes(shopCode, shopName, sourceFile, createdAt, updatedAt)
    VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(shopCode) DO UPDATE SET
      shopName=excluded.shopName,
      sourceFile=excluded.sourceFile,
      updatedAt=excluded.updatedAt
  `);
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [code, name] of found) {
      const old = before.get(code);
      if (!old) added += 1;
      else if (normalizeShopName(old) !== normalizeShopName(name)) updated += 1;
      else unchanged += 1;
      stmt.run(code, name, sourceFile || '', now, now);
    }
    db.prepare('INSERT INTO shop_cp_import_snapshots(sourceFile,membersJson,createdAt) VALUES(?,?,?)')
      .run(String(sourceFile||''),JSON.stringify([...found].sort(([a],[b])=>a.localeCompare(b)).map(([code,name])=>({code,name}))),now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const summary = getShopCodeSummary();
  return {
    imported: found.size,
    added,
    updated,
    unchanged,
    invalidCandidateRows: invalidCandidates.length,
    invalidCandidates: invalidCandidates.slice(0, 20),
    total: summary.count,
    userUploadedCount: summary.userUploadedCount,
    runtimeVersion: SHOP_CODE_RUNTIME_VERSION,
    authority: summary.authority,
    effectiveImmediately: true,
    nonEmptyRows
  };
}

export function detectShopInfo({ events = [], shopCodeMap = null, shopAliasMap = null, lastEvent = null } = {}) {
  const codeMap = shopCodeMap || getShopCodeMap();
  const aliasMap = shopAliasMap || getShopAliasMap();
  const effectiveLast = lastEvent || lastEffectiveEvent(events);
  if (!effectiveLast) return { isShop: false, matchedRule: 'NO_EFFECTIVE_EVENT' };

  const evidence = parseEventNodeAction(effectiveLast);
  if (!['INBOUND', 'OUTBOUND'].includes(evidence.actionType)) {
    return { isShop: false, ...evidence, matchedRule: 'LAST_EVENT_NOT_NODE_ACTION' };
  }
  if (isNormalFinalHubCode(evidence.targetNodeCode)) {
    return { isShop: false, ...evidence, matchedRule: 'NORMAL_FINAL_HUB' };
  }

  const supportedTargetCode = extractSupportedShopCodes(evidence.targetNode)[0] || '';
  const matched = matchTargetShop(evidence.targetNode, codeMap, aliasMap, Boolean(getActiveCompleteShopSet()));
  if (!matched) {
    if (supportedTargetCode) {
      return { isShop: false, unknownShopCode: supportedTargetCode, ...evidence, matchedRule: 'UNKNOWN_SHOP_CODE' };
    }
    return { isShop: false, ...evidence, matchedRule: 'TARGET_NOT_IN_SHOP_WHITELIST' };
  }

  const inbound = evidence.actionType === 'INBOUND';
  return {
    isShop: true,
    shopCode: matched.code,
    shopName: matched.name,
    shopMatchSource: matched.source,
    shopMatchedAlias: matched.alias || '',
    shopStatus: inbound ? '门店入库' : '门店途中',
    shopActionType: inbound ? '门店入库' : '门店途中',
    matchedCodes: [matched.code],
    inboundTime: inbound ? effectiveLast.eventTime || '' : '',
    outboundTime: inbound ? '' : effectiveLast.eventTime || '',
    matchedActionText: eventNodeText(effectiveLast),
    hasShopInbound: inbound,
    hasShopOutbound: !inbound,
    ...evidence,
    matchedRule: inbound ? 'SHOP_INBOUND_WHITELIST' : 'SHOP_OUTBOUND_WHITELIST'
  };
}

export function parseEventNodeAction(event = {}) {
  const text = eventNodeText(event);
  const codeText = `${event?.eventCode || ''} ${event?.trackingEventCode || ''}`.toUpperCase();
  let actionType = 'OTHER';
  if (/\bOUTBOUND\b/.test(codeText) || SHOP_OUTBOUND_RE.test(text)) actionType = 'OUTBOUND';
  else if (/\bINBOUND\b/.test(codeText) || SHOP_INBOUND_RE.test(text)) actionType = 'INBOUND';

  const targetNode = extractTargetNode(text, actionType)
    || cleanNodeLabel(event?.eventShop)
    || cleanNodeLabel(event?.locationCode)
    || cleanNodeLabel(event?.place);
  return {
    lastEventActionType: actionType,
    actionType,
    lastEventTargetNode: targetNode,
    targetNode,
    targetNodeCode: normalizeNodeCode(targetNode)
  };
}

export function isNormalFinalHubArrival(event = {}) {
  const evidence = parseEventNodeAction(event);
  return evidence.actionType === 'INBOUND' && isNormalFinalHubCode(evidence.targetNodeCode);
}

export function isNormalFinalHubCode(value) {
  return NORMAL_FINAL_HUB_CODES.has(normalizeNodeCode(value));
}

export function lastEffectiveEvent(events = []) {
  const sorted = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => isEffectiveEvent(event))
    .sort((a, b) => eventSortKey(a.event).localeCompare(eventSortKey(b.event)) || a.index - b.index);
  return sorted.at(-1)?.event || null;
}

export function extractSupportedShopCodes(text) {
  const out = [];
  const src = String(text || '').normalize('NFKC').toUpperCase();
  for (const match of src.matchAll(SHOP_CODE_RE)) {
    const code = normalizeShopCode(match[1]);
    if (isSupportedShopCode(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

export function extractShopCodes(text, codeSet) {
  const out = [];
  const src = String(text || '').toUpperCase();
  for (const match of src.matchAll(SHOP_CODE_RE)) {
    const code = normalizeShopCode(match[1]);
    if (codeSet.has(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

function loadAllPersistedShopCodes(db) {
  const out = new Map();
  try {
    const legacy = db.prepare('SELECT shopCode, shopName FROM shop_cp_codes ORDER BY shopCode').all();
    for (const row of legacy || []) {
      const code = normalizeShopCode(row.shopCode);
      if (isSupportedShopCode(code)) out.set(code, String(row.shopName || code).trim() || code);
    }
  } catch {}
  return out;
}

function loadPersistedShopCodeMap(db) {
  const out = new Map();
  try {
    const active = db.prepare(`
      SELECT e.shopCode, e.shopName
      FROM shop_whitelist_entries e
      JOIN shop_whitelist_versions v ON v.version=e.version
      WHERE v.active=1 AND e.classificationEnabled=1
      ORDER BY e.shopCode
    `).all();
    for (const row of active || []) {
      const code = normalizeShopCode(row.shopCode);
      if (isSupportedShopCode(code)) out.set(code, String(row.shopName || code).trim() || code);
    }
  } catch {}
  if (!out.size) return loadAllPersistedShopCodes(db);
  return out;
}

function matchTargetShop(targetNode, codeMap, aliasMap, strictCanonical = false) {
  const target = String(targetNode || '').trim();
  if (!target) return null;
  const codeSet = new Set(codeMap.keys());
  const code = extractShopCodes(target, codeSet)[0];
  if (code && !isNormalFinalHubCode(code)) return { code, name: codeMap.get(code) || code, source: 'CODE', alias: '' };

  const normalized = normalizeShopAlias(target);
  const direct = aliasMap.get(normalized);
  if (direct?.code) return { code: direct.code, name: codeMap.get(direct.code) || direct.name || direct.code, source: 'NAME_ALIAS', alias: normalized };
  // Strict current mode never uses fuzzy or substring matching: it could turn
  // a retired shop name into an arrival for a similarly named active shop.
  if(strictCanonical)return null;

  // Some CE descriptions append operational words after the node name. Allow a
  // unique long alias to match as a substring, but never use short names this way.
  const matches = [];
  for (const [aliasKey, row] of aliasMap) {
    if (aliasKey.length < 5) continue;
    if (normalized.includes(aliasKey) || aliasKey.includes(normalized)) matches.push({ aliasKey, row });
  }
  const uniqueCodes = [...new Set(matches.map(item => item.row.code))];
  if (uniqueCodes.length === 1) {
    const winner = matches.sort((a, b) => b.aliasKey.length - a.aliasKey.length)[0];
    const matchedCode = winner.row.code;
    return { code: matchedCode, name: codeMap.get(matchedCode) || winner.row.name || matchedCode, source: 'NAME_ALIAS', alias: winner.aliasKey };
  }
  return null;
}

function extractTargetNode(text, actionType) {
  const patterns = actionType === 'OUTBOUND'
    ? [
        /下一个网点(?:为|是|:|：)?\s*[【\[]([^】\]]+)[】\]]/i,
        /(?:发往|转往|转运至|送往)(?:网点)?\s*[【\[]([^】\]]+)[】\]]/i,
        /next\s+(?:station|site|branch|node)(?:\s+is|\s*:)?\s*[【\[]?([^】\]\r\n,，;；]+)/i
      ]
    : [
        /(?:货物)?到达网点\s*[【\[]([^】\]]+)[】\]]/i,
        /(?:到达门店|门店入库|抵达)(?:网点|门店)?\s*[【\[]([^】\]]+)[】\]]/i,
        /(?:inbound|arriv(?:e|ed|al)?|received)(?:\s+(?:at|to))?\s*[【\[]?([^】\]\r\n,，;；]+)/i
      ];
  for (const re of patterns) {
    const match = String(text || '').match(re);
    if (match?.[1]) return cleanNodeLabel(match[1]);
  }
  return '';
}

function normalizeNodeCode(value) {
  return cleanNodeLabel(value).toUpperCase().replace(/^CEL\s*:\s*/i, '').replace(/\s+/g, '');
}

function normalizeShopCode(value) {
  return normalizeLatestShopCode(value);
}

function normalizeShopName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
}

function cleanNodeLabel(value) {
  return String(value || '')
    .trim()
    .replace(/^[【\[]|[】\]]$/g, '')
    .replace(/^CEL\s*:\s*/i, '')
    .trim();
}

function eventNodeText(event) {
  return [
    event?.trackingEventDescZh,
    event?.trackingEventDesc,
    event?.trackingEventDescKm,
    event?.remark,
    event?.eventShop,
    event?.locationCode,
    event?.place
  ].map(value => String(value || '').trim()).filter(Boolean).join(' ');
}

function isEffectiveEvent(event) {
  return Boolean(event && (
    event.eventTime || event.eventCode || event.trackingEventCode || eventNodeText(event)
  ));
}

function eventSortKey(event) {
  const value = String(event?.eventTime || '').trim();
  if (!value) return '';
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(value)
    ? `${value.replace(' ', 'T').replace(/Z|[+-]\d{2}:?\d{2}$/, '')}+07:00`
    : value;
  const stamp = Date.parse(iso);
  return Number.isFinite(stamp) ? String(stamp).padStart(16, '0') : value;
}

function pickShopName(cells, code) {
  const name = cells.find(cell => {
    const value = String(cell || '').trim();
    if (!value || /^(?:(?:CP|FS)\d{6}|(?:PV|PNH)\d{3})$/i.test(normalizeShopCode(value)) || /^\d+$/.test(value)) return false;
    return !/门店编码|门店名称|POD\s*Data/i.test(value);
  });
  return name || code;
}
