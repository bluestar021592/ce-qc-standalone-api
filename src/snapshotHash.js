import { createHash } from 'crypto';

export function buildSnapshotHashes(view = {}) {
  const dashboardRows = Array.isArray(view.dashboardRows) ? view.dashboardRows : [];
  const detailTabs = view.detailTabs && typeof view.detailTabs === 'object' ? view.detailTabs : {};
  return {
    dashboardMetricHash: hash(dashboardRows.map(metricProjection)),
    detailRowHash: hash(Object.fromEntries(Object.entries(detailTabs)
      .filter(([, tab]) => Array.isArray(tab?.rows))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, tab]) => [key, tab.rows.map(rowProjection).sort(compareRows)])))
  };
}

export function assertSnapshotHashes(expected = {}, actual = {}, label = '导出') {
  const mismatches = [];
  for (const key of ['dashboardMetricHash', 'detailRowHash']) {
    if (expected[key] && expected[key] !== actual[key]) mismatches.push(key);
  }
  if (!mismatches.length) return true;
  const error = new Error(`${label}数据与已保存快照不一致：${mismatches.join('、')}`);
  error.code = 'SNAPSHOT_HASH_MISMATCH';
  error.mismatches = mismatches;
  throw error;
}

function metricProjection(row = {}) {
  return {
    metricKey: row.metricKey || row.项目 || row.指标 || '',
    value: row.数值原值 ?? row.数值 ?? row.数量 ?? null,
    unit: row.单位 || '',
    detailTab: row.明细Tab || '',
    trend: (row.迷你走势数据 || []).map(item => ({
      date: item?.date || '',
      value: item?.hasData === false ? null : (item?.value ?? null),
      hasData: item?.hasData !== false,
      status: item?.status || ''
    }))
  };
}

function rowProjection(row = {}) {
  const output = {};
  for (const key of Object.keys(row || {}).sort()) {
    if (['rawjson', 'debugheaders', 'token', 'password', 'cookie'].includes(String(key).toLowerCase())) continue;
    output[key] = row[key];
  }
  return output;
}

function compareRows(left, right) {
  return stableStringify(left).localeCompare(stableStringify(right));
}

function hash(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortValue(value[key])]));
}
