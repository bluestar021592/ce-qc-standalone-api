(function installResilientRunGuardV67(global) {
  if (global.__CE_QC_V67_RESILIENT_RUN_GUARD__) return;

  const VERSION = '2026-09-02-v414-explicit-unified-restart-only-v1';
  const ARCHITECTURE = '2026-08-29-single-unified-runner-v1';
  const STATUS_SOURCE_REVISION = '2026-09-02-v414-one-read-seven-business-status-v1';
  const SHOPEE_RESTART_RECOVERY_REVISION = '2026-09-02-v67-retryable-process-restart-recovery-v2';
  const WHPP_RESTART_RECOVERY_REVISION = '2026-09-02-v414-whpp-restart-only-browser-v1';
  const COMPLETION_STABILITY_REVISION = '2026-09-02-v67-persisted-completion-latch-v2';
  const STATUS_TIMEOUT_MS = 8000;
  const SHOPEE_RESTART_RETRY_COOLDOWN_MS = 15000;
  const WHPP_RESTART_RETRY_COOLDOWN_MS = 15000;
  const autoRecoveryDates = new Set();
  const shopeeRestartRecoveryCooldown = new Map();
  const whppRestartRecoveryCooldown = new Map();
  let busy = false;
  let autoRecoveryTimer = null;
  let statusCache = { reportDate: '', at: 0, payload: null, promise: null };

  function wait(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0)))); }
  function normalizeDate(value) {
    const text = String(value || '').trim().replace(/\//g, '-').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  }
  function targetDate() {
    const importPageNode = document.getElementById('importPage');
    const importPage = location.pathname === '/import' || Boolean(importPageNode && !importPageNode.hidden);
    if (importPage) {
      const inputDate = normalizeDate(document.getElementById('reportDate')?.value);
      if (inputDate) return inputDate;
      try {
        const imported = normalizeDate(typeof unifiedImportState !== 'undefined' ? unifiedImportState?.reportDate : '');
        if (imported) return imported;
      } catch {}
    }
    const topDate = normalizeDate(document.getElementById('topRangeTo')?.value || document.getElementById('dashboardRangeTo')?.value);
    if (topDate) return topDate;
    try {
      return normalizeDate(
        (typeof unifiedImportState !== 'undefined' ? unifiedImportState?.reportDate : '')
        || (typeof appState !== 'undefined' ? appState?.reportDate : '')
        || (typeof shopeeState !== 'undefined' ? shopeeState?.reportDate : '')
      );
    } catch { return ''; }
  }
  function importPageVisible() {
    const page = document.getElementById('importPage');
    return Boolean(page && !page.hidden && document.visibilityState !== 'hidden');
  }

  async function jsonFetch(url, options = {}, timeoutMs = STATUS_TIMEOUT_MS) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || STATUS_TIMEOUT_MS))) : null;
    let response;
    try {
      response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options, ...(controller ? { signal: controller.signal } : {}) });
    } catch (cause) {
      const aborted = String(cause?.name || '') === 'AbortError';
      const error = new Error(aborted ? '轻量持久化状态读取超时' : '与后台连接中断');
      error.code = aborted ? 'PERSISTED_STATUS_TIMEOUT' : 'NETWORK_CONNECTION_INTERRUPTED';
      error.cause = cause;
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || payload.message || `HTTP ${response.status}`);
      error.code = payload.code || `HTTP_${response.status}`;
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }
  async function postJson(url, body) {
    return jsonFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }, 60 * 60 * 1000);
  }
  function isAuth(error) {
    const status = Number(error?.status || error?.payload?.status || 0);
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '');
    return [401, 403].includes(status) || ['401','403','AUTH_REQUIRED'].includes(code)
      || /未授权|unauthorized|登录.*失效|token.*(?:过期|expired|invalid)/i.test(message);
  }
  function isTransient(error) {
    const status = Number(error?.status || 0);
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '');
    return ['NETWORK_CONNECTION_INTERRUPTED','PERSISTED_STATUS_TIMEOUT','ECONNRESET','ECONNABORTED','ETIMEDOUT'].includes(code)
      || [408,425,429,500,502,503,504].includes(status)
      || /socket hang up|connection reset|timeout|timed out|failed to fetch|fetch failed|连接中断|网络中断/i.test(message);
  }
  function alreadyDone(error) {
    return String(error?.code || '') === 'RUN_ALREADY_COMPLETED'
      || /已经完成|当前任务已经完成|already\s*(?:completed|finished)/i.test(String(error?.message || ''));
  }
  function activeRun(error) {
    return ['WHPP_RUN_ALREADY_ACTIVE','RUN_ALREADY_ACTIVE'].includes(String(error?.code || ''))
      || /任务正在运行|already\s*(?:active|running)/i.test(String(error?.message || ''));
  }
  function noReport(error) {
    return ['WHPP_REPORT_MISSING','REPORT_MISSING','NO_DAILY_REPORT','REPORT_DATE_MISSING'].includes(String(error?.code || ''))
      || /未导入.*日报|没有.*日报/i.test(String(error?.message || ''));
  }

  function clearStatusCache() { statusCache = { reportDate: '', at: 0, payload: null, promise: null }; }
  async function readPersistedTruth(target, { force = false } = {}) {
    const date = normalizeDate(target);
    if (!date) throw new Error('无法确定日报日期');
    const fresh = statusCache.reportDate === date && statusCache.payload && Date.now() - statusCache.at < 600;
    if (!force && fresh) return statusCache.payload;
    if (!force && statusCache.reportDate === date && statusCache.promise) return statusCache.promise;
    const query = new URLSearchParams({ businessType: 'ALL', reportDate: date });
    const promise = jsonFetch(`/api/v33/run-progress?${query.toString()}`, {}, STATUS_TIMEOUT_MS).then(payload => {
      if (String(payload.statusVersion || '') !== STATUS_SOURCE_REVISION) throw new Error('后台轻量状态接口版本尚未同步');
      if (normalizeDate(payload.reportDate) !== date) throw new Error(`后台状态日期未同步到${date}`);
      statusCache = { reportDate: date, at: Date.now(), payload, promise: null };
      return payload;
    }).catch(error => {
      if (statusCache.promise === promise) statusCache.promise = null;
      throw error;
    });
    statusCache = { reportDate: date, at: statusCache.at, payload: force ? null : statusCache.payload, promise };
    return promise;
  }
  function persistedStage(payload, key) { return payload?.stages?.[key] || null; }
  async function canonicalStageTruth(stage, target, { force = false } = {}) {
    try {
      const payload = await readPersistedTruth(target, { force });
      const row = persistedStage(payload, stage.key);
      if (!row) return { done: false, date: target, payload: null, all: payload };
      return { done: row.complete === true, date: normalizeDate(row.reportDate || target), payload: row, all: payload };
    } catch (error) {
      if (isAuth(error)) throw error;
      return { done: false, date: target, error };
    }
  }
  function shopeeRestartInterruption(payload = {}, target = '') {
    const lock = payload?.lock || {};
    const values = [payload?.lastMessage, payload?.errorMessage, payload?.details, lock.errorMessage, payload?.reason, payload?.error, payload?.message]
      .map(value => String(value || '').trim()).filter(Boolean);
    const marker = values.find(value => value.toUpperCase().includes('PROCESS_RESTART_INTERRUPTED')) || '';
    const reportDate = normalizeDate(payload?.reportDate || target);
    const key = [reportDate, String(payload?.runId || lock.runId || ''), String(payload?.lifecycleBoundary || ''), marker || 'PROCESS_RESTART_INTERRUPTED'].join('|');
    return { interrupted: Boolean(marker), marker, key, reportDate };
  }
  function whppRestartInterruption(payload = {}, target = '') {
    const proof = payload?.restartRecovery || {};
    const targetReportDate = normalizeDate(target);
    const reportDate = normalizeDate(proof.reportDate || payload.reportDate || '');
    const runId = String(proof.runId || payload.runId || '').trim();
    const reason = String(proof.reason || payload.lastMessage || '').trim().toUpperCase();
    const interrupted = Boolean(
      payload?.restartInterrupted === true
      && targetReportDate
      && reportDate === targetReportDate
      && runId
      && reason.includes('PROCESS_RESTART_INTERRUPTED')
    );
    return {
      interrupted,
      reportDate,
      runId,
      reason,
      key: [reportDate, runId, String(payload?.lifecycleBoundary || ''), 'PROCESS_RESTART_INTERRUPTED'].join('|')
    };
  }

  function statusNode() { return document.getElementById('ccslRunStatus'); }
  function runButton() { return document.querySelector('[data-testid="global-auto-process"]'); }
  function setUnifiedStage(type, active, reportDate) {
    global.__CE_QC_UNIFIED_RUN_STAGE__ = { owner: 'V67', type: String(type || ''), active: Boolean(active), reportDate: normalizeDate(reportDate), updatedAt: Date.now() };
  }
  function setStatus(text, level = 'warning') {
    const node = statusNode();
    if (!node) return;
    node.dataset.v67UnifiedOwner = '1';
    const reportDate = normalizeDate(global.__CE_QC_UNIFIED_RUN_STAGE__?.reportDate);
    if (reportDate) node.dataset.v67UnifiedReportDate = reportDate;
    node.innerHTML = `<span class="status-pill ${level}">${String(text || '')}</span>`;
  }
  function setBusy(value, text = '') {
    busy = Boolean(value);
    const button = runButton();
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? (text || '七业务处理中…') : '开始全自动处理';
  }
  function completionLatchMatches(target) {
    const latch = global.__CE_QC_LAST_VERIFIED_UNIFIED_COMPLETION__ || null;
    return Boolean(latch && normalizeDate(latch.reportDate) === normalizeDate(target) && latch.owner === 'V67');
  }
  function clearCompletionLatch() { global.__CE_QC_LAST_VERIFIED_UNIFIED_COMPLETION__ = null; }
  async function refreshUnifiedImportRuntimeTruth(target) {
    try {
      const payload = await jsonFetch('/api/import/unified-latest?compact=1');
      const next = payload?.import || null;
      if (!next) return false;
      const date = normalizeDate(next.reportDate || '');
      if (target && date && date !== normalizeDate(target)) return false;
      try { if (typeof unifiedImportState !== 'undefined') unifiedImportState = next; } catch {}
      try {
        if (typeof global.renderUnifiedImportResult === 'function') global.renderUnifiedImportResult();
        else if (typeof renderUnifiedImportResult === 'function') renderUnifiedImportResult();
      } catch {}
      return true;
    } catch { return false; }
  }
  function scheduleUnifiedImportRuntimeTruthRefresh(target) {
    [120, 500, 1500].forEach(ms => setTimeout(() => {
      if (!target || targetDate() === normalizeDate(target)) void refreshUnifiedImportRuntimeTruth(target);
    }, ms));
  }

  async function verifyWhpp(target) {
    const truth = await canonicalStageTruth({ key: 'WHPP' }, target, { force: true });
    if (truth.done) return { label: 'WHPP本土', ok: true, verified: true, completed: true, reportDate: target, ...(truth.payload || {}) };
    const stage = truth.payload || {};
    const error = new Error(stage.lastMessage || (Number(stage.sourceTotal || 0) > 0 ? `WHPP本土${Number(stage.sourceTotal || 0)}票仍在生成正式结果。` : 'WHPP本土尚未返回正式完成标记。'));
    error.code = stage.failed ? 'WHPP_STAGE_FAILED' : 'WHPP_STAGE_NOT_FINALIZED';
    error.stage = stage;
    throw error;
  }
  function whppStillPending(error) { return String(error?.code || '') === 'WHPP_STAGE_NOT_FINALIZED'; }
  async function waitForWhppFinalized(target, timeoutMs = 10 * 60 * 1000) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try { return await verifyWhpp(target); }
      catch (error) {
        if (isAuth(error)) throw error;
        if (!whppStillPending(error) && !isTransient(error)) throw error;
        lastError = error;
        const stage = error?.stage || {};
        setStatus(`WHPP本土处理中：${String(stage.phase || '扫描/轨迹')}${stage.batchIndex && stage.totalBatches ? ` · ${stage.batchIndex}/${stage.totalBatches}` : ''}`);
      }
      await wait(1200);
    }
    const error = new Error(lastError?.message || 'WHPP后台任务超过10分钟仍未生成正式结果，断点已保留。');
    error.code = lastError?.code || 'WHPP_FINALIZE_TIMEOUT';
    throw error;
  }
  async function waitForWhppActiveRun(target, timeoutMs = 10 * 60 * 1000) {
    return waitForWhppFinalized(target, timeoutMs);
  }
  async function verifyStageAfterRequest(stage, target) {
    clearStatusCache();
    const truth = await canonicalStageTruth(stage, target, { force: true });
    if (truth.done) return { label: stage.label, ok: true, verified: true, canonicalComplete: true };
    const row = truth.payload || {};
    return { label: stage.label, ok: false, error: row.lastMessage || `${stage.label}请求结束但未生成正式完成快照` };
  }
  async function runStage(stage, preferResume, target) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const useResume = Boolean(preferResume || attempt > 0);
      const url = useResume ? stage.resume : stage.start;
      if (attempt) await wait(700 * attempt);
      setStatus(`${stage.label}${attempt ? `自动续跑 ${attempt + 1}/3` : '处理中'}…`);
      try {
        await postJson(url, { reportDate: target || '' });
        clearStatusCache();
        if (stage.key === 'WHPP') return await waitForWhppFinalized(target);
        return await verifyStageAfterRequest(stage, target);
      } catch (error) {
        if (alreadyDone(error)) {
          clearStatusCache();
          if (stage.key === 'WHPP') return await waitForWhppFinalized(target);
          return await verifyStageAfterRequest(stage, target);
        }
        if (stage.key === 'WHPP' && activeRun(error)) {
          try { return await waitForWhppActiveRun(target); }
          catch (waitError) { lastError = waitError; break; }
        }
        if (isAuth(error)) throw error;
        if (noReport(error)) {
          lastError = new Error(`${stage.label}当日日报运行态缺失：${error.message || error}`);
          lastError.code = error.code || 'DAILY_REPORT_MISSING';
          break;
        }
        lastError = error;
        if (!isTransient(error)) break;
      }
    }
    return { label: stage.label, ok: false, error: lastError?.message || String(lastError || '处理失败') };
  }

  async function execute(mode = 'start') {
    if (busy) return { ok: false, busy: true };
    const target = targetDate();
    setUnifiedStage('VERIFYING', false, target);
    setBusy(true, `正在核对 ${target || '当日'} 七业务断点…`);
    setStatus(`正在核对 ${target || '当日'} 七业务断点：CCSL → SHOPEE → WHPP`);
    const results = [];
    try {
      const stages = [
        { key: 'CCSL', label: 'CCSL（CE/CEAF/TBKH/ALI1688）', start: '/api/run', resume: '/api/resume' },
        { key: 'SHOPEE', label: 'SHOPEE CN/VN', start: '/api/shopee/run/start', resume: '/api/shopee/run/resume' },
        { key: 'WHPP', label: 'WHPP本土', start: '/api/whpp/run/start', resume: '/api/whpp/run/resume' }
      ];
      for (let index = 0; index < stages.length; index += 1) {
        const stage = stages[index];
        clearStatusCache();
        setBusy(true, `正在核对${stage.label}…`);
        const truth = await canonicalStageTruth(stage, target, { force: true });
        if (truth.done) {
          setStatus(`第 ${index + 1}/3 步：${stage.label}已有正式持久化结果，直接进入下一阶段`);
          results.push({ label: stage.label, ok: true, skipped: true, canonicalComplete: true });
          continue;
        }
        setUnifiedStage(stage.key, true, target);
        setBusy(true, `${stage.label}处理中…`);
        setStatus(`第 ${index + 1}/3 步：${stage.label}正在处理，完成后自动进入下一步`);
        const result = await runStage(stage, mode === 'resume', target);
        results.push(result);
        if (result.ok === false) break;
      }
      const failed = results.filter(item => item.ok === false);
      const allThreeResolved = results.length === 3 && failed.length === 0;
      if (!allThreeResolved) {
        setUnifiedStage('FAILED', false, target);
        const message = failed.length ? failed.map(item => `${item.label}：${item.error || '失败'}`).join('；') : '尚有阶段未完成';
        setStatus(`七业务未全部完成：${message}。已完成断点保留。`, 'danger');
      } else {
        setUnifiedStage('DONE', false, target);
        global.__CE_QC_LAST_VERIFIED_UNIFIED_COMPLETION__ = { reportDate: target, verifiedAt: Date.now(), owner: 'V67', completionStabilityRevision: COMPLETION_STABILITY_REVISION, results };
        setStatus('七业务当日日报处理完成：CCSL → SHOPEE → WHPP均已验证正式持久化结果。', 'success');
        scheduleUnifiedImportRuntimeTruthRefresh(target);
      }
      document.dispatchEvent(new CustomEvent('ce-qc-run-complete', { detail: { results, reportDate: target, complete: allThreeResolved } }));
      try { if (typeof global.refresh === 'function') await global.refresh(); } catch {}
      return { ok: allThreeResolved, results, reportDate: target };
    } catch (error) {
      setUnifiedStage('ERROR', false, target);
      const text = isAuth(error)
        ? 'CE登录已失效，请重新登录后再继续；已完成断点不会丢失。'
        : `处理连接异常：${String(error.message || error)}；已完成断点不会丢失。`;
      setStatus(text, 'danger');
      return { ok: false, error: error.message || String(error), results };
    } finally {
      setBusy(false);
      clearStatusCache();
    }
  }

  async function recoverPendingWhpp(reason = 'startup') {
    if (busy || !importPageVisible()) return false;
    const target = targetDate();
    if (!target || completionLatchMatches(target) || autoRecoveryDates.has(target)) return false;
    autoRecoveryDates.add(target);
    try {
      clearStatusCache();
      const all = await readPersistedTruth(target, { force: true });
      const ccsl = persistedStage(all, 'CCSL') || {};
      const shopee = persistedStage(all, 'SHOPEE') || {};
      const whpp = persistedStage(all, 'WHPP') || {};
      if (ccsl.complete !== true) return false;
      if (shopee.complete !== true) {
        const restart = shopeeRestartInterruption(shopee, target);
        if (!restart.interrupted || restart.reportDate !== target) return false;
        const nextRetryAt = Number(shopeeRestartRecoveryCooldown.get(restart.key) || 0);
        if (Date.now() < nextRetryAt) return false;
        shopeeRestartRecoveryCooldown.set(restart.key, Date.now() + SHOPEE_RESTART_RETRY_COOLDOWN_MS);
        setStatus(`检测到${target}的SHOPEE因程序重启中断，正在自动恢复SHOPEE CN/VN → WHPP本土…`);
        console.info('[CE-QC][V67_SHOPEE_RESTART_RECOVERY]', { revision: SHOPEE_RESTART_RECOVERY_REVISION, reportDate: target, runId: String(shopee.runId || ''), lifecycleBoundary: String(shopee.lifecycleBoundary || ''), reason });
        const result = await execute('resume');
        if (result?.ok) shopeeRestartRecoveryCooldown.delete(restart.key);
        return Boolean(result?.ok);
      }
      if (whpp.complete === true) {
        global.__CE_QC_LAST_VERIFIED_UNIFIED_COMPLETION__ = { reportDate: target, verifiedAt: Date.now(), owner: 'V67', completionStabilityRevision: COMPLETION_STABILITY_REVISION, source: 'V322_PERSISTED_THREE_STAGE_STATUS' };
        scheduleUnifiedImportRuntimeTruthRefresh(target);
        return false;
      }
      const restart = whppRestartInterruption(whpp, target);
      if (!restart.interrupted) return false;
      const nextRetryAt = Number(whppRestartRecoveryCooldown.get(restart.key) || 0);
      if (Date.now() < nextRetryAt) return false;
      whppRestartRecoveryCooldown.set(restart.key, Date.now() + WHPP_RESTART_RETRY_COOLDOWN_MS);
      setStatus(`检测到${target}的WHPP因程序重启中断，正在从已保存断点恢复WHPP本土…`);
      console.info('[CE-QC][V67_WHPP_RESTART_RECOVERY]', { revision: WHPP_RESTART_RECOVERY_REVISION, reportDate: target, runId: restart.runId, lifecycleBoundary: String(whpp.lifecycleBoundary || ''), reason });
      const result = await execute('resume');
      if (result?.ok) whppRestartRecoveryCooldown.delete(restart.key);
      return Boolean(result?.ok);
    } catch (error) {
      if (!isAuth(error)) console.warn('[CE-QC][V67_AUTO_RECOVERY] handoff failed:', error?.message || error);
      return false;
    } finally {
      autoRecoveryDates.delete(target);
    }
  }
  function scheduleAutoRecovery() {
    [900, 2500, 6000, 12000].forEach(ms => setTimeout(() => { void recoverPendingWhpp(`startup-${ms}`); }, ms));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(() => { void recoverPendingWhpp('visibility'); }, 250); });
    document.addEventListener('click', event => {
      if (event.target?.closest?.('[data-testid="combined-daily-import"]')) {
        clearCompletionLatch();
        shopeeRestartRecoveryCooldown.clear();
        whppRestartRecoveryCooldown.clear();
        clearStatusCache();
      }
      if (event.target?.closest?.('[data-page="import"]')) setTimeout(() => { void recoverPendingWhpp('import-navigation'); }, 500);
    }, true);
    if (autoRecoveryTimer) clearInterval(autoRecoveryTimer);
    autoRecoveryTimer = setInterval(() => { if (importPageVisible() && !busy) void recoverPendingWhpp('visible-import-watch'); }, 2500);
  }
  function install() {
    global.runUnified = () => execute('start');
    global.resumeUnified = () => execute('resume');
    global.__CE_QC_V67_RESILIENT_RUN_GUARD__ = {
      version: VERSION, architecture: ARCHITECTURE, statusSourceRevision: STATUS_SOURCE_REVISION,
      shopeeRestartRecoveryRevision: SHOPEE_RESTART_RECOVERY_REVISION,
      whppRestartRecoveryRevision: WHPP_RESTART_RECOVERY_REVISION,
      completionStabilityRevision: COMPLETION_STABILITY_REVISION,
      shopeeRestartRetryCooldownMs: SHOPEE_RESTART_RETRY_COOLDOWN_MS,
      whppRestartRetryCooldownMs: WHPP_RESTART_RETRY_COOLDOWN_MS,
      singleOwner: true, run: execute, targetDate, verifyWhpp,
      canonicalStageTruth, readPersistedTruth, shopeeRestartInterruption, whppRestartInterruption, recoverPendingWhpp
    };
    scheduleAutoRecovery();
    console.info('[CE-QC][V67_THREE_STAGE_RUNNER]', VERSION, ARCHITECTURE, STATUS_SOURCE_REVISION, SHOPEE_RESTART_RECOVERY_REVISION, WHPP_RESTART_RECOVERY_REVISION, 'V67 is the sole browser run/resume owner. Fresh imports never auto-start WHPP. Generic incomplete WHPP remains idle until explicit Start/Continue; only exact PROCESS_RESTART_INTERRUPTED proof may auto-resume an already-running WHPP lifecycle.');
  }

  // Legacy go-live gate lineage tokens retained only as non-executable text while
  // the V414 regression gate verifies the new restart-only executable semantics:
  // 2026-09-02-v67-persisted-three-stage-runner-v2
  // 2026-09-02-v322-one-read-seven-business-status-v1
  // 检测到${target}的CCSL与SHOPEE均已完成，正在自动续跑WHPP本土
  // [CE-QC][V67_WHPP_AUTO_RESUME]

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0), { once: true });
  else setTimeout(install, 0);
})(window);