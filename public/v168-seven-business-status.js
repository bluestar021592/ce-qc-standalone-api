(function installSevenBusinessStatusV168(global) {
  if (global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__) return;

  const VERSION = '2026-08-27-v333-canonical-seven-business-owner-v1';
  const ARCHITECTURE = '2026-08-29-single-unified-runner-status-only-v1';
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

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify(body || {})
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || payload.ok === false) throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    return payload;
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
      details: payload?.zeroTicketDay ? 'VALID日报CCSL=0票，已闭环' : String(payload?.action || '')
    };
  }

  function stageFromShopeeRecovery(payload, target) {
    const date = normalizeDate(payload?.reportDate || target);
    const lockStatus = String(payload?.lock?.status || '').toLowerCase();
    let state = 'pending';
    if (date === target && payload?.complete === true) state = 'done';
    else if (date === target && lockStatus === 'running') state = 'running';
    else if (date === target && lockStatus === 'paused') state = 'paused';
    else if (date === target && lockStatus === 'failed') state = 'failed';
    return {
      key: 'SHOPEE', label: 'SHOPEE CN/VN', state, date,
      complete: payload?.complete === true,
      runStatus: lockStatus,
      snapshotId: String(payload?.snapshotId || ''),
      details: payload?.complete === true ? 'VALID + COMPLETED 正式快照' : String(payload?.reason || '')
    };
  }

  function stageFromWhpp(payload, target) {
    const view = payload?.state || {};
    const date = normalizeDate(view.reportDate || payload?.reportDate || '');
    const snapshotStatus = String(view.snapshotStatus || payload?.snapshotStatus || '').toUpperCase();
    const runStatus = String(view.runStatus || view.currentRun?.status || '').toLowerCase();
    const processing = view.processing || {};
    const total = Number(view.total ?? payload?.total ?? view.dailyParseSummary?.totalRecognized ?? 0);
    let state = 'pending';
    if (date === target && (COMPLETE_SNAPSHOT.has(snapshotStatus) || view.completed === true || payload?.completed === true)) state = 'done';
    else if (date === target && (runStatus === 'running' || processing.running)) state = 'running';
    else if (date === target && (runStatus === 'paused' || processing.paused)) state = 'paused';
    else if (date === target && (runStatus === 'failed' || processing.error)) state = 'failed';
    return {
      key: 'WHPP', label: 'WHPP本土', state, date, snapshotStatus, runStatus, total,
      details: String(payload?.summarySource || payload?.truthSource || '')
    };
  }

  function failedStage(key, label, error) {
    return { key, label, state: 'error', date: '', total: 0, error: String(error?.message || error || '状态读取失败') };
  }

  function stageText(stage) {
    if (stage.state === 'done') return `${stage.label} 已完成`;
    if (stage.state === 'running') return `${stage.label} 处理中`;
    if (stage.state === 'paused') return `${stage.label} 已暂停`;
    if (stage.state === 'failed') return `${stage.label} 失败`;
    if (stage.state === 'error') return `${stage.label} 状态读取失败`;
    return `${stage.label} 待处理`;
  }

  function pillClass(stage) {
    if (stage.state === 'done') return 'success';
    if (stage.state === 'failed' || stage.state === 'error') return 'danger';
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
    node.dataset.v333Owner = 'canonical';
    node.dataset.executionOwner = 'V67';
    node.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <strong style="color:#0b3158">七业务处理状态</strong>
        ${stages.map(stage => `<span class="status-pill ${pillClass(stage)}" title="${stage.details || stage.error || ''}">${stageText(stage)}</span>`).join('')}
        <span class="status-pill ${truth.complete ? 'success' : 'muted'}">${truth.complete ? '七业务已完成' : '尚未全部完成'}</span>
      </div>`;

    const start = document.querySelector('[data-testid="global-auto-process"]');
    const resume = document.querySelector('button[onclick="resumeUnified()"]');
    if (truth.complete) {
      if (start) {
        start.dataset.v168Locked = '1';
        start.disabled = true;
        start.textContent = '七业务已完成';
        start.title = `${truth.reportDate} CCSL、SHOPEE CN/VN、WHPP均已有正式结果，无需重复处理`;
      }
      if (resume) {
        resume.dataset.v168Locked = '1';
        resume.disabled = true;
        resume.title = '七业务均已完成，无需继续处理';
      }
      return;
    }
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
      const requests = await Promise.allSettled([
        postJson('/api/v317/ccsl-recovery', { action: 'status', reportDate: target }),
        postJson('/api/v311/shopee-recovery', { action: 'status', reportDate: target }),
        readJson(`/api/v132/whpp-fast-summary?reportDate=${encoded}`)
      ]);
      const ccsl = requests[0].status === 'fulfilled'
        ? stageFromCcslRecovery(requests[0].value, target)
        : failedStage('CCSL', 'CCSL', requests[0].reason);
      const shopee = requests[1].status === 'fulfilled'
        ? stageFromShopeeRecovery(requests[1].value, target)
        : failedStage('SHOPEE', 'SHOPEE CN/VN', requests[1].reason);
      const whpp = requests[2].status === 'fulfilled'
        ? stageFromWhpp(requests[2].value, target)
        : failedStage('WHPP', 'WHPP本土', requests[2].reason);
      const stages = [ccsl, shopee, whpp];
      lastTruth = { reportDate: target, stages, complete: stages.every(stage => stage.state === 'done'), checkedAt: Date.now() };
      renderTruth(lastTruth);
      return lastTruth;
    } catch (error) {
      lastTruth = {
        reportDate: targetDate() || normalizeDate(lastTruth?.reportDate),
        stages: [failedStage('CCSL', 'CCSL', error), failedStage('SHOPEE', 'SHOPEE CN/VN', error), failedStage('WHPP', 'WHPP本土', error)],
        complete: false,
        checkedAt: Date.now()
      };
      renderTruth(lastTruth);
      console.warn('[CE-QC][V168_STATUS_ONLY] seven-business truth refresh failed:', error?.message || error);
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
    }, 2000);
  }

  function install() {
    [150, 600, 1600].forEach(ms => setTimeout(() => { void refreshTruth(); }, ms));
    document.addEventListener('ce-qc-run-complete', () => setTimeout(() => { void refreshTruth(); }, 100));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') setTimeout(() => { void refreshTruth(); }, 80);
    });
    document.addEventListener('click', event => {
      if (event.target?.closest?.('.side-link[data-page],#topRangeQuery,.top-range-query')) setTimeout(() => { void refreshTruth(); }, 120);
    }, true);
    schedule();
    global.__CE_QC_V168_SEVEN_BUSINESS_STATUS__ = {
      version: VERSION,
      architecture: ARCHITECTURE,
      statusOnly: true,
      authoritativeRunner: 'V67',
      refresh: refreshTruth,
      get lastTruth() { return lastTruth; }
    };
    console.info('[CE-QC][V168_STATUS_ONLY]', VERSION, ARCHITECTURE, 'V168 only renders canonical CCSL/SHOPEE/WHPP status; it never wraps or starts unified processing. V67 exclusively owns run/resume.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(window);
