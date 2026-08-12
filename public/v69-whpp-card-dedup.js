(function installWhppCardDedupV69(global) {
  if (global.__CE_QC_V69_WHPP_CARD_DEDUP__) return;

  const VERSION = '2026-08-12-v69-whpp-card-dedup-v3';
  let scheduled = false;
  let summaryObserver = null;

  function labelOf(node) {
    return String(node?.querySelector?.('span')?.textContent || '').trim();
  }

  function isWhppCard(node) {
    if (!node || node.nodeType !== 1) return false;
    return labelOf(node) === 'WHPP本土'
      || node.dataset?.v54Business === 'WHPP'
      || node.dataset?.v64Business === 'WHPP'
      || node.dataset?.v68Business === 'WHPP';
  }

  function cardValue(node) {
    const text = String(node?.querySelector?.('b')?.textContent || '').replace(/[,\s]/g, '');
    const value = Number(text);
    return Number.isFinite(value) ? value : 0;
  }

  function normalizeGrid() {
    const grid = document.querySelector('#unifiedClassificationSummary .unified-count-grid');
    if (!grid) return false;
    const candidates = [...grid.children].filter(isWhppCard);
    if (!candidates.length) return false;

    const canonical = candidates.find(node => node.dataset?.v68Business === 'WHPP')
      || candidates.find(node => node.dataset?.v64Business === 'WHPP')
      || candidates[0];
    const maxValue = Math.max(...candidates.map(cardValue), 0);
    let changed = false;

    for (const key of ['v64Business', 'v68Business']) {
      if (canonical.dataset?.[key] !== 'WHPP') {
        canonical.dataset[key] = 'WHPP';
        changed = true;
      }
    }
    let span = canonical.querySelector('span');
    if (!span) { span = document.createElement('span'); canonical.prepend(span); changed = true; }
    if (span.textContent !== 'WHPP本土') { span.textContent = 'WHPP本土'; changed = true; }
    let value = canonical.querySelector('b');
    if (!value) { value = document.createElement('b'); canonical.appendChild(value); changed = true; }
    if (value.dataset?.testid !== 'classification-whpp') { value.dataset.testid = 'classification-whpp'; changed = true; }
    const desired = maxValue.toLocaleString('zh-CN');
    if ((maxValue > 0 || candidates.length > 1) && value.textContent !== desired) { value.textContent = desired; changed = true; }
    for (const node of candidates) {
      if (node !== canonical) { node.remove(); changed = true; }
    }
    return changed;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    const run = () => { scheduled = false; normalizeGrid(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function attachSummaryObserver() {
    if (summaryObserver) return true;
    const root = document.getElementById('unifiedClassificationSummary');
    if (!root) return false;
    summaryObserver = new MutationObserver(() => schedule());
    summaryObserver.observe(root, { childList: true, subtree: true, characterData: true });
    return true;
  }

  function install() {
    normalizeGrid();
    if (!attachSummaryObserver()) {
      const finder = new MutationObserver(() => {
        if (!attachSummaryObserver()) return;
        finder.disconnect();
        schedule();
      });
      finder.observe(document.body, { childList: true, subtree: true });
    }
    document.addEventListener('click', event => {
      if (event.target?.closest?.('[data-page="import"],[data-testid="global-auto-process"]')) setTimeout(schedule, 0);
    }, true);
    console.info('[CE-QC][V69_WHPP_CARD_DEDUP]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  global.__CE_QC_V69_WHPP_CARD_DEDUP__ = { version: VERSION, normalize: normalizeGrid };
})(window);
