(function installWhppClassificationStabilityV68(global) {
  if (global.__CE_QC_V68_WHPP_CLASSIFICATION_STABILITY__) return;

  const VERSION = '2026-09-04-v426-unified-import-seven-business-truth-priority-v1';
  const TYPES = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
  const CORE_TYPES = TYPES.filter(type => type !== 'WHPP');
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
    return CORE_TYPES.reduce((sum, label) => sum + readCardCount(label), 0);
  }

  function authoritativeImportTruth(state = importState()) {
    const counts = state?.classificationCounts || null;
    const reconciliation = state?.sourceReconciliation || null;
    if (!counts || !reconciliation || reconciliation.balanced !== true) return null;
    if (!TYPES.every(type => Object.prototype.hasOwnProperty.call(counts, type))) return null;
    const declaredTypes = new Set((Array.isArray(reconciliation.businessTypes) ? reconciliation.businessTypes : []).map(type => String(type || '').toUpperCase()));
    if (!TYPES.every(type => declaredTypes.has(type))) return null;
    const normalized = Object.fromEntries(TYPES.map(type => [type, Math.max(0, num(counts[type]))]));
    const total = TYPES.reduce((sum, type) => sum + normalized[type], 0);
    if (num(reconciliation.validUniqueWaybills) !== total || num(reconciliation.classifiedWaybills) !== total) return null;
    return {
      counts: normalized,
      core: CORE_TYPES.reduce((sum, type) => sum + normalized[type], 0),
      whppTotal: normalized.WHPP,
      fullUnique: total,
      reportDate: String(state?.reportDate || '').slice(0, 10),
      source: 'UNIFIED_IMPORT_SEVEN_BUSINESS_RECONCILIATION'
    };
  }

  function deriveTruth() {
    const stateTruth = authoritativeImportTruth();
    if (stateTruth) return { ...stateTruth, rawUnique: stateTruth.fullUnique, explicit: true, authoritativeImport: true };

    const stats = rawStats();
    const rawUnique = Math.max(0, stats.rawRows - stats.duplicateRows - stats.missingWaybillRows);
    const state = importState();
    const counts = state?.classificationCounts || {};
    const hasExplicitWhpp = Object.prototype.hasOwnProperty.call(counts, 'WHPP');
    const coreFromState = CORE_TYPES.every(type => Object.prototype.hasOwnProperty.call(counts, type))
      ? CORE_TYPES.reduce((sum, type) => sum + Math.max(0, num(counts[type])), 0)
      : 0;
    const core = coreFromState || coreCountFromCards();

    // Legacy compatibility only. New unified imports are protected above by the
    // seven-business source reconciliation and can never be replaced by a later
    // WHPP summary read.
    if (hasExplicitWhpp) {
      const whppTotal = Math.max(0, num(counts.WHPP));
      return { rawUnique, core, whppTotal, fullUnique: core + whppTotal, explicit: true, authoritativeImport: false };
    }

    const whppTotal = rawUnique >= core ? Math.max(0, rawUnique - core) : 0;
    const fullUnique = rawUnique > 0 ? rawUnique : core + whppTotal;
    return { rawUnique, core, whppTotal, fullUnique, explicit: false, authoritativeImport: false };
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
    const total = fmt(truth.fullUnique);
    const walker = document.createTreeWalker(status, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const before = String(node.nodeValue || '');
      const next = before
        .replace(/有效唯一单号\s*[\d,]+/g, `有效唯一单号 ${total}`)
        .replace(/日报导入完成，\s*共\s*[\d,]+\s*个唯一运单/g, `日报导入完成，共 ${total} 个唯一运单`)
        .replace(/导入成功：\s*有效\s*[\d,]+\s*票/g, `导入成功：有效 ${total} 票`);
      if (next !== before) node.nodeValue = next;
    }
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
    document.documentElement.dataset.v68ImportTruth = truth.authoritativeImport ? 'authoritative-seven-business' : 'legacy-compat';
    return true;
  }

  async function syncFastWhppTruth(force = false) {
    const date = currentDate();
    if (!date || fastSyncing) return null;

    const before = importState();
    const protectedTruth = authoritativeImportTruth(before);
    if (protectedTruth && protectedTruth.reportDate === date) {
      before.whppClassificationDisplaySource = 'V426_UNIFIED_IMPORT_SEVEN_BUSINESS_TRUTH';
      normalize();
      return { skipped: true, reason: 'AUTHORITATIVE_UNIFIED_IMPORT_TRUTH', total: protectedTruth.fullUnique, whppTotal: protectedTruth.whppTotal };
    }

    if (!force && Date.now() - lastFastSyncAt < 5000) return null;
    fastSyncing = true;
    lastFastSyncAt = Date.now();
    try {
      const response = await fetch(`/api/v132/whpp-fast-summary?reportDate=${encodeURIComponent(date)}`, {
        cache: 'no-store', credentials: 'same-origin'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false || String(payload?.reportDate || '') !== date) return null;
      const state = importState();
      if (!state || String(state.reportDate || '').slice(0, 10) !== date) return null;

      // The import may have completed while this legacy request was in flight.
      // Re-check before writing so stale WHPP summaries can never overwrite a
      // newly committed seven-business reconciliation.
      const nowProtected = authoritativeImportTruth(state);
      if (nowProtected) {
        state.whppClassificationDisplaySource = 'V426_UNIFIED_IMPORT_SEVEN_BUSINESS_TRUTH';
        normalize();
        return { skipped: true, reason: 'AUTHORITATIVE_IMPORT_BECAME_READY', total: nowProtected.fullUnique, whppTotal: nowProtected.whppTotal };
      }

      const total = Math.max(0, num(payload?.total ?? payload?.metrics?.total));
      state.classificationCounts = { ...(state.classificationCounts || {}), WHPP: total };
      const core = CORE_TYPES.reduce((sum, type) => sum + num(state.classificationCounts?.[type]), 0);
      state.summary = { ...(state.summary || {}), validUniqueWaybills: core + total, totalUnique: core + total };
      state.whppClassificationDisplaySource = 'V426_LEGACY_WHPP_FAST_SUMMARY_COMPAT';
      normalize();
      return { skipped: false, source: 'LEGACY_WHPP_FAST_SUMMARY', total: core + total, whppTotal: total };
    } catch (error) {
      console.warn('[CE-QC][V426_WHPP_CLASSIFICATION] legacy fast WHPP sync skipped', error?.message || error);
      return null;
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
    console.info('[CE-QC][V68_WHPP_CLASSIFICATION_STABILITY]', VERSION, 'balanced seven-business unified import truth is authoritative; WHPP fast-summary is legacy fallback only.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  global.__CE_QC_V68_WHPP_CLASSIFICATION_STABILITY__ = {
    version: VERSION,
    refresh: normalize,
    sync: syncFastWhppTruth,
    deriveTruth,
    authoritativeImportTruth
  };
})(window);
