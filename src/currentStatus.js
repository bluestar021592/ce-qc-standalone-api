const STATUS_LABELS = Object.freeze({
  POD: '已签收',
  RETURNED: '已退回',
  RETURN_COMPLETED: '已退回',
  RETURN_IN_PROGRESS: '退回处理中',
  SELF_PICKUP: '仓库自提',
  CECN_RETENTION: 'CECN滞留包裹',
  CEZT_RETENTION: 'CEZT滞留包裹',
  CCSL580_RETENTION: '580滞留包裹',
  SHOP_PENDING: '门店Pending',
  SHOP_OC: '门店OC',
  SHOP_RETENTION: '门店滞留',
  SHOP_ARRIVED_CURRENT: '门店入库',
  SHOP_TRANSFER_IN_PROGRESS: '门店途中',
  PENDING: 'Pending',
  CYCLE_COUNT: '盘点',
  WORK_ORDER: '工单',
  INBOUND_NO_SCAN: '入库无扫描',
  SCAN_PENDING_RETRY: '扫描待重试',
  OPEN_TRACK_REQUIRED: '待查询轨迹'
});

const TRACK_LABELS = Object.freeze({
  '26': '入库无扫描',
  '30': '盘点',
  '32': '盘点',
  '99': '工单',
  '150': 'Pending',
  '80': '已签收',
  '84': '退回处理中',
  '86': '已退回'
});

/**
 * User-facing CURRENT status.
 *
 * This deliberately does not use historical QC classifications such as
 * "三次Pending后未退回" or "派送中停留" as the current status. Those remain
 * monitor/anomaly reasons. Current status is derived from the newest effective
 * scan/trajectory state only.
 */
export function latestEffectiveStatusLabel({ currentState = '', state = {}, latestNode = '' } = {}) {
  const rawCurrent = normalize(currentState || state.currentState || state.scanNormalizedState || '');
  const category = String(state.primaryCategory || state.主分类 || state.异常分类 || '').trim();
  const special = normalize(state.specialState || '');
  const trackCode = String(state.latestTrackStatusCode || state.lastEventCode || '').trim();

  // Terminal states always win.
  if (state.是否POD === '是' || state.POD状态 === 'POD' || rawCurrent === 'POD' || trackCode === '80') return '已签收';
  if (state.退回状态 === '已退回' || ['RETURNED', 'RETURN_COMPLETED'].includes(rawCurrent) || trackCode === '86') return '已退回';
  if (state.退回状态 === '退回处理中' || rawCurrent === 'RETURN_IN_PROGRESS' || trackCode === '84') return '退回处理中';

  // Special normal destinations are current routing states, not abnormalities.
  const specialKey = special || specialFromCategory(category);
  if (STATUS_LABELS[specialKey]) return STATUS_LABELS[specialKey];

  // Structured current state from the classifier is authoritative.
  if (STATUS_LABELS[rawCurrent]) return STATUS_LABELS[rawCurrent];
  if (rawCurrent.startsWith('TRACK_')) {
    const code = rawCurrent.slice('TRACK_'.length);
    if (TRACK_LABELS[code]) return TRACK_LABELS[code];
  }

  // Locked trajectory code is the next source of truth.
  if (TRACK_LABELS[trackCode]) return TRACK_LABELS[trackCode];

  // Shop state is a structured current-location state.
  const shop = normalize(state.shopState || '');
  if (STATUS_LABELS[shop]) return STATUS_LABELS[shop];

  // Fall back only to a genuine present-state label, never an accumulated
  // historical anomaly/monitor bucket.
  const explicit = String(state.当前状态 || state.currentStatus || '').trim();
  if (explicit && !isHistoricalMonitorLabel(explicit)) return friendlyInternalLabel(explicit);

  const node = String(latestNode || state.latestEventDesc || state.lastEventDesc || state.最新节点 || state.最后节点 || '').trim();
  const fromNode = statusFromLatestNode(node);
  if (fromNode) return fromNode;

  if (category && !isHistoricalMonitorLabel(category)) return friendlyInternalLabel(category);
  return '待更新';
}

export function isHistoricalMonitorLabel(value = '') {
  const text = String(value || '').trim();
  return /三次Pending后|Pending\d|Pending不连续|OC\d|盘点\d|派送中停留|严重超时|\d+天\+?未更新|门店滞留\d|门店途中\d|退回待处理|异常/i.test(text);
}

function specialFromCategory(category) {
  const value = normalize(category);
  if (['SELF_PICKUP', 'CECN_RETENTION', 'CEZT_RETENTION', 'CCSL580_RETENTION'].includes(value)) return value;
  if (/仓库自提|^自提$/.test(category)) return 'SELF_PICKUP';
  if (/CECN.*滞留/.test(category)) return 'CECN_RETENTION';
  if (/CEZT.*滞留/.test(category)) return 'CEZT_RETENTION';
  if (/580.*滞留/.test(category)) return 'CCSL580_RETENTION';
  return '';
}

function statusFromLatestNode(node) {
  if (!node) return '';
  if (/CE(?:L)?:\s*(?:CCSL)?580\b/i.test(node)) return '580滞留包裹';
  if (/CE(?:L)?:\s*CECN\b/i.test(node)) return 'CECN滞留包裹';
  if (/CE(?:L)?:\s*CEZT\b/i.test(node)) return 'CEZT滞留包裹';
  if (/仓库自提|warehouse\s*self[ -]?pickup|self[ -]?pickup/i.test(node)) return '仓库自提';
  if (/退回处理中|return(?:ing| in progress)/i.test(node)) return '退回处理中';
  if (/已退回|退回完成|return completed/i.test(node)) return '已退回';
  if (/POD|已签收|签收完成/i.test(node)) return '已签收';
  if (/Pending/i.test(node)) return 'Pending';
  if (/盘点|cycle count/i.test(node)) return '盘点';
  if (/work order|工单/i.test(node)) return '工单';
  if (/派送中|delivery in progress/i.test(node)) return '派送中';
  if (/派件分配|delivery assign/i.test(node)) return '派件分配';
  if (/入库|inbound/i.test(node)) return '已入库';
  return '';
}

function friendlyInternalLabel(value) {
  const key = normalize(value);
  if (STATUS_LABELS[key]) return STATUS_LABELS[key];
  if (key.startsWith('TRACK_') && TRACK_LABELS[key.slice(6)]) return TRACK_LABELS[key.slice(6)];
  return String(value || '').trim();
}

function normalize(value) {
  return String(value || '').trim().toUpperCase();
}
