(function installWhppCardDedupV69(global) {
  if (global.__CE_QC_V69_WHPP_CARD_DEDUP__) return;

  const VERSION = '2026-08-12-v69-whpp-card-dedup-v2';
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

  function setDataset(node, key, value) {
    if (!node?.dataset || node.dataset[key] === value) return;
    node.dataset[key] = value;
  }

  function normalizeGrid() {
    const grid = document.querySelector('#unifiedClassificationSummary .unified-count-grid');
    if (!grid) return false;

    const candidates = [...grid.querySelectorAll(':scope > div, :scope > button')].filter(isWhppCard);
    if (!candidates.length) return false;

    const canonical = candidates.find(node => node.dataset?.v68Business === 'WHPP')
      || candidates.find(node => node.dataset?.v64Business === 'WHPP')
      || candidates.find(node => node.dataset?.v54Business === 'WHPP')
      || candidates[0];

    const maxValue = Math.max(...candidates.map(cardValue), 0);
    let changed = false;

    for (const key of ['v54Business', 'v64Business', 'v68Business']) {
      if (canonical.dataset?.[key] !== 'WHPP') {
        setDataset(canonical, key, 'WHPP');
        changed = true;
      }
    }

    let span = canonical.querySelector('span');
    if (!span) {
      span = document.createElement('span');
      canonical.prepend(span);
      changed = true;
    }
    if (span.textContent !== 'WHPP本土') {
      span.textContent = 'WHPP本土';
      changed = true;
    }

    let value = canonical.querySelector('b');
    if (!value) {
      value = document.createElement('b');
      canonical.appendChild(value);
      changed = true;
    }
    if (value.dataset?.testid !== 'classification-whpp') {
      value.dataset.testid = 'classification-whpp';
      changed = true;
    }
    if (maxValue > 0 || candidates.length > 1) {
      const desired = maxValue.toLocaleString('zh-CN');
      if (value.textContent !== desired) {
        value.textContent = desired;
        changed = true;
      }
    }

    for (const node of candidates) {
      if (node !== canonical) {
        node.remove();
        changed = true;
      }
    }

    return changed;
  }

  function nodeTouchesSummary(node) {
    if (!node || node.nodeType !== 1) return false;
    return Boolean(
      node.matches?.('#unifiedClassificationSummary, #unifiedClassificationSummary *')
      || node.querySelector?.('#unifiedClassificationSummary')
    );
  }

  function mutationTouchesSummary(records) {
    return records.some(record => {
      if (nodeTouchesSummary(record.target)) return true;
      return [...record.addedNodes, ...record.removedNodes].some(nodeTouchesSummary);
    });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      normalizeGrid();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function install() {
    normalizeGrid();
    const observer = new MutationObserver(records => {
      if (mutationTouchesSummary(records)) schedule();
    });
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
