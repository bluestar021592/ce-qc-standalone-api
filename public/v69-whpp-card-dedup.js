(function installWhppCardDedupV69(global) {
  if (global.__CE_QC_V69_WHPP_CARD_DEDUP__) return;

  const VERSION = '2026-08-12-v69-whpp-card-dedup-v1';
  let scheduled = false;

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
    if (!grid) return;

    const candidates = [...grid.querySelectorAll(':scope > div, :scope > button')].filter(isWhppCard);
    if (!candidates.length) return;

    const canonical = candidates.find(node => node.dataset?.v68Business === 'WHPP')
      || candidates.find(node => node.dataset?.v64Business === 'WHPP')
      || candidates.find(node => node.dataset?.v54Business === 'WHPP')
      || candidates[0];

    const maxValue = Math.max(...candidates.map(cardValue), 0);
    canonical.dataset.v54Business = 'WHPP';
    canonical.dataset.v64Business = 'WHPP';
    canonical.dataset.v68Business = 'WHPP';

    let span = canonical.querySelector('span');
    if (!span) {
      span = document.createElement('span');
      canonical.prepend(span);
    }
    span.textContent = 'WHPP本土';

    let value = canonical.querySelector('b');
    if (!value) {
      value = document.createElement('b');
      canonical.appendChild(value);
    }
    value.dataset.testid = 'classification-whpp';
    if (maxValue > 0 || candidates.length > 1) value.textContent = maxValue.toLocaleString('zh-CN');

    candidates.forEach(node => {
      if (node !== canonical) node.remove();
    });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      normalizeGrid();
    });
  }

  function install() {
    normalizeGrid();
    const observer = new MutationObserver(schedule);
    observer.observe(document.querySelector('.app-shell') || document.body, { childList: true, subtree: true });
    document.addEventListener('click', event => {
      if (event.target?.closest?.('[data-page="import"],#topRangeQuery,[data-testid="global-auto-process"]')) {
        setTimeout(normalizeGrid, 0);
        setTimeout(normalizeGrid, 120);
        setTimeout(normalizeGrid, 500);
      }
    }, true);
    console.info('[CE-QC][V69_WHPP_CARD_DEDUP]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  global.__CE_QC_V69_WHPP_CARD_DEDUP__ = { version: VERSION, normalize: normalizeGrid };
})(window);
