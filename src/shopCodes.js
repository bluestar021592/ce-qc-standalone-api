import XLSX from 'xlsx';
import { getDb, nowIso } from './db.js';
import {
  SHOP_WHITELIST_VERSION,
  SHOP_WHITELIST_SOURCE_SHA256,
  normalizeShopCode as normalizeLatestShopCode,
  isSupportedShopCode,
  latestShopCodeMap,
  seedLatestShopWhitelist
} from './shopWhitelist.js';

const SHOP_CODE_RE = /(?:^|[^A-Z0-9])((?:CP|FS)\s*\d{6}|(?:PV|PNH)\s*\d{3})(?![A-Z0-9])/gi;
const SHOP_INBOUND_RE = /入库|到达网点|货物到达|到达门店|抵达|\bINBOUND\b|\bARRIV(?:E|ED|AL)?\b|\bRECEIVED\b/i;
const SHOP_OUTBOUND_RE = /离开网点|货物离开|下一个网点|发往|转往|转运至|送往|\bOUTBOUND\b|\bDEPART(?:ED|URE)?\b|\bLEFT\b|\bNEXT\s+(?:STATION|SITE|BRANCH|NODE)\b/i;
const NORMAL_FINAL_HUB_CODES = new Set(['CCSLCN', 'CCSLPDD']);

export function ensureDefaultShopCodes() {
  seedLatestShopWhitelist(getDb());
}

export function getShopCodeMap() {
  ensureDefaultShopCodes();
  return latestShopCodeMap();
}

export function getShopCodeSummary() {
  ensureDefaultShopCodes();
  const count = latestShopCodeMap().size;
  return { count, version: SHOP_WHITELIST_VERSION, sourceSha256: SHOP_WHITELIST_SOURCE_SHA256 };
}

export function importShopCodesFromWorkbook(filePath, sourceFile = '') {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const found = new Map();
  for (const sheetName of wb.SheetNames || []) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });
    for (const row of rows) {
      const cells = (row || []).map(cell => String(cell || '').trim()).filter(Boolean);
      const text = cells.join(' ');
      for (const code of extractShopCodes(text, new Set(cells.map(normalizeShopCode).filter(isSupportedShopCode)))) {
        found.set(code, pickShopName(cells, code));
      }
    }
  }

  const db = getDb();
  const now = nowIso();
  const stmt = db.prepare(`
    INSERT INTO shop_cp_codes(shopCode, shopName, sourceFile, createdAt, updatedAt)
    VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(shopCode) DO UPDATE SET
      shopName=excluded.shopName,
      sourceFile=excluded.sourceFile,
      updatedAt=excluded.updatedAt
  `);
  for (const [code, name] of found) stmt.run(code, name, sourceFile || '', now, now);
  return { imported: found.size, total: getShopCodeSummary().count };
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

  const matched = matchTargetShop(evidence.targetNode, codeMap);
  if (!matched) return { isShop: false, ...evidence, matchedRule: 'TARGET_NOT_IN_SHOP_WHITELIST' };

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

export function extractShopCodes(text, codeSet) {
  const out = [];
  const src = String(text || '').toUpperCase();
  for (const match of src.matchAll(SHOP_CODE_RE)) {
    const code = normalizeShopCode(match[1]);
    if (codeSet.has(code) && !out.includes(code)) out.push(code);
  }
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
