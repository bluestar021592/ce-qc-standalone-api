(function installWhppClassificationStabilityV68(global) {
  if (global.__CE_QC_V68_WHPP_CLASSIFICATION_STABILITY__) return;

  const VERSION = '2026-08-15-v140-whpp-canonical-classification-v5';
  let scheduled = false;

  const BUSINESS_KEYS = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN','WHPP'];
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

  function sourceTruthCounts() {
    const state = importState();
    const canonical = global.__CE_QC_CANONICAL_CLASSIFICATION__;
    if (canonical?.counts && (!state?.reportDate || canonical.reportDate === state.reportDate)) return canonical.counts;
    const counts = state?.classificationCounts;
    if (counts && typeof counts === 'object' && BUSINESS_KEYS.some(key => Object.prototype.hasOwnProperty.call(counts, key))) return counts;
    return null;
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

  function deriveTruth() {
    const stats = rawStats();
    const rawUnique = Math.max(0, stats.rawRows - stats.duplicateRows - stats.missingWaybillRows);
    const counts = sourceTruthCounts();
    if (counts) {
      const core = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'].reduce((sum, key) => sum + num(counts[key]), 0);
      const whppTotal = num(counts.WHPP);
      const fullUnique = BUSINESS_KEYS.reduce((sum, key) => sum + num(counts[key]), 0);
      return { rawUnique, core, whppTotal, fullUnique: fullUnique || rawUnique, source: 'CANONICAL_COUNTS' };
    }
    const core = ['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'].reduce((sum, label) => sum + readCardCount(label), 0);
    const whppTotal = readCardCount('WHPP本土');
    return { rawUnique, core, whppTotal, fullUnique: rawUnique || core + whppTotal, source: 'RENDERED_COUNTS_NO_GUESS' };
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
    document.documentElement.dataset.v68ClassificationSource = truth.source;
    return true;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      normalize();
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

    global.addEventListener('ce-qc-canonical-classification-ready', schedule);
    normalize();
    schedule();
    console.info('[CE-QC][V140_WHPP_CLASSIFICATION_STABILITY]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  global.__CE_QC_V68_WHPP_CLASSIFICATION_STABILITY__ = {
    version: VERSION,
    refresh: normalize
  };
})(window);
