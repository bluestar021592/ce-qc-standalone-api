(function installSevenBusinessStatusV168(global) {
  if (global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__) return;

  const VERSION = '2026-09-02-v168-one-persisted-status-read-v1';
  const ARCHITECTURE = '2026-08-29-single-unified-runner-status-only-v1';
  const STATUS_SOURCE_REVISION = '2026-09-02-v322-one-read-seven-business-status-v1';
  const STATUS_TIMEOUT_MS = 8000;
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
      return new Error(`轻量状态读取超过${Math.round(STATUS_TIMEOUT_MS / 1000)}秒，正在自动重试`);
    }
    return error instanceof Error ? error : new Error(message || '状态读取失败，正在自动重试');
  }
  async function readPersistedStatus(target) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS) : null;
    try {
      const query = new URLSearchParams({ businessType: 'ALL', reportDate: target });
      const response = await fetch(`/api/v33/run-progress?${query.toString()}`, {
        method: 'GET', cache: 'no-store', credentials: 'same-origin', ...(controller ? { signal: controller.signal } : {})
      });
      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch {}
      if (!response.ok || payload.ok === false) throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
      if (String(payload.statusVersion || '') !== STATUS_SOURCE_REVISION) throw new Error('后台轻量状态接口版本尚未同步');
      if (normalizeDate(payload.reportDate) !== target) throw new Error(`后台状态日期未同步到${target}`);
      return payload;
    } catch (error) {
      throw normalizedStatusError(error);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  function stageFromPersisted(raw = {}, key, label, target) {
    const date = normalizeDate(raw.reportDate || target);
    const runStatus = String(raw.runStatus || '').toLowerCase();
    let state = 'pending';
    if (date === target && raw.complete === true) state = 'done';
    else if (date === target && (raw.running === true || runStatus === 'running')) state = 'running';
    else if (date === target && (raw.paused === true || runStatus === 'paused')) state = 'paused';
    else if (date === target && (raw.failed === true || runStatus === 'failed')) state = 'failed';
    return {
      key, label, state, date,
      complete: raw.complete === true,
      zeroTicketDay: raw.zeroTicketDay === true,
      total: Number(raw.sourceTotal || raw.dailyTotal || 0),
      runStatus,
      phase: String(raw.phase || ''),
      batchIndex: Number(raw.batchIndex || 0),
      totalBatches: Number(raw.totalBatches || 0),
      details: String(raw.lastMessage || ''),
      snapshotId: String(raw.snapshotId || ''),
      statusSource: String(raw.statusSource || ''),
      statusFresh: true
    };
  }
  function transientStage(key, label, error, target) {
    const previous = (lastTruth?.reportDate === target ? (lastTruth.stages || []).find(stage => stage.key === key) : null);
    const message = String(normalizedStatusError(error)?.message || '状态读取暂时中断，正在自动重试');
    return previous
      ? { ...previous, key, label, date: target, statusFresh: false, statusReadError: message, error: message }
      : { key, label, state: 'unknown', date: target, total: 0, statusFresh: false, statusReadError: message, error: message };
  }
  function stageText(stage) {
    const suffix = stage.statusFresh === false ? '（状态确认中）' : '';
    if (stage.state === 'done') return `${stage.label} 已完成${suffix}`;
    if (stage.state === 'running') return `${stage.label} 处理中${suffix}`;
    if (stage.state === 'paused') return `${stage.label} 已暂停${suffix}`;
    if (stage.state === 'failed') return `${stage.label} 失败${suffix}`;
    if (stage.state === 'unknown') return `${stage.label} 状态确认中`;
    return `${stage.label} 待处理${suffix}`;
  }
  function pillClass(stage) {
    if (stage.statusFresh === false) return 'warning';
    if (stage.state === 'done') return 'success';
    if (stage.state === 'failed') return 'danger';
    if (stage.state === 'running' || stage.state === 'paused' || stage.state === 'unknown') return 'warning';
    return 'muted';
  }
  function formatFailureDetail(stage) {
    return String(stage?.details || stage?.error || '').trim();
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
    else button.removeAttribute?.('title');
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
    const blockers = stages.filter(stage => ['failed','paused'].includes(stage.state) && stage.statusFresh !== false)
      .map(stage => ({ stage, detail: formatFailureDetail(stage) })).filter(item => item.detail);
    const transient = stages.filter(stage => stage.statusFresh === false)
      .map(stage => `${stage.label}：${String(stage.statusReadError || '轻量状态读取暂时中断，正在自动重试')}`);
    node.dataset.v333Owner = 'canonical';
    node.dataset.executionOwner = 'V67';
    node.dataset.statusSourceRevision = STATUS_SOURCE_REVISION;
    node.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <strong style="color:#0b3158">七业务处理状态</strong>
        ${stages.map(stage => `<span class="status-pill ${pillClass(stage)}" title="${esc(formatFailureDetail(stage) || stage.statusReadError || stage.phase || '')}">${esc(stageText(stage))}</span>`).join('')}
        <span class="status-pill ${allFresh ? (truth.complete ? 'success' : 'muted') : 'warning'}">${truth.complete ? '七业务已完成' : (allFresh ? '尚未全部完成' : '状态确认中')}</span>
      </div>
      ${transient.length ? `<div data-testid="seven-business-status-retry" style="margin-top:8px;color:#916000;font-size:12px;line-height:1.5">轻量状态读取暂未确认，已保留上一次真实进度并自动重试：${transient.map(esc).join('；')}</div>` : ''}
      ${blockers.length ? `<div data-testid="seven-business-failure-detail" style="margin-top:9px;padding:9px 11px;border-radius:7px;background:#fff3f3;border:1px solid #ffd0d0;color:#9f1c1c;font-size:13px;line-height:1.55">${blockers.map(item => `<div><strong>${esc(item.stage.label)}：</strong>${esc(item.detail)}</div>`).join('')}</div>` : ''}`;
    const start = document.querySelector('[data-testid="global-auto-process"]');
    const resume = document.querySelector('button[onclick="resumeUnified()"]');
    if (truth.complete) {
      lockControl(start, '七业务已完成', `${truth.reportDate} 七业务均已有正式持久化结果，无需重复处理`);
      lockControl(resume, '', '七业务均已完成，无需继续处理');
    } else if (!allFresh) {
      lockControl(start, '状态确认中', '正在读取当前日报的轻量持久化状态，确认前禁止重复启动');
      lockControl(resume, '', '正在读取当前日报的轻量持久化状态，确认前禁止重复继续');
    } else {
      unlockControl(start);
      unlockControl(resume);
    }
  }
  async function refreshTruth() {
    if (refreshBusy) return lastTruth;
    refreshBusy = true;
    const target = targetDate();
    try {
      if (!target) throw new Error('无法确定日报日期');
      const payload = await readPersistedStatus(target);
      const raw = payload.stages || {};
      const stages = [
        stageFromPersisted(raw.CCSL, 'CCSL', 'CCSL', target),
        stageFromPersisted(raw.SHOPEE, 'SHOPEE', 'SHOPEE CN/VN', target),
        stageFromPersisted(raw.WHPP, 'WHPP', 'WHPP本土', target)
      ];
      lastTruth = { reportDate: target, stages, complete: payload.complete === true && stages.every(stage => stage.state === 'done'), statusFresh: true, checkedAt: Date.now() };
      renderTruth(lastTruth);
      return lastTruth;
    } catch (error) {
      const date = target || normalizeDate(lastTruth?.reportDate);
      const stages = [
        transientStage('CCSL', 'CCSL', error, date),
        transientStage('SHOPEE', 'SHOPEE CN/VN', error, date),
        transientStage('WHPP', 'WHPP本土', error, date)
      ];
      lastTruth = { reportDate: date, stages, complete: false, statusFresh: false, checkedAt: Date.now() };
      renderTruth(lastTruth);
      console.warn('[CE-QC][V168_STATUS_ONLY] persisted seven-business status temporarily unavailable:', normalizedStatusError(error)?.message || error);
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
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(() => { void refreshTruth(); }, 80); });
    document.addEventListener('change', event => { if (event.target?.id === 'excelFile') setTimeout(() => { void refreshTruth(); }, 80); }, true);
    document.addEventListener('click', event => { if (event.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query,[data-testid="combined-daily-import"]')) setTimeout(() => { void refreshTruth(); }, 120); }, true);
    schedule();
    global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__ = {
      version: VERSION, architecture: ARCHITECTURE, statusSourceRevision: STATUS_SOURCE_REVISION,
      statusTimeoutMs: STATUS_TIMEOUT_MS, statusPollMs: STATUS_POLL_MS,
      statusOnly: true, authoritativeRunner: 'V67', refresh: refreshTruth,
      get lastTruth() { return lastTruth; }
    };
    console.info('[CE-QC][V168_STATUS_ONLY]', VERSION, ARCHITECTURE, STATUS_SOURCE_REVISION, 'one exact-date V322 persisted read supplies all three stage badges; V168 never calls V311/V317/V132 and never starts processing.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(window);