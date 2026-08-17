(function installSevenBusinessStatusV168(global) {
  if (global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__) return;

  const VERSION = '2026-08-17-v168-seven-business-completion-truth-v1';
  const COMPLETE_SNAPSHOT = new Set(['COMPLETED', 'COMPLETED_WITH_RETRY']);
  let lastTruth = null;
  let refreshBusy = false;
  let timer = null;

  function normalizeDate(value) {
    const text = String(value || '').trim().replace(/\//g, '-').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  }

  function targetDate() {
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

  async function readJson(url) {
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || payload.ok === false) throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    return payload;
  }

  function stageFromCcsl(payload, target) {
    const lock = payload?.status?.lock || {};
    const date = normalizeDate(lock.reportDate || target);
    const status = String(lock.status || '').toLowerCase();
    let state = 'pending';
    if (date === target && status === 'finished') state = 'done';
    else if (date === target && status === 'running') state = 'running';
    else if (date === target && status === 'paused') state = 'paused';
    else if (date === target && status === 'failed') state = 'failed';
    return { key: 'CCSL', label: 'CCSL', state, date, status, total: 0 };
  }

  function stageFromBusiness(key, label, payload, target) {
    const view = payload?.state || {};
    const date = normalizeDate(view.reportDate || payload?.reportDate || '');
    const snapshotStatus = String(view.snapshotStatus || payload?.snapshotStatus || '').toUpperCase();
    const runStatus = String(view.runStatus || view.currentRun?.status || '').toLowerCase();
    const processing = view.processing || {};
    const total = Number(view.total ?? view.dailyParseSummary?.totalRecognized ?? 0);
    let state = 'pending';
    if (date === target && (COMPLETE_SNAPSHOT.has(snapshotStatus) || view.completed === true)) state = 'done';
    else if (date === target && (runStatus === 'running' || processing.running)) state = 'running';
    else if (date === target && (runStatus === 'paused' || processing.paused)) state = 'paused';
    else if (date === target && (runStatus === 'failed' || processing.error)) state = 'failed';
    return { key, label, state, date, snapshotStatus, runStatus, total };
  }

  function stageText(stage) {
    if (stage.state === 'done') return `${stage.label} 已完成`;
    if (stage.state === 'running') return `${stage.label} 处理中`;
    if (stage.state === 'paused') return `${stage.label} 已暂停`;
    if (stage.state === 'failed') return `${stage.label} 失败`;
    return `${stage.label} 待处理`;
  }

  function pillClass(stage) {
    if (stage.state === 'done') return 'success';
    if (stage.state === 'failed') return 'danger';
    if (stage.state === 'running' || stage.state === 'paused') return 'warning';
    return 'muted';
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

  function renderTruth(truth) {
    const node = ensureSummaryNode();
    if (!node || !truth) return;
    const stages = truth.stages || [];
    node.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <strong style="color:#0b3158">七业务处理状态</strong>
        ${stages.map(stage => `<span class="status-pill ${pillClass(stage)}">${stageText(stage)}</span>`).join('')}
        <span class="status-pill ${truth.complete ? 'success' : 'muted'}">${truth.complete ? '七业务已完成' : '尚未全部完成'}</span>
      </div>`;

    const start = document.querySelector('[data-testid="global-auto-process"]');
    const resume = document.querySelector('button[onclick="resumeUnified()"]');
    if (truth.complete) {
      if (start) {
        start.dataset.v168Locked = '1';
        start.disabled = true;
        start.textContent = '七业务已完成';
        start.title = `${truth.reportDate} CCSL、SHOPEE、WHPP均已有正式结果，无需重复处理`;
      }
      if (resume) {
        resume.dataset.v168Locked = '1';
        resume.disabled = true;
        resume.title = '七业务均已完成，无需继续处理';
      }
    } else {
      if (start?.dataset.v168Locked === '1') {
        delete start.dataset.v168Locked;
        start.disabled = false;
        start.textContent = '开始全自动处理';
        start.title = '';
      }
      if (resume?.dataset.v168Locked === '1') {
        delete resume.dataset.v168Locked;
        resume.disabled = false;
        resume.title = '';
      }
    }
  }

  async function refreshTruth() {
    if (refreshBusy) return lastTruth;
    const target = targetDate();
    if (!target) return lastTruth;
    refreshBusy = true;
    try {
      const [ccsl, shopee, whpp] = await Promise.all([
        readJson(`/api/run/status/${encodeURIComponent(target)}`),
        readJson('/api/business-state/SHOPEE?compact=1'),
        readJson('/api/business-state/WHPP?compact=1')
      ]);
      const stages = [
        stageFromCcsl(ccsl, target),
        stageFromBusiness('SHOPEE', 'SHOPEE CN/VN', shopee, target),
        stageFromBusiness('WHPP', 'WHPP本土', whpp, target)
      ];
      lastTruth = { reportDate: target, stages, complete: stages.every(stage => stage.state === 'done'), checkedAt: Date.now() };
      renderTruth(lastTruth);
      return lastTruth;
    } catch (error) {
      console.warn('[CE-QC][V168] seven-business truth refresh failed:', error?.message || error);
      return lastTruth;
    } finally {
      refreshBusy = false;
    }
  }

  function wrapRunner(name) {
    const original = global[name];
    if (typeof original !== 'function' || original.__ceQcV168Wrapped) return false;
    const wrapped = async function v168NoDuplicateRun(...args) {
      const truth = await refreshTruth();
      if (truth?.complete) {
        renderTruth(truth);
        const status = document.getElementById('ccslRunStatus');
        if (status) status.innerHTML = '<span class="status-pill success">七业务均已有正式结果，本次未重复请求接口。</span>';
        return { ok: true, skipped: true, code: 'SEVEN_BUSINESS_ALREADY_COMPLETED', reportDate: truth.reportDate };
      }
      return original.apply(this, args);
    };
    wrapped.__ceQcV168Wrapped = true;
    wrapped.__ceQcV168Original = original;
    global[name] = wrapped;
    return true;
  }

  function wrapRunnersWhenReady(attempt = 0) {
    const a = wrapRunner('runUnified');
    const b = wrapRunner('resumeUnified');
    if ((!a || !b) && attempt < 20) setTimeout(() => wrapRunnersWhenReady(attempt + 1), 100);
  }

  function schedule() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      const page = document.getElementById('importPage');
      if (page && !page.hidden && document.visibilityState === 'visible') refreshTruth();
    }, 30000);
  }

  function install() {
    wrapRunnersWhenReady();
    setTimeout(refreshTruth, 400);
    document.addEventListener('ce-qc-run-complete', () => setTimeout(refreshTruth, 150));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') setTimeout(refreshTruth, 100);
    });
    schedule();
    global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__ = { version: VERSION, refresh: refreshTruth, get lastTruth() { return lastTruth; } };
    console.info('[CE-QC][V168_SEVEN_BUSINESS_STATUS]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(window);
