export const RECIPIENT_GROUPS = Object.freeze(['CN', 'VN', 'OTHER']);

const EXACT_GROUPS = new Map([
  ['shopeecn', 'CN'],
  ['shopeevn', 'VN']
]);

export function normalizeRecipient(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function classifyRecipient(value) {
  const raw = String(value ?? '');
  const normalized = normalizeRecipient(raw);
  if (!normalized) {
    return {
      recipient_raw: raw,
      recipient_normalized: '',
      recipient_group: 'OTHER',
      recipient_group_reason: 'EMPTY_RECIPIENT'
    };
  }
  const group = EXACT_GROUPS.get(normalized.toLocaleLowerCase('en-US')) || 'OTHER';
  return {
    recipient_raw: raw,
    recipient_normalized: normalized,
    recipient_group: group,
    recipient_group_reason: group === 'OTHER' ? 'UNMATCHED_RECIPIENT' : 'EXACT_MATCH'
  };
}

export function normalizeRecipientGroup(value, fallback = 'OTHER') {
  const group = String(value || '').trim().toUpperCase();
  return RECIPIENT_GROUPS.includes(group) ? group : fallback;
}

export function recipientGroupOf(row = {}) {
  return normalizeRecipientGroup(row.recipient_group || row.recipientGroup, 'OTHER');
}
