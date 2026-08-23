import XLSX from 'xlsx';
import { getDb, nowIso } from './db.js';
import {
  SHOP_WHITELIST_VERSION,
  SHOP_WHITELIST_SOURCE_SHA256,
  SHOP_WHITELIST_AVAILABLE,
  SHOP_WHITELIST_SOURCE_KIND,
  normalizeShopCode as normalizeLatestShopCode,
  isSupportedShopCode,
  latestShopCodeMap,
  seedLatestShopWhitelist
} from './shopWhitelist.js';

export const SHOP_CODE_RUNTIME_VERSION = '2026-08-23-v270-user-upload-authoritative-merge-v1';
const SHOP_CODE_RE = /(?:^|[^A-Z0-9])((?:CP|FS)\s*\d{6}|(?:PV|PNH)\s*\d{3})(?![A-Z0-9])/gi;
const SHOP_LIKE_RE = /\b(?:CP|FS|PV|PNH)\s*[A-Z0-9-]{2,12}\b/gi;
const SHOP_INBOUND_RE = /入库|到达网点|货物到达|到达门店|抵达|\bINBOUND\b|\bARRIV(?:E|ED|AL)?\b|\bRECEIVED\b/i;
const SHOP_OUTBOUND_RE = /离开网点|货物离开|下一个网点|发往|转往|转运至|送往|\bOUTBOUND\b|\bDEPART(?:ED|URE)?\b|\bLEFT\b|\bNEXT\s+(?:STATION|SITE|BRANCH|NODE)\b/i;
const NORMAL_FINAL_HUB_CODES = new Set(['CCSLCN', 'CCSLPDD']);

export function ensureDefaultShopCodes() {
  return seedLatestShopWhitelist(getDb());
}

/**
 * Runtime authority rule (V270):
 * 1) signed/builtin whitelist is the safe baseline;
 * 2) rows explicitly uploaded by ADMIN into shop_cp_codes are merged on top;
 * 3) uploaded names therefore take effect immediately for every later trajectory
 *    classification without requiring a restart or a daily-report re-upload.
 *
 * Never return latestShopCodeMap() alone: doing so made a successful user import
 * visible in SQLite/UI while silently excluding it from actual shop classification.
 */
export function getShopCodeMap() {
  const db = getDb();
  seedLatestShopWhitelist(db);
  const merged = latestShopCodeMap();
  const persisted = loadAllPersistedShopCodes(db);
  for (const [code, name] of persisted) merged.set(code, name);
  return merged;
}

export function getShopCodeSummary() {
  const db = getDb();
  const seeded = seedLatestShopWhitelist(db);
  const builtin = latestShopCodeMap();
  const persisted = loadAllPersistedShopCodes(db);
  const merged = new Map(builtin);
  for (const [code, name] of persisted) merged.set(code, name);
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
    userUploadedCount: userCount,
    latestUserUpdateAt,
    version: seeded?.version || SHOP_WHITELIST_VERSION,
    runtimeVersion: SHOP_CODE_RUNTIME_VERSION,
    sourceSha256: seeded?.sourceSha256 || SHOP_WHITELIST_SOURCE_SHA256,
    source: userCount > 0 ? 'BUILTIN_PLUS_ADMIN_UPLOAD' : (builtin.size ? SHOP_WHITELIST_SOURCE_KIND : 'SQLITE_PERSISTED'),
    authority: 'ADMIN_UPLOAD_OVERRIDES_BUILTIN'
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

export function detectShopInfo({ events = [], shopCodeMap = null, lastEvent = null } = {}) {
  const codeMap = shopCodeMap || getShopCodeMap();
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
  const matched = matchTargetShop(evidence.targetNode, codeMap);
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

function matchTargetShop(targetNode, codeMap) {
  const target = String(targetNode || '').trim();
  if (!target) return null;
  const codeSet = new Set(codeMap.keys());
  const code = extractShopCodes(target, codeSet)[0];
  if (code && !isNormalFinalHubCode(code)) return { code, name: codeMap.get(code) || code };
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
