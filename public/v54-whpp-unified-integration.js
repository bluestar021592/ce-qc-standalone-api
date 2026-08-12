(function installWhppUnifiedIntegrationV54(global) {
  const VERSION = '2026-08-12-v54-whpp-unified-integration-v6';
  let busy = false;
  let whppSummaryCache = null;
  let whppSummaryAt = 0;
  let unifiedImportCache = null;
  let unifiedImportAt = 0;
  let decorating = false;

  async function readJson(response) {
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || data.message || `HTTP ${response.status}`);
      error.code = data.code || `HTTP_${response.status}`;
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  }

  async function api(url, options = {}) {
    return readJson(await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      ...options
    }));
  }

  function statusNode() { return document.getElementById('ccslRunStatus'); }
  function runButton() { return document.querySelector('[data-testid="global-auto-process"]'); }

  function setStatus(kind, text) {
    const node = statusNode();
    if (node) node.innerHTML = `<span class="status-pill ${kind}">${String(text || '')}</span>`;
  }

  function setBusy(value, text = '') {
    busy = Boolean(value);
    const button = runButton();
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? (text || '正在处理…') : '开始全自动';
  }

  function stateFinished(payload = {}) {
    const state = payload.state || payload;
    const phase = String(state?.processing?.phase || '').trim();
    const error = String(state?.processing?.error || '').trim();
    const retry = Number(state?.lastRunSummary?.refreshFailed || state?.lastRunSummary?.retry || 0);
    return Boolean(state?.reportDate) && phase === '完成' && !error && retry === 0;
  }

  function whppNeedsRun(payload = {}) {
    const state = payload?.state || {};
    const total = Number(payload?.dashboard?.metrics?.total || state?.pnhBills?.length || 0);
    const unresolved = Number(payload?.dashboard?.metrics?.unresolved || 0);
    const status = String(payload?.snapshotStatus || state?.snapshotStatus || '').toUpperCase();
    if (!state?.dailyReportReady || total <= 0) return false;
    return !(status === 'COMPLETED' && unresolved === 0);
  }

  function alreadyComplete(error = {}) {
    const payload = error?.payload || {};
    const text = [
      error?.code,
      error?.message,
      payload?.code,
      payload?.error,
      payload?.message
    ].filter(Boolean).join(' ');
    return /当前任务已经完成|不能继续处理|already\s*(?:completed|finished)|task[_ -]?completed|run[_ -]?completed/i.test(text);
  }

  async function readRunStates() {
    const [ccsl, shopee, whpp] = await Promise.all([
      api('/api/state?compact=1').catch(() => ({})),
      api('/api/shopee/state?compact=1').catch(() => ({})),
      api('/api/v51/whpp-state').catch(() => ({}))
    ]);
    return { ccsl, shopee, whpp };
  }

  async function runStage(label, url) {
    setBusy(true, `正在处理${label}…`);
    setStatus('warning', `正在处理 ${label}，请勿关闭页面；完成后自动进入下一业务。`);
    return api(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
  }

  async function executeUnified(mode = 'start') {
    if (busy) return;
    setBusy(true, '正在检查处理状态…');
    try {
      const states = await readRunStates();
      const stages = [];

      if (!stateFinished(states.ccsl)) stages.push(['CCSL（CE/CEAF/TBKH/ALI1688）', mode === 'resume' ? '/api/resume' : '/api/run']);
      if (!stateFinished(states.shopee)) stages.push(['SHOPEE CN/VN', mode === 'resume' ? '/api/shopee/run/resume' : '/api/shopee/run/start']);
      if (whppNeedsRun(states.whpp)) stages.push(['WHPP本土', mode === 'resume' ? '/api/whpp/run/resume' : '/api/whpp/run/start']);

      if (!stages.length) {
        setStatus('success', '七业务均已完成，无需重复处理。');
        return;
      }

      const completed = [];
      const skipped = [];
      for (const [label, url] of stages) {
        try {
          await runStage(label, url);
          completed.push(label);
        } catch (error) {
          if (alreadyComplete(error)) {
            skipped.push(label);
            console.info('[CE-QC][V54_UNIFIED_RUN] already complete, continue:', label);
            continue;
          }
          throw error;
        }
      }

      const parts = [];
      if (completed.length) parts.push(`${completed.join('；')}处理完成`);
      if (skipped.length) parts.push(`${skipped.join('；')}已完成，自动跳过`);
      setStatus('success', `综合日报处理完成：${parts.join('；')}。`);
      whppSummaryCache = null;
      whppSummaryAt = 0;
      unifiedImportCache = null;
      unifiedImportAt = 0;
      if (location.pathname === '/whpp' && typeof global.navigateWhppPage === 'function') {
        await global.navigateWhppPage();
      } else if (typeof global.refresh === 'function') {
        await global.refresh();
      } else {
        global.location.reload();
      }
    } catch (error) {
      console.error('[CE-QC][V54_UNIFIED_RUN]', error);
      setStatus('danger', `全自动处理失败：${String(error.message || error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function pauseUnifiedV54() {
    if (busy) return;
    setBusy(true, '正在暂停…');
    try {
      await Promise.allSettled([
        api('/api/pause', { method: 'POST' }),
        api('/api/shopee/run/pause', { method: 'POST' }),
        api('/api/whpp/run/pause', { method: 'POST' })
      ]);
      setStatus('warning', 'CCSL、SHOPEE、WHPP本土处理均已发送暂停指令。');
      if (typeof global.refresh === 'function') await global.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function getWhppSummary() {
    if (whppSummaryCache && Date.now() - whppSummaryAt < 3000) return whppSummaryCache;
    try {
      whppSummaryCache = await api('/api/v51/whpp-state');
      whppSummaryAt = Date.now();
      return whppSummaryCache;
    } catch {
      return null;
    }
  }

  async function getUnifiedImportSummary() {
    if (unifiedImportCache && Date.now() - unifiedImportAt < 800) return unifiedImportCache;
    try {
      const payload = await api('/api/import/unified-latest?compact=1');
      unifiedImportCache = payload?.import || null;
      unifiedImportAt = Date.now();
      return unifiedImportCache;
    } catch {
      return null;
    }
  }

  function setTextIfChanged(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function sameReport(imported, whppPayload) {
    const unifiedDate = String(imported?.reportDate || '');
    const whppDate = String(whppPayload?.state?.reportDate || whppPayload?.reportDate || '');
    return Boolean(unifiedDate && whppDate && unifiedDate === whppDate);
  }

  function combinedImportTruth(imported = null, whppPayload = null) {
    const coreUnique = Number(imported?.summary?.validUniqueWaybills || 0);
    const persistedWhppRaw = imported?.classificationCounts?.WHPP;
    const persistedWhpp = persistedWhppRaw === undefined || persistedWhppRaw === null ? NaN : Number(persistedWhppRaw);
    const runtimeWhpp = sameReport(imported, whppPayload)
      ? Number(whppPayload?.dashboard?.metrics?.total || whppPayload?.state?.pnhBills?.length || 0)
      : 0;
    const separateWhpp = Number.isFinite(persistedWhpp) ? 0 : runtimeWhpp;
    const whppTotal = Number.isFinite(persistedWhpp) ? persistedWhpp : runtimeWhpp;
    return {
      coreUnique,
      whppTotal,
      combinedUnique: coreUnique + separateWhpp,
      separateWhpp
    };
  }

  function patchImportedUniqueTotal(grid, imported = null, whppPayload = null) {
    const validNode = grid.querySelector('[data-testid="classification-valid-unique"]');
    const truth = combinedImportTruth(imported, whppPayload);
    if (!truth.combinedUnique) return;
    const validText = truth.combinedUnique.toLocaleString('zh-CN');
    if (validNode) setTextIfChanged(validNode, validText);

    const status = document.getElementById('fileStatus');
    if (status) {
      status.querySelectorAll('p').forEach(p => {
        if (/有效唯一单号/.test(p.textContent || '')) {
          const next = p.innerHTML.replace(/有效唯一单号\s*[\d,]+/, `有效唯一单号 ${validText}`);
          if (next !== p.innerHTML) p.innerHTML = next;
        }
        if (/当前处理队列/.test(p.textContent || '')) {
          const currentOpen = Number(imported?.carryover?.currentOpen || 0);
          const queueText = Math.max(currentOpen, truth.combinedUnique).toLocaleString('zh-CN');
          const next = p.innerHTML.replace(/当前处理队列\s*<b[^>]*>[\d,]+<\/b>/, `当前处理队列 <b data-testid="combined-processing-queue-count">${queueText}</b>`);
          if (next !== p.innerHTML) p.innerHTML = next;
        }
      });
    }
  }

  function relabelWarning(testId, label) {
    const valueNode = document.querySelector(`[data-testid="${testId}"]`);
    const parent = valueNode?.closest('span');
    if (!valueNode || !parent) return;
    const value = valueNode.textContent || '0';
    const html = `${label} <b data-testid="${testId}">${value}</b>`;
    if (parent.innerHTML !== html) parent.innerHTML = html;
  }

  async function decorateUnifiedImport() {
    if (decorating) return;
    const grid = document.querySelector('#unifiedClassificationSummary .unified-count-grid');
    if (!grid) return;
    decorating = true;
    try {
      const [whppPayload, imported] = await Promise.all([getWhppSummary(), getUnifiedImportSummary()]);
      const truth = combinedImportTruth(imported, whppPayload);
      let card = grid.querySelector('[data-v54-business="WHPP"]');
      if (!card) {
        card = document.createElement('div');
        card.dataset.v54Business = 'WHPP';
        card.innerHTML = '<span>WHPP本土</span><b data-testid="classification-whpp">0</b>';
        grid.appendChild(card);
      }
      const value = card.querySelector('b');
      setTextIfChanged(value, Number(truth.whppTotal || 0).toLocaleString('zh-CN'));
      patchImportedUniqueTotal(grid, imported, whppPayload);
      relabelWarning('classification-missing-recipient', '收件人为空（仍已按规则分类）');
      relabelWarning('classification-conflicts', '真正分类冲突');

      const empty = document.querySelector('#unifiedClassificationSummary .unified-empty-state span');
      if (empty && /六业务/.test(empty.textContent || '')) setTextIfChanged(empty, (empty.textContent || '').replace('六业务', '七业务'));
    } finally {
      decorating = false;
    }
  }

  function install() {
    global.runUnified = () => executeUnified('start');
    global.resumeUnified = () => executeUnified('resume');
    global.pauseUnified = pauseUnifiedV54;

    void decorateUnifiedImport();
    let timer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void decorateUnifiedImport(), 60);
    });
    observer.observe(document.querySelector('.app-shell') || document.body, { subtree: true, childList: true });
    console.info('[CE-QC][WHPP_UNIFIED_V54]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(window);
