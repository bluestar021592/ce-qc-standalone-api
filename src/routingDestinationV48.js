export const ROUTING_DESTINATIONS = Object.freeze({
  CCSLCN: 'CCSLCN',
  CCSLZT: 'CCSLZT',
  CCSL580: 'CCSL580'
});

const FINAL_NODE_FIELDS = Object.freeze([
  'latestEffectiveTargetNodeCode',
  'latestEffectiveTargetNode',
  'latestTargetNodeCode',
  'latestTargetNode',
  'latestNodeCode',
  'latestNode',
  '最后节点编码',
  '最后节点'
]);

/**
 * Routing classification is intentionally FINAL-NODE ONLY.
 *
 * A shipment may have visited CCSLCN / CCSLZT / CCSL580 earlier in its history.
 * That historical evidence must never make it appear in several routing cards.
 * The first populated final-node field is authoritative; if it points somewhere
 * else, stale specialState/category text is ignored. specialState is used only
 * as a compatibility fallback for old rows that have no final-node field at all.
 */
export function classifyFinalRoutingDestination(row = {}) {
  const merged = unwrapRow(row);

  for (const field of FINAL_NODE_FIELDS) {
    const raw = String(merged[field] ?? '').trim();
    if (!raw) continue;
    const destination = destinationFromNodeText(raw);
    return {
      destination,
      finalNode: destination ? canonicalNodeLabel(destination) : normalizeDisplayNode(raw),
      sourceField: field,
      usedFallback: false
    };
  }

  const fallback = String(merged.specialState || merged.primaryCategory || merged.主分类 || '').trim().toUpperCase();
  const destination = destinationFromSpecialState(fallback);
  return {
    destination,
    finalNode: destination ? canonicalNodeLabel(destination) : '',
    sourceField: destination ? 'specialStateFallback' : '',
    usedFallback: Boolean(destination)
  };
}

export function destinationFromNodeText(value = '') {
  const source = String(value || '').normalize('NFKC').toUpperCase();
  if (!source.trim()) return '';

  // Prefer an explicit CE/CEL node token. If a final-event description happens
  // to contain both source and target nodes, the last routing token is the target.
  const explicit = [...source.matchAll(/(?:CEL|CE)\s*:\s*(CCSLCN|CCSLZT|CCSL580|CECN|CEZT|580)(?![A-Z0-9])/g)];
  if (explicit.length) return canonicalDestination(explicit.at(-1)[1]);

  const compact = source
    .replace(/[【】\[\](){}]/g, ' ')
    .replace(/\s+/g, '')
    .replace(/^(?:CEL|CE):/, '');

  if (/^(?:CCSLCN|CECN)$/.test(compact)) return ROUTING_DESTINATIONS.CCSLCN;
  if (/^(?:CCSLZT|CEZT)$/.test(compact)) return ROUTING_DESTINATIONS.CCSLZT;
  if (/^(?:CCSL580|580)$/.test(compact)) return ROUTING_DESTINATIONS.CCSL580;
  return '';
}

export function canonicalNodeLabel(destination = '') {
  if (destination === ROUTING_DESTINATIONS.CCSLCN) return 'CEL:CCSLCN';
  if (destination === ROUTING_DESTINATIONS.CCSLZT) return 'CEL:CCSLZT';
  if (destination === ROUTING_DESTINATIONS.CCSL580) return 'CEL:CCSL580';
  return '';
}

function canonicalDestination(code = '') {
  const value = String(code || '').toUpperCase();
  if (['CCSLCN', 'CECN'].includes(value)) return ROUTING_DESTINATIONS.CCSLCN;
  if (['CCSLZT', 'CEZT'].includes(value)) return ROUTING_DESTINATIONS.CCSLZT;
  if (['CCSL580', '580'].includes(value)) return ROUTING_DESTINATIONS.CCSL580;
  return '';
}

function destinationFromSpecialState(value = '') {
  if (['CCSLCN_DIVERSION', 'CECN_RETENTION'].includes(value)) return ROUTING_DESTINATIONS.CCSLCN;
  if (['CCSLZT_DIVERSION', 'CEZT_RETENTION'].includes(value)) return ROUTING_DESTINATIONS.CCSLZT;
  if (['CCSL580_DIVERSION', 'CCSL580_RETENTION'].includes(value)) return ROUTING_DESTINATIONS.CCSL580;
  return '';
}

function unwrapRow(row = {}) {
  let raw = {};
  const rawJson = row.rawJson ?? row.rowJson;
  if (rawJson && typeof rawJson === 'object') raw = rawJson;
  else if (typeof rawJson === 'string' && rawJson.trim()) {
    try { raw = JSON.parse(rawJson); } catch {}
  }
  return { ...raw, ...row };
}

function normalizeDisplayNode(value = '') {
  return String(value || '').normalize('NFKC').trim().replace(/[【】\[\]]/g, '');
}
