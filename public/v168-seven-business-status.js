(function installSevenBusinessStatusV168(global) {
  if (global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__) return;

  const VERSION = '2026-09-01-v411-serialized-status-read-v1';
  const ARCHITECTURE = '2026-08-29-single-unified-runner-status-only-v1';
  const COMPLETION_SYNC_REVISION = '2026-08-30-v360-verified-whpp-status-sync-v1';
  const FAILURE_DETAIL_REVISION = '2026-08-31-v394-visible-shopee-failure-detail-v1';
  const STATUS_RESILIENCE_REVISION = '2026-09-01-v411-serialized-timeout-safe-status-v1';
  const COMPLETE_SNAPSHOT = new Set(['COMPLETED', 'COMPLETED_WITH_RETRY']);
  const RUN_VERIFIED_GRACE_MS = 10 * 60 * 1000;
  const STATUS_TIMEOUT_MS = 15000;
  const STATUS_ATTEMPTS = 1;
  const STATUS_POLL_MS = 10000;
  let lastTruth = null;
  let refreshBusy = false;
  let timer = null;

  function normalizeDate(value) {
    const text = String(value || '').trim().replace(/\//g, '-').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  }
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  }
  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function pendingImportDate() {
    const explicit = global.__CE_QC_PENDING_IMPORT_DATE__ || {};
    const active = explicit.active === true ? normalizeDate(explicit.reportDate) : '';
    if (active) return active;
    try {
      const fromV146 = normalizeDate(global.__CE_QC_V146_UNIFIED_IMPORT_DATE_STATUS__?.getPendingDate?.());
      if (fromV146) return fromV146;
    } catch {}
    return '';
  }

  function targetDate() {
    const pending = pendingImportDate();
    if (pending) return pending;
    const input = normalizeDate(document.getElementById('reportDate')?.value);
    if (input) return input;
    const top = normalizeDate(document.getElementById('topRangeTo')?.value || document.getElementById('dashboardRangeTo')?.value);
    if (top) return top;
    try {
      return normalizeDate(
        (typeof unifiedImportState !== 'undefined' ? unifiedImportState?.reportDate : '')
        || (typeof appState !== 'undefined' ? appState?.reportDate : '')
        || (typeof shopeeState !== 'undefined' ? shopeeState?.reportDate : '')
      );
    } catch { return ''; }
  }

  function normalizedStatusError(error) {
    const name = String(error?.name || '');
    const message = String(error?.message || error || '').trim();
    if (name === 'AbortError' || /signal is aborted|aborted without reason|aborterror|\babort(?:ed)?\b/i.test(message)) {
      return new Error(`状态读取超过${Math.round(STATUS_TIMEOUT_MS / 1000)}秒，正在自动重试`);
    }
    return error instanceof Error ? error : new Error(message || '状态读取失败，正在自动重试');
  }

  async function requestJson(url, init = {}, attempts = STATUS_ATTEMPTS) {
    let lastError = null;
    const totalAttempts = Math.max(1, Number(attempts || 1));
    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS) : null;
      try {
        const response = await fetch(url, {
          cache: 'no-store',
          credentials: 'same-origin',
          ...init,
          ...(controller ? { signal: controller.signal } : {})
        });
        const text = await response.text();
        let payload = {};
        try { payload = text ? JSON.parse(text) : {}; } catch {}
        if (!response.ok || payload.ok === false) throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
        return payload;
      } catch (error) {
        lastError = normalizedStatusError(error);
        if (attempt < totalAttempts) await wait(350 * attempt);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    throw lastError || new Error('状态读取失败，正在自动重试');
  }

  function readJson(url) {
    return requestJson(url, { method: 'GET' });
  }

  function postJson(url, body) {
    return requestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }

  async function settle(task) {
    try { return { status: 'fulfilled', value: await task() }; }
    catch (reason) { return { status: 'rejected', reason: normalizedStatusError(reason) }; }
  }

  function stageFromCcslRecovery(payload, target) {
    const date = normalizeDate(payload?.reportDate || target);
    const lockStatus = String(payload?.lock?.status || '').toLowerCase();
    let state = 'pending';
    if (date === target && payload?.complete === true) state = 'done';
    else if (date === target && payload?.paused === true) state = 'paused';
    else if (date === target && lockStatus === 'running') state = 'running';
    else if (date === target && lockStatus === 'failed') state = 'failed';
    return {
      key: 'CCSL', label: 'CCSL', state, date,
      total: Number(payload?.sourceTotal || 0),
      complete: payload?.complete === true,
      zeroTicketDay: Boolean(payload?.zeroTicketDay),
      runStatus: lockStatus,
      details: payload?.zeroTicketDay ? 'VALID日报CCSL=0票，已闭环' : String(payload?.action || ''),
      statusFresh: true
    };
  }

  function stageFromShopeeRecovery(payload, target) {
    const date = normalizeDate(payload?.reportDate || target);
    const lockStatus = String(payload?.lock?.status || '').toLowerCase();
    const diagnostic = payload?.diagnostic || {};
    let state = 'pending';
    if (date === target && payload?.complete === true) state = 'done';
    else if (date === target && lockStatus === 'running') state = 'running';
    else if (date === target && lockStatus === 'paused') state = 'paused';
    else if (date === target && lockStatus === 'failed') state = 'failed';
    const detail = payload?.complete === true
      ? 'VALID + COMPLETED 正式快照'
      : String(
          diagnostic.errorMessage
          || diagnostic.ceMsg
          || payload?.lock?.errorMessage
          || payload?.reason
          || ''
        );
    return {
      key: 'SHOPEE', label: 'SHOPEE CN/VN', state, date,
      complete: payload?.complete === true,
      runStatus: lockStatus,
      snapshotId: String(payload?.snapshotId || ''),
      details: detail,
      diagnostic,
      statusFresh: true
    };
  }

  function runnerVerifiedCompletion(target, ccsl, shopee) {
    const marker = global.__CE_QC_LAST_VERIFIED_UNIFIED_COMPLETION__ || {};
    const stage = global.__CE_QC_UNIFIED_RUN_STAGE__ || {};
    const markerDate = normalizeDate(marker.reportDate || '');
    const stageDate = normalizeDate(stage.reportDate || '');
    const age = Date.now() - Number(marker.verifiedAt || 0);
    return Boolean(
      target
      && ccsl?.state === 'done'
      && shopee?.state === 'done'
      && ccsl?.statusFresh !== false
      && shopee?.statusFresh !== false
      && marker.owner === 'V67'
      && markerDate === target
      && age >= 0 && age <= RUN_VERIFIED_GRACE_MS
      && stage.owner === 'V67'
      && stage.active === false
      && String(stage.type || '').toUpperCase() === 'DONE'
      && stageDate === target
    );
  }

  function stageFromWhpp(payload, target, verifiedByRunner = false) {
    const view = payload?.state || {};
    const date = normalizeDate(view.reportDate || payload?.reportDate || '');
    const snapshotStatus = String(view.snapshotStatus || payload?.snapshotStatus || '').toUpperCase();
    const runStatus = String(view.runStatus || view.currentRun?.status || '').toLowerCase();
    const processing = view.processing || {};
    const total = Number(view.total ?? payload?.total ?? view.dailyParseSummary?.totalRecognized ?? 0);
    let state = 'pending';
    let details = String(payload?.completionSource || payload?.summarySource || payload?.truthSource || '');
    if (date === target && (COMPLETE_SNAPSHOT.has(snapshotStatus) || view.completed === true || payload?.completed === true)) state = 'done';
    else if (verifiedByRunner) {
      state = 'done';
      details = 'V67已验证当前WHPP后台任务在finalizeWhppState成功后完成；等待摘要读取同步。';
    }
    else if (date === target && (runStatus === 'running' || processing.running)) state = 'running';
    else if (date === target && (runStatus === 'paused' || processing.paused)) state = 'paused';
    else if (date === target && (runStatus === 'failed' || processing.error)) state = 'failed';
    return {
      key: 'WHPP', label: 'WHPP本土', state, date: date || (verifiedByRunner ? target : ''), snapshotStatus, runStatus, total,
      verifiedByRunner,
      details,
      statusFresh: true
    };
  }

  function failedStage(key, label, error, target = '') {
    return { key, label, state: 'error', date: target, total: 0, error: String(error?.message || error || '状态读取失败'), statusFresh: false };
  }

  function priorStage(key, target) {
    if (!lastTruth || normalizeDate(lastTruth.reportDate) !== target) return null;
    return (lastTruth.stages || []).find(stage => stage.key === key && normalizeDate(stage.date || target) === target) || null;
  }

  function transientStage(key, label, error, target) {
    const previous = priorStage(key, target);
    const message = String(normalizedStatusError(error)?.message || '状态读取暂时中断，正在自动重试');
    if (previous) {
      return {
        ...previous,
        key,
        label,
        date: target,
        statusFresh: false,
        statusReadError: message,
        details: String(previous.details || ''),
        error: message
      };
    }
    return { key, label, state: 'unknown', date: target, total: 0, statusFresh: false, statusReadError: message, error: message };
  }

  function stageText(stage) {
    const suffix = stage.statusFresh === false ? '（状态确认中）' : '';
    if (stage.state === 'done') return `${stage.label} 已完成${suffix}`;
    if (stage.state === 'running') return `${stage.label} 处理中${suffix}`;
    if (stage.state === 'paused') return `${stage.label} 已暂停${suffix}`;
    if (stage.state === 'failed') return `${stage.label} 失败${suffix}`;
    if (stage.state === 'error') return `${stage.label} 状态读取失败`;
    if (stage.state === 'unknown') return `${stage.label} 状态确认中`;
    return `${stage.label} 待处理${suffix}`;
  }

  function pillClass(stage) {
    if (stage.statusFresh === false) return 'warning';
    if (stage.state === 'done') return 'success';
    if (stage.state === 'failed' || stage.state === 'error') return 'danger';
    if (stage.state === 'running' || stage.state === 'paused' || stage.state === 'unknown') return 'warning';
    return 'muted';
  }

  function formatFailureDetail(stage) {
    const detail = String(stage?.details || stage?.error || '').trim();
    const diagnostic = stage?.diagnostic || {};
    const meta = [];
    if (Number(diagnostic.httpStatus || 0)) meta.push(`HTTP ${Number(diagnostic.httpStatus)}`);
    if (String(diagnostic.ceCode || '').trim()) meta.push(`CE code ${String(diagnostic.ceCode).trim()}`);
    if (String(diagnostic.apiName || '').trim()) meta.push(String(diagnostic.apiName).trim());
    if (Number(diagnostic.shipmentCount || 0)) meta.push(`预检${Number(diagnostic.shipmentCount)}票`);
    return [detail, meta.join(' · ')].filter(Boolean).join('｜');
  }

  function ensureSummaryNode() {
    const status = document.getElementById('ccslRunStatus');
    if (!status?.parentElement) return null;
    let node = document.getElementById('sevenBusinessStageSummary');
    if (!node) {
      node = document.createElement('div');
      node.id = 'sevenBusinessStageSummary';
      node.setAttribute('data-testid', 'seven-business-stage-summary');
      node.style.margin = '10px 0';
      node.style.padding = '10px 12px';
      node.style.border = '1px solid #dce8f7';
      node.style.borderRadius = '8px';
      node.style.background = '#f8fbff';
      status.parentElement.insertBefore(node, status);
    }
    return node;
  }

  function rememberControl(button) {
    if (!button || button.dataset.v168Locked === '1') return;
    button.dataset.v168Locked = '1';
    button.dataset.v168PreviousDisabled = button.disabled ? '1' : '0';
    button.dataset.v168PreviousText = button.textContent || '';
    button.dataset.v168PreviousTitle = button.getAttribute?.('title') || button.title || '';
  }

  function lockControl(button, text, title) {
    if (!button) return;
    rememberControl(button);
    button.disabled = true;
    if (text) button.textContent = text;
    button.title = title || '';
  }

  function unlockControl(button) {
    if (!button || button.dataset.v168Locked !== '1') return;
    button.disabled = button.dataset.v168PreviousDisabled === '1';
    if (button.dataset.v168PreviousText !== undefined) button.textContent = button.dataset.v168PreviousText;
    const previousTitle = button.dataset.v168PreviousTitle || '';
    if (previousTitle) button.title = previousTitle;
    else if (button.removeAttribute) button.removeAttribute('title');
    delete button.dataset.v168Locked;
    delete button.dataset.v168PreviousDisabled;
    delete button.dataset.v168PreviousText;
    delete button.dataset.v168PreviousTitle;
  }

  function renderTruth(truth) {
    const node = ensureSummaryNode();
    if (!node || !truth) return;
    const stages = truth.stages || [];
    const allFresh = stages.length === 3 && stages.every(stage => stage.statusFresh !== false);
    const completionClass = truth.complete ? 'success' : 'muted';
    const overallClass = allFresh ? completionClass : 'warning';
    const blockers = stages
      .filter(stage => ['failed','paused','error'].includes(stage.state) && stage.statusFresh !== false)
      .map(stage => ({ stage, detail: formatFailureDetail(stage) }))
      .filter(item => item.detail);
    const transient = stages
      .filter(stage => stage.statusFresh === false)
      .map(stage => `${stage.label}：${String(stage.statusReadError || '状态读取暂时中断，正在自动重试')}`);
    node.dataset.v333Owner = 'canonical';
    node.dataset.executionOwner = 'V67';
    node.dataset.completionSyncRevision = COMPLETION_SYNC_REVISION;
    node.dataset.failureDetailRevision = FAILURE_DETAIL_REVISION;
    node.dataset.statusResilienceRevision = STATUS_RESILIENCE_REVISION;
    node.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <strong style="color:#0b3158">七业务处理状态</strong>
        ${stages.map(stage => `<span class="status-pill ${pillClass(stage)}" title="${esc(formatFailureDetail(stage) || stage.statusReadError || stage.details || stage.error || '')}">${esc(stageText(stage))}</span>`).join('')}
        <span class="status-pill ${overallClass}">${truth.complete ? '七业务已完成' : (allFresh ? '尚未全部完成' : '状态确认中')}</span>
      </div>
      ${transient.length ? `<div data-testid="seven-business-status-retry" style="margin-top:8px;color:#916000;font-size:12px;line-height:1.5">状态读取暂未确认，已保留上一次真实进度并自动重试：${transient.map(esc).join('；')}</div>` : ''}
      ${blockers.length ? `<div data-testid="seven-business-failure-detail" style="margin-top:9px;padding:9px 11px;border-radius:7px;background:#fff3f3;border:1px solid #ffd0d0;color:#9f1c1c;font-size:13px;line-height:1.55">${blockers.map(item => `<div><strong>${esc(item.stage.label)}：</strong>${esc(item.detail)}</div>`).join('')}</div>` : ''}`;

    const start = document.querySelector('[data-testid="global-auto-process"]');
    const resume = document.querySelector('button[onclick="resumeUnified()"]');
    if (truth.complete) {
      lockControl(start, '七业务已完成', `${truth.reportDate} CCSL、SHOPEE CN/VN、WHPP均已有正式结果，无需重复处理`);
      lockControl(resume, '', '七业务均已完成，无需继续处理');
      return;
    }
    if (!allFresh) {
      lockControl(start, '状态确认中', '正在读取当前日报真实处理状态，确认完成前禁止重复启动');
      lockControl(resume, '', '正在读取当前日报真实处理状态，确认完成前禁止重复继续');
      return;
    }
    unlockControl(start);
    unlockControl(resume);
  }

  async function refreshTruth() {
    if (refreshBusy) return lastTruth;
    refreshBusy = true;
    try {
      const target = targetDate();
      if (!target) {
        lastTruth = {
          reportDate: '',
          stages: [
            failedStage('CCSL', 'CCSL', '无法确定日报日期'),
            failedStage('SHOPEE', 'SHOPEE CN/VN', '无法确定日报日期'),
            failedStage('WHPP', 'WHPP本土', '无法确定日报日期')
          ],
          complete: false,
          checkedAt: Date.now()
        };
        renderTruth(lastTruth);
        return lastTruth;
      }

      const encoded = encodeURIComponent(target);
      // Local backend uses synchronous SQLite work. Run these status reads one by one
      // so the heavy CCSL proof cannot make the two lightweight requests expire while
      // they are merely waiting in the Node event-loop queue.
      const shopeeRequest = await settle(() => postJson('/api/v311/shopee-recovery', { action: 'status', reportDate: target }));
      const whppRequest = await settle(() => readJson(`/api/v132/whpp-fast-summary?reportDate=${encoded}&compact=1`));
      const ccslRequest = await settle(() => postJson('/api/v317/ccsl-recovery', { action: 'status', reportDate: target }));

      const ccsl = ccslRequest.status === 'fulfilled'
        ? stageFromCcslRecovery(ccslRequest.value, target)
        : transientStage('CCSL', 'CCSL', ccslRequest.reason, target);
      const shopee = shopeeRequest.status === 'fulfilled'
        ? stageFromShopeeRecovery(shopeeRequest.value, target)
        : transientStage('SHOPEE', 'SHOPEE CN/VN', shopeeRequest.reason, target);
      const verifiedByRunner = runnerVerifiedCompletion(target, ccsl, shopee);
      const whpp = whppRequest.status === 'fulfilled'
        ? stageFromWhpp(whppRequest.value, target, verifiedByRunner)
        : (verifiedByRunner
          ? stageFromWhpp({}, target, true)
          : transientStage('WHPP', 'WHPP本土', whppRequest.reason, target));
      const stages = [ccsl, shopee, whpp];
      lastTruth = {
        reportDate: target,
        stages,
        complete: stages.every(stage => stage.state === 'done' && stage.statusFresh !== false),
        statusFresh: stages.every(stage => stage.statusFresh !== false),
        checkedAt: Date.now()
      };
      renderTruth(lastTruth);
      return lastTruth;
    } catch (error) {
      const target = targetDate() || normalizeDate(lastTruth?.reportDate);
      const stages = [
        transientStage('CCSL', 'CCSL', error, target),
        transientStage('SHOPEE', 'SHOPEE CN/VN', error, target),
        transientStage('WHPP', 'WHPP本土', error, target)
      ];
      lastTruth = { reportDate: target, stages, complete: false, statusFresh: false, checkedAt: Date.now() };
      renderTruth(lastTruth);
      console.warn('[CE-QC][V168_STATUS_ONLY] seven-business truth refresh temporarily unavailable:', normalizedStatusError(error)?.message || error);
      return lastTruth;
    } finally {
      refreshBusy = false;
    }
  }

  function schedule() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      const page = document.getElementById('importPage');
      if (page && !page.hidden && document.visibilityState === 'visible') void refreshTruth();
    }, STATUS_POLL_MS);
  }

  function install() {
    setTimeout(() => { void refreshTruth(); }, 150);
    document.addEventListener('ce-qc-run-complete', () => setTimeout(() => { void refreshTruth(); }, 100));
    document.addEventListener('ce-qc-unified-import-committed', () => setTimeout(() => { void refreshTruth(); }, 80));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') setTimeout(() => { void refreshTruth(); }, 80);
    });
    document.addEventListener('change', event => {
      if (event.target?.id === 'excelFile') setTimeout(() => { void refreshTruth(); }, 80);
    }, true);
    document.addEventListener('click', event => {
      if (event.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query,[data-testid="combined-daily-import"]')) setTimeout(() => { void refreshTruth(); }, 120);
    }, true);
    schedule();
    global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__ = {
      version: VERSION,
      architecture: ARCHITECTURE,
      completionSyncRevision: COMPLETION_SYNC_REVISION,
      failureDetailRevision: FAILURE_DETAIL_REVISION,
      statusResilienceRevision: STATUS_RESILIENCE_REVISION,
      statusTimeoutMs: STATUS_TIMEOUT_MS,
      statusPollMs: STATUS_POLL_MS,
      statusOnly: true,
      authoritativeRunner: 'V67',
      refresh: refreshTruth,
      get lastTruth() { return lastTruth; }
    };
    console.info('[CE-QC][V168_STATUS_ONLY]', VERSION, ARCHITECTURE, COMPLETION_SYNC_REVISION, FAILURE_DETAIL_REVISION, STATUS_RESILIENCE_REVISION, 'V168 serializes exact-date status reads, gives each backend status endpoint a bounded 15s window, keeps stale progress read-only, and never wraps or starts unified processing.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(window);