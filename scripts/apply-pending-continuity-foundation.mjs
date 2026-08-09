import fs from 'node:fs';

function patchFile(file, patches) {
  let source = fs.readFileSync(file, 'utf8');
  for (const { before, after, label } of patches) {
    if (source.includes(after)) continue;
    const count = source.split(before).length - 1;
    if (count !== 1) throw new Error(`${file} ${label}: expected exactly one match, got ${count}`);
    source = source.replace(before, after);
  }
  fs.writeFileSync(file, source, 'utf8');
}

patchFile('src/shopeeAnalyzerV30.js', [{
  label: 'latest track terminal only',
  before: `function latestExactTerminal(events) {
  let found = null;
  for (const event of events) {
    const code = trackCode(event);
    if (code === TRACK.POD) found = { type: 'POD', event };
    if (code === TRACK.RETURN_COMPLETE) found = { type: 'RETURN_COMPLETED', event };
  }
  return found;
}`,
  after: `function latestExactTerminal(events = []) {
  const event = events.at(-1) || null;
  const code = trackCode(event || {});
  if (code === TRACK.POD) return { type: 'POD', event };
  if (code === TRACK.RETURN_COMPLETE) return { type: 'RETURN_COMPLETED', event };
  return null;
}`
}]);

patchFile('src/analyzerV30.js', [
  {
    label: 'independent pending non-continuity fact',
    before: `  const terminal = isPod || isReturned;
  const currentPendingDays = !terminal && !returnInProgress && !special && !storeFlow.shopState && lastCode === TRACK.PENDING ? pending.days : 0;`,
    after: `  const terminal = isPod || isReturned;
  const pendingNonContinuous = !terminal
    && !returnInProgress
    && !special
    && !storeFlow.shopState
    && facts.pendingDistinctDayCount >= 2
    && !facts.pendingDateContinuity;
  const currentPendingDays = !terminal && !returnInProgress && !special && !storeFlow.shopState && lastCode === TRACK.PENDING ? pending.days : 0;`
  },
  {
    label: 'persist pending continuity facts',
    before: `    pendingRawEventCount: facts.pendingRawEventCount,
    pendingFactDateContinuity: facts.pendingDateContinuity ? '连续' : '不连续',`,
    after: `    pendingRawEventCount: facts.pendingRawEventCount,
    pendingFactDateContinuity: facts.pendingContinuityLabel,
    Pending事实连续性: facts.pendingContinuityLabel,
    currentPendingDistinctDayCount: facts.currentPendingDistinctDayCount,
    currentPendingDates: facts.currentPendingDates,
    currentPendingFactContinuity: facts.currentPendingContinuityLabel,
    Pending不连续: pendingNonContinuous ? '是' : '否',`
  }
]);

patchFile('src/reporting.js', [
  {
    label: 'category pending non-continuity helper',
    before: `    pendingNonContinuous: ordinaryRows.filter(row => countOf(row, 'Pending次数', 'Pending天数') >= 2 && row?.Pending连续性 === '不连续').length,`,
    after: `    pendingNonContinuous: ordinaryRows.filter(isPendingNonContinuousRow).length,`
  },
  {
    label: 'detail pending non-continuity helper',
    before: `    pendingNonContinuous: ordinaryRows.filter(row => countOf(row, 'Pending次数', 'Pending天数') >= 2 && row?.Pending连续性 === '不连续'),`,
    after: `    pendingNonContinuous: ordinaryRows.filter(isPendingNonContinuousRow),`
  },
  {
    label: 'pending non-continuity helper function',
    before: `function isRefreshFailedRow(row = {}) {`,
    after: `function isPendingNonContinuousRow(row = {}) {
  if (row?.Pending不连续 === '是') return true;
  if (row?.pendingFactDateContinuity === '不连续' || row?.Pending事实连续性 === '不连续') return true;
  return Number(row?.pendingDistinctDayCount || 0) >= 2 && row?.Pending连续性 === '不连续';
}

function isRefreshFailedRow(row = {}) {`
  }
]);

const ccslOld = `      SUM(CASE WHEN COALESCE(json_extract(f.rawJson,'$."Pending连续性"'),'')='不连续' THEN 1 ELSE 0 END) AS pendingNonContinuous,`;
const ccslNew = `      SUM(CASE WHEN COALESCE(f.isPod,0)=0
                AND COALESCE(f.shopState,'')=''
                AND UPPER(COALESCE(json_extract(f.rawJson,'$.currentState'),'')) NOT IN ('POD','RETURNED','RETURN_COMPLETED','RETURN_IN_PROGRESS','SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION')
                AND UPPER(COALESCE(f.primaryCategory,'')) NOT IN ('SELF_PICKUP','CECN_RETENTION','CEZT_RETENTION','CCSL580_RETENTION')
                AND COALESCE(f.primaryCategory,'') NOT IN ('退回','退回处理中','仓库自提','自提','CECN滞留包裹','CEZT滞留包裹','580滞留包裹')
                AND (
                  COALESCE(json_extract(f.rawJson,'$."Pending不连续"'),'')='是'
                  OR COALESCE(json_extract(f.rawJson,'$.pendingFactDateContinuity'),'')='不连续'
                  OR COALESCE(json_extract(f.rawJson,'$."Pending事实连续性"'),'')='不连续'
                  OR COALESCE(json_extract(f.rawJson,'$."Pending连续性"'),'')='不连续'
                ) THEN 1 ELSE 0 END) AS pendingNonContinuous,`;

let range = fs.readFileSync('src/rangeDashboardStoreV31.js', 'utf8');
const occurrences = range.split(ccslOld).length - 1;
if (occurrences === 2) {
  range = range.replace(ccslOld, ccslNew).replace(ccslOld, ccslNew);
} else if (!range.includes(ccslNew)) {
  throw new Error(`range dashboard pendingNonContinuous: expected 2 legacy matches, got ${occurrences}`);
}
fs.writeFileSync('src/rangeDashboardStoreV31.js', range, 'utf8');

patchFile('src/rangeDashboardStoreV31.js', [
  {
    label: 'Shopee dashboard row exposes pending non-continuity',
    before: `      ['Pending1+', m.pending1], ['Pending2+', m.pending2], ['Pending3+', m.pending3plus],
      ['OC1+', m.oc1],`,
    after: `      ['Pending1+', m.pending1], ['Pending2+', m.pending2], ['Pending3+', m.pending3plus], ['Pending不连续', m.pendingNonContinuous],
      ['OC1+', m.oc1],`
  },
  {
    label: 'Shopee group detail count exposes pending non-continuity',
    before: `    all: metrics.total, pod: metrics.pod, pending1: metrics.pending1, pending2: metrics.pending2, pending3: metrics.pending3plus,
    oc1: metrics.oc1,`,
    after: `    all: metrics.total, pod: metrics.pod, pending1: metrics.pending1, pending2: metrics.pending2, pending3: metrics.pending3plus, pendingNonContinuous: metrics.pendingNonContinuous,
    oc1: metrics.oc1,`
  },
  {
    label: 'Shopee summary carries pending non-continuity',
    before: `    pending1: sum(rows, 'pending1'), pending2: sum(rows, 'pending2'), pending3plus: sum(rows, 'pending3'),
    oc1: sum(rows, 'oc1'),`,
    after: `    pending1: sum(rows, 'pending1'), pending2: sum(rows, 'pending2'), pending3plus: sum(rows, 'pending3'), pendingNonContinuous: sum(rows, 'pendingNonContinuous'),
    oc1: sum(rows, 'oc1'),`
  },
  {
    label: 'Shopee history carries pending non-continuity',
    before: `      [\`${'${prefix}'}_Pending3+\`]: metrics.pending3plus, [\`${'${prefix}'}_OC1+\`]: metrics.oc1,`,
    after: `      [\`${'${prefix}'}_Pending3+\`]: metrics.pending3plus, [\`${'${prefix}'}_Pending不连续\`]: metrics.pendingNonContinuous, [\`${'${prefix}'}_OC1+\`]: metrics.oc1,`
  },
  {
    label: 'Shopee range tab carries pending non-continuity',
    before: `    tabs[\`${'${group}'}_pending3\`]={label:\`${'${group}'}Pending3+\`,rows:[],total:m.pending3plus}; tabs[\`${'${group}'}_oc1\`]={label:\`${'${group}'}OC1+\`,rows:[],total:m.oc1};`,
    after: `    tabs[\`${'${group}'}_pending3\`]={label:\`${'${group}'}Pending3+\`,rows:[],total:m.pending3plus}; tabs[\`${'${group}'}_pendingNonContinuous\`]={label:\`${'${group}'}Pending不连续\`,rows:[],total:m.pendingNonContinuous}; tabs[\`${'${group}'}_oc1\`]={label:\`${'${group}'}OC1+\`,rows:[],total:m.oc1};`
  },
  {
    label: 'Shopee tab key maps pending non-continuity',
    before: `  return ({ '今日总单':'all','今日POD':'pod','POD率':'pod','首派成功率':'firstAttempt','Pending1+':'pending1','Pending2+':'pending2','Pending3+':'pending3',`,
    after: `  return ({ '今日总单':'all','今日POD':'pod','POD率':'pod','首派成功率':'firstAttempt','Pending1+':'pending1','Pending2+':'pending2','Pending3+':'pending3','Pending不连续':'pendingNonContinuous',`
  }
]);
