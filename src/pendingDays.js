const PHNOM_PENH_TIME_ZONE = 'Asia/Phnom_Penh';
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PHNOM_PENH_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit'
});

export function phnomPenhDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const parsed = new Date(normalizeDateTime(text));
  if (!Number.isNaN(parsed.getTime())) return dateFormatter.format(parsed);
  const match = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
}

export function summarizePendingEvents(events = [], isPending = () => false) {
  const rawEvents = events.filter(isPending);
  const byDate = new Map();
  for (const event of rawEvents) {
    const pendingEventDate = phnomPenhDate(event?.eventTime || event?.creationDate || event?.lastUpdateDate);
    if (!pendingEventDate) continue;
    const current = byDate.get(pendingEventDate);
    if (!current || eventTime(event) >= eventTime(current)) byDate.set(pendingEventDate, event);
  }
  const dates = [...byDate.keys()].sort();
  const continuous = dates.length <= 1 || dates.every((date, index) => index === 0 || dayDiff(dates[index - 1], date) === 1);
  const representatives = dates.map(date => ({ pendingEventDate: date, event: byDate.get(date) }));
  const latest = representatives.at(-1)?.event || null;
  return {
    rawEvents,
    rawEventCount: rawEvents.length,
    distinctDayCount: dates.length,
    dates,
    continuous,
    continuity: dates.length <= 1 ? (dates.length ? '单日' : '无') : (continuous ? '连续' : '不连续'),
    representatives,
    latest,
    latestReason: latest ? pendingReason(latest) : '',
    latestTime: latest?.eventTime || latest?.creationDate || latest?.lastUpdateDate || ''
  };
}

export function persistPendingDailyMembers(db, { businessType, reportDate, snapshotId = '', events = [], createdAt }) {
  db.prepare('DELETE FROM pending_daily_members WHERE businessType=? AND reportDate=? AND snapshotId=?').run(businessType, reportDate, snapshotId);
  const grouped = new Map();
  for (const event of events) {
    if (!looksPending(event)) continue;
    const shipmentCode = String(event.shipmentCode || event.运单号 || '').trim().toUpperCase();
    const pendingEventDate = phnomPenhDate(event.eventTime || event.creationDate || event.lastUpdateDate);
    if (!shipmentCode || !pendingEventDate) continue;
    const key = `${shipmentCode}|${pendingEventDate}`;
    const item = grouped.get(key) || { shipmentCode, pendingEventDate, events: [] };
    item.events.push(event); grouped.set(key, item);
  }
  const insert = db.prepare(`INSERT INTO pending_daily_members(businessType,reportDate,snapshotId,shipmentCode,pendingEventDate,rawEventCount,representativeEventTime,representativeReason,representativeRawJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  for (const item of grouped.values()) {
    item.events.sort((a, b) => eventTime(a).localeCompare(eventTime(b)));
    const latest = item.events.at(-1) || {};
    insert.run(businessType, reportDate, snapshotId, item.shipmentCode, item.pendingEventDate, item.events.length, eventTime(latest), pendingReason(latest), JSON.stringify(latest), createdAt);
  }
}

function normalizeDateTime(value) {
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(value) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    return `${value.replace(' ', 'T')}+07:00`;
  }
  return value;
}

function eventTime(event) {
  return String(event?.eventTime || event?.creationDate || event?.lastUpdateDate || '');
}

function dayDiff(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function pendingReason(event = {}) {
  return String(event.trackingEventDescZh || event.trackingEventDesc || event.remark || event.eventCode || '').trim();
}

function looksPending(event = {}) {
  const code = String(event.eventCode || event.trackingEventCode || '');
  const text = [event.trackingEventDescZh, event.trackingEventDesc, event.remark, event.rawJson].map(value => String(value || '')).join(' ');
  return code === '150' || /pending|派送失败|无法联系|无人接听|地址错误|改派/i.test(text);
}
