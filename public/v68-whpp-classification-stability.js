(function installWhppClassificationStabilityV68(global) {
  if (global.__CE_QC_V68_WHPP_CLASSIFICATION_STABILITY__) return;

  const VERSION = '2026-08-22-v217-whpp-classification-display-truth-v1';
  let scheduled = false;
  let fastSyncing = false;
  let lastFastSyncAt = 0;

  const num = value => {
    const parsed = Number(String(value ?? '').replace(/[,\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const fmt = value => Number(value || 0).toLocaleString('zh-CN');

  function importState() {
    try {
      if (typeof unifiedImportState !== 'undefined') return unifiedImportState;
    } catch {}
    return global.unifiedImportState || null;
  }

  function summaryRoot() {
    return document.getElementById('unifiedClassificationSummary');
  }

  function grid() {
    return summaryRoot()?.querySelector('.unified-count-grid') || null;
  }

  function cardByLabel(label) {
    const target = grid();
    if (!target) return null;
    return [...target.children].find(node => String(node.querySelector('span')?.textContent || '').trim() === label) || null;
  }

  function readCardCount(label) {
    return num(cardByLabel(label)?.querySelector('b')?.textContent);
  }

  function rawStats() {
    const text = String(summaryRoot()?.textContent || '');
    const pick = label => {
      const match = text.match(new RegExp(`${label}\\s*([\\d,]+)`));
      return match ? num(match[1]) : 0;
    };
    return {
      rawRows: pick('原始行'),
      duplicateRows: pick('重复'),
      missingWaybillRows: pick('无单号')
    };
  }

  function currentDate() {
    const state = importState();
    const value = String(
      state?.reportDate
      || document.getElementById('topRangeTo')?.value
      || document.getElementById('dashboardRangeTo')?.value
      || ''
    ).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
  }

  function coreCountFromCards() {
    return ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN']
      .reduce((sum, label) => sum + readCardCount(label), 0);
  }

  function deriveTruth() {
    const stats = rawStats();
    const rawUnique = Math.max(0, stats.rawRows - stats.duplicateRows - stats.missingWaybillRows);
    const core = coreCountFromCards();
    const state = importState();
    const counts = state?.classificationCounts || {};
    const hasExplicitWhpp = Object.prototype.hasOwnProperty.call(counts, 'WHPP');

    // V94/V216 already synchronize the canonical WHPP count into the runtime
    // import state. Prefer that explicit value. The legacy V68 heuristic used
    // rawRows-core, but fast bootstrap intentionally does not hydrate rawRows,
    // so it incorrectly overwrote a real WHPP count with zero.
    if (hasExplicitWhpp) {
      const whppTotal = Math.max(0, num(counts.WHPP));
      return { rawUnique, core, whppTotal, fullUnique: core + whppTotal, explicit: true };
    }

    const whppTotal = rawUnique >= core ? Math.max(0, rawUnique - core) : 0;
    const fullUnique = rawUnique > 0 ? rawUnique : core + whppTotal;
    return { rawUnique, core, whppTotal, fullUnique, explicit: false };
  }

  function isWhppCard(node) {
    if (!node || node.nodeType !== 1) return false;
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
      if (!/有效唯一单号/.test(p.textContent || '')) return;
      const next = p.innerHTML.replace(/有效唯一单号\s*[\d,]+/, `有效唯一单号 ${fmt(truth.fullUnique)}`);
      if (next !== p.innerHTML) p.innerHTML = next;
    });
  }

  function normalize() {
    const target = grid();
    if (!target) return false;
    const truth = deriveTruth();
    const whpp = ensureWhppCard(target);
    const whppValue = whpp.querySelector('b');
    const whppText = fmt(truth.whppTotal);
    if (whppValue && whppValue.textContent !== whppText) whppValue.textContent = whppText;
    const valid = target.querySelector('[data-testid="classification-valid-unique"]');
    const fullText = fmt(truth.fullUnique);
    if (valid && valid.textContent !== fullText) valid.textContent = fullText;
    patchStatus(truth);
    document.documentElement.dataset.v68WhppTotal = String(truth.whppTotal);
    document.documentElement.dataset.v68UnifiedTotal = String(truth.fullUnique);
    return true;
  }

  async function syncFastWhppTruth(force = false) {
    const date = currentDate();
    if (!date || fastSyncing) return;
    if (!force && Date.now() - lastFastSyncAt < 5000) return;
    fastSyncing = true;
    lastFastSyncAt = Date.now();
    try {
      const response = await fetch(`/api/v132/whpp-fast-summary?reportDate=${encodeURIComponent(date)}`, {
        cache: 'no-store', credentials: 'same-origin'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false || String(payload?.reportDate || '') !== date) return;
      const state = importState();
      if (!state || String(state.reportDate || '').slice(0, 10) !== date) return;
      const total = Math.max(0, num(payload?.total ?? payload?.metrics?.total));
      state.classificationCounts = { ...(state.classificationCounts || {}), WHPP: total };
      const core = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN']
        .reduce((sum, type) => sum + num(state.classificationCounts?.[type]), 0);
      state.summary = { ...(state.summary || {}), validUniqueWaybills: core + total, totalUnique: core + total };
      state.whppClassificationDisplaySource = 'V217_WHPP_FAST_SUMMARY';
      normalize();
    } catch (error) {
      console.warn('[CE-QC][V217_WHPP_CLASSIFICATION] fast WHPP sync skipped', error?.message || error);
    } finally {
      fastSyncing = false;
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      normalize();
      void syncFastWhppTruth(false);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  function install() {
    const original = global.renderUnifiedImportResult;
    if (typeof original === 'function' && !original.__v68WhppWrapped) {
      const wrapped = function () {
        const result = original.apply(this, arguments);
        normalize();
        schedule();
        void syncFastWhppTruth(true);
        return result;
      };
      wrapped.__v68WhppWrapped = true;
      global.renderUnifiedImportResult = wrapped;
    }

    const observer = new MutationObserver(records => {
      if (records.some(record => record.target === summaryRoot() || record.target?.closest?.('#unifiedClassificationSummary'))) schedule();
    });
    const root = summaryRoot();
    if (root) observer.observe(root, { childList: true, subtree: true, characterData: true });
    else {
      const pageObserver = new MutationObserver(() => {
        const next = summaryRoot();
        if (!next) return;
        pageObserver.disconnect();
        observer.observe(next, { childList: true, subtree: true, characterData: true });
        schedule();
      });
      pageObserver.observe(document.body, { childList: true, subtree: true });
    }

    document.addEventListener('click', event => {
      if (event.target?.closest?.('[data-page="import"],#topRangeQuery,#dashboardRangeQuery')) {
        setTimeout(() => void syncFastWhppTruth(true), 80);
      }
    }, true);

    normalize();
    schedule();
    void syncFastWhppTruth(true);
    console.info('[CE-QC][V68_WHPP_CLASSIFICATION_STABILITY]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  global.__CE_QC_V68_WHPP_CLASSIFICATION_STABILITY__ = {
    version: VERSION,
    refresh: normalize,
    sync: syncFastWhppTruth
  };
})(window);
