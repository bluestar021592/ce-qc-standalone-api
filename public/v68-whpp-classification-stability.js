(function installWhppClassificationStabilityV68(global) {
  if (global.__CE_QC_V68_WHPP_CLASSIFICATION_STABILITY__) return;

  const VERSION = '2026-08-12-v68-whpp-classification-stability-v2';
  const CACHE_KEY = 'ce_qc_v68_whpp_classification_truth';
  let busy = false;
  let timer = null;

  const num = value => {
    const parsed = Number(String(value ?? '').replace(/[,\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const fmt = value => Number(value || 0).toLocaleString('zh-CN');

  async function json(url) {
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || payload.ok === false) throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    return payload;
  }

  function readCache(reportDate) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      return cached.reportDate === reportDate ? cached : null;
    } catch {
      return null;
    }
  }

  function saveCache(value) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch {}
  }

  function grid() {
    return document.querySelector('#unifiedClassificationSummary .unified-count-grid');
  }

  function readCardCount(label) {
    const target = grid();
    if (!target) return 0;
    const card = [...target.children].find(node => String(node.querySelector('span')?.textContent || '').trim() === label);
    return num(card?.querySelector('b')?.textContent);
  }

  function currentReportDate(imported = {}) {
    return String(imported?.reportDate || document.getElementById('reportDate')?.value || '').trim();
  }

  function domRawStats() {
    const summary = document.getElementById('unifiedClassificationSummary');
    const text = String(summary?.textContent || '');
    const pick = label => {
      const match = text.match(new RegExp(`${label}\\s*([\\d,]+)`));
      return match ? num(match[1]) : 0;
    };
    return {
      rawRows: pick('原始行'),
      duplicateRows: pick('重复'),
      missingWaybillRows: pick('无单号'),
      classificationConflicts: pick('分类冲突') || pick('真正分类冲突')
    };
  }

  function coreCount(imported = {}) {
    const counts = imported?.classificationCounts || {};
    const labels = [
      ['CE', 'CE'], ['CEAF', 'CEAF'], ['TBKH', 'TBKH'], ['ALI1688', 'ALI1688'],
      ['SHOPEECN', 'SHOPEECN'], ['SHOPEEVN', 'SHOPEEVN']
    ];
    return labels.reduce((sum, [key, label]) => {
      const source = counts[key];
      return sum + (source === undefined || source === null ? readCardCount(label) : num(source));
    }, 0);
  }

  function deriveTruth(imported = {}, whppPayload = null) {
    const reportDate = currentReportDate(imported);
    const summary = imported?.summary || domRawStats();
    const rawRows = num(summary.rawRows);
    const duplicateRows = num(summary.duplicateRows);
    const missingWaybillRows = num(summary.missingWaybillRows);
    const conflicts = num(summary.classificationConflicts);
    const rawUnique = Math.max(0, rawRows - duplicateRows - missingWaybillRows);
    const core = coreCount(imported);

    const persistedRaw = imported?.classificationCounts?.WHPP;
    const persisted = persistedRaw === undefined || persistedRaw === null ? null : num(persistedRaw);
    const whppState = whppPayload?.state || {};
    const whppDate = String(whppState.reportDate || whppPayload?.reportDate || '').trim();
    const whppMatches = Boolean(reportDate && whppDate && reportDate === whppDate);
    const liveRaw = whppMatches
      ? (whppPayload?.dashboard?.metrics?.total ?? whppState?.pnhBills?.length)
      : null;
    const live = liveRaw === undefined || liveRaw === null ? null : num(liveRaw);
    const cached = readCache(reportDate);

    let whppTotal = live;
    let source = live !== null ? 'live' : '';
    if (whppTotal === null && persisted !== null) { whppTotal = persisted; source = 'persisted'; }
    if (whppTotal === null && cached && Number.isFinite(Number(cached.whppTotal))) { whppTotal = num(cached.whppTotal); source = 'cache'; }
    if (whppTotal === null && rawUnique >= core && conflicts === 0) {
      whppTotal = Math.max(0, rawUnique - core);
      source = 'derived';
    }
    if (whppTotal === null) whppTotal = 0;

    const fullUnique = rawUnique > 0 ? rawUnique : core + whppTotal;
    return { reportDate, whppTotal, fullUnique, core, rawUnique, source };
  }

  function isWhppCard(node) {
    if (!node) return false;
    const label = String(node.querySelector('span')?.textContent || '').trim();
    return label === 'WHPP本土'
      || node.dataset?.v54Business === 'WHPP'
      || node.dataset?.v64Business === 'WHPP'
      || node.dataset?.v68Business === 'WHPP';
  }

  function ensureWhppCard(target) {
    const cards = [...target.children].filter(isWhppCard);
    let card = cards[0] || null;
    if (!card) {
      card = document.createElement('div');
      card.innerHTML = '<span>WHPP本土</span><b data-testid="classification-whpp">0</b>';
      target.appendChild(card);
    }
    card.dataset.v64Business = 'WHPP';
    card.dataset.v68Business = 'WHPP';
    const label = card.querySelector('span');
    if (label && String(label.textContent || '').trim() !== 'WHPP本土') label.textContent = 'WHPP本土';
    let value = card.querySelector('b');
    if (!value) {
      value = document.createElement('b');
      card.appendChild(value);
    }
    value.dataset.testid = 'classification-whpp';
    cards.slice(1).forEach(extra => extra.remove());
    return card;
  }

  function patchStatus(truth) {
    const status = document.getElementById('fileStatus');
    if (!status) return;
    status.querySelectorAll('p').forEach(p => {
      if (/有效唯一单号/.test(p.textContent || '')) {
        p.innerHTML = p.innerHTML.replace(/有效唯一单号\s*[\d,]+/, `有效唯一单号 ${fmt(truth.fullUnique)}`);
      }
    });
  }

  function patchGrid(truth) {
    const target = grid();
    if (!target) return;
    const whpp = ensureWhppCard(target);
    const whppValue = whpp.querySelector('b');
    if (whppValue) whppValue.textContent = fmt(truth.whppTotal);
    const valid = target.querySelector('[data-testid="classification-valid-unique"]');
    if (valid) valid.textContent = fmt(truth.fullUnique);
    patchStatus(truth);
    if (truth.reportDate && (truth.source === 'live' || truth.source === 'persisted' || truth.source === 'derived')) {
      saveCache({ reportDate: truth.reportDate, whppTotal: truth.whppTotal, fullUnique: truth.fullUnique, savedAt: Date.now() });
    }
  }

  async function refreshTruth() {
    if (busy || !grid()) return;
    busy = true;
    try {
      let imported = null;
      let whpp = null;
      const results = await Promise.allSettled([
        json('/api/import/unified-latest?compact=1'),
        json('/api/v51/whpp-state')
      ]);
      if (results[0].status === 'fulfilled') imported = results[0].value?.import || results[0].value || null;
      if (results[1].status === 'fulfilled') whpp = results[1].value;
      patchGrid(deriveTruth(imported || {}, whpp));
    } catch (error) {
      console.warn('[CE-QC][V68_WHPP_CLASSIFICATION] refresh skipped', error);
      patchGrid(deriveTruth({}, null));
    } finally {
      busy = false;
    }
  }

  function schedule(delay = 60) {
    clearTimeout(timer);
    timer = setTimeout(() => void refreshTruth(), delay);
  }

  function install() {
    const original = global.renderUnifiedImportResult;
    if (typeof original === 'function' && !original.__v68WhppWrapped) {
      const wrapped = function () {
        const result = original.apply(this, arguments);
        schedule(0);
        return result;
      };
      wrapped.__v68WhppWrapped = true;
      global.renderUnifiedImportResult = wrapped;
    }

    const observer = new MutationObserver(() => schedule(80));
    observer.observe(document.querySelector('.app-shell') || document.body, { childList: true, subtree: true });
    document.addEventListener('click', event => {
      if (event.target?.closest?.('[data-page="import"],#topRangeQuery,[data-testid="global-auto-process"]')) schedule(120);
    }, true);
    schedule(0);
    console.info('[CE-QC][V68_WHPP_CLASSIFICATION_STABILITY]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  global.__CE_QC_V68_WHPP_CLASSIFICATION_STABILITY__ = {
    version: VERSION,
    refresh: refreshTruth
  };
})(window);
