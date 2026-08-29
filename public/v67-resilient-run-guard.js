(function installResilientRunGuardV67(global) {
  if (global.__CE_QC_V67_RESILIENT_RUN_GUARD__) return;

  const VERSION = '2026-08-29-v354-authoritative-three-stage-resume-v1';
  const COMPLETE_SNAPSHOT = new Set(['COMPLETED', 'COMPLETED_WITH_RETRY']);
  let busy = false;

  function wait(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0)))); }
  function normalizeDate(value) {
    const text = String(value || '').trim().replace(/\//g, '-').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  }
  function targetDate() {
    const importPage = location.pathname === '/import' || document.getElementById('importPage')?.classList?.contains('active');
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

  async function jsonFetch(url, options = {}) {
    let response;
    try {
      response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options });
    } catch (cause) {
      const error = new Error('与后台连接中断');
      error.code = 'NETWORK_CONNECTION_INTERRUPTED';
      error.cause = cause;
      throw error;
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
    return jsonFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
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
    return ['NETWORK_CONNECTION_INTERRUPTED','ECONNRESET','ECONNABORTED','ETIMEDOUT'].includes(code)
      || [408,425,429,500,502,503,504].includes(status)
      || /socket hang up|connection reset|timeout|timed out|failed to fetch|fetch failed|连接中断|网络中断/i.test(message);
  }

  function alreadyDone(error) {
    return ['RUN_ALREADY_COMPLETED'].includes(String(error?.code || ''))
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

  function statusNode() { return document.getElementById('ccslRunStatus'); }
  function runButton() { return document.querySelector('[data-testid="global-auto-process"]'); }

  function setUnifiedStage(type, active, reportDate) {
    global.__CE_QC_UNIFIED_RUN_STAGE__ = {
      owner: 'V67',
      type: String(type || ''),
      active: Boolean(active),
      reportDate: normalizeDate(reportDate),
      updatedAt: Date.now()
    };
  }

  function setStatus(text, level = 'warning') {
    const node = statusNode();
    if (node) {
      node.dataset.v67UnifiedOwner = '1';
      const reportDate = normalizeDate(global.__CE_QC_UNIFIED_RUN_STAGE__?.reportDate);
      if (reportDate) node.dataset.v67UnifiedReportDate = reportDate;
      node.innerHTML = `<span class="status-pill ${level}">${String(text || '')}</span>`;
    }
  }

  function setBusy(value, text = '') {
    busy = Boolean(value);
    const button = runButton();
    if (button) {
      button.disabled = busy;
      button.textContent = busy ? (text || '七业务处理中…') : '开始全自动处理';
    }
  }

  async function readWhppSummary(target) {
    const query = target ? `?reportDate=${encodeURIComponent(target)}` : '';
    return jsonFetch(`/api/v132/whpp-fast-summary${query}`);
  }

  function whppCompletion(payload, target) {
    const state = payload?.state || {};
    const date = normalizeDate(state.reportDate || payload?.reportDate || payload?.reportDateLocal || '');
    const total = Number(state.total ?? payload?.total ?? state.dailyParseSummary?.totalRecognized ?? 0);
    const snapshotStatus = String(state.snapshotStatus || payload?.snapshotStatus || '').toUpperCase();
    const completed = Boolean(state.completed === true || payload?.completed === true || COMPLETE_SNAPSHOT.has(snapshotStatus));
    const retryPending = Number(payload?.metrics?.retryPending ?? state?.metrics?.retryPending ?? 0);
    return { date, total, snapshotStatus, completed, retryPending, reportDate: date || target };
  }

  async function verifyWhpp(target) {
    const payload = await readWhppSummary(target);
    const truth = whppCompletion(payload, target);
    if (target && truth.date && truth.date !== target) {
      const error = new Error(`WHPP当前正式结果日期为${truth.date}，等待${target}完成。`);
      error.code = 'WHPP_SUMMARY_DATE_MISMATCH';
      throw error;
    }
    if (!truth.completed) {
      const error = new Error(truth.total > 0
        ? `WHPP本土${truth.total}票仍在生成正式快照，七业务不能提前标记完成。`
        : 'WHPP本土当前尚未返回明确完成标记；0票也不能在没有正式完成语义时自动跳过。');
      error.code = 'WHPP_STAGE_NOT_FINALIZED';
      throw error;
    }
    return { label: 'WHPP本土', ok: true, verified: true, ...truth };
  }

  async function canonicalStageTruth(stage, target) {
    try {
      if (stage.key === 'CCSL') {
        const payload = await postJson('/api/v317/ccsl-recovery', { action: 'status', reportDate: target || '' });
        const date = normalizeDate(payload?.reportDate || target);
        return { done: Boolean((!target || date === target) && payload?.complete === true), date, payload };
      }
      if (stage.key === 'SHOPEE') {
        const payload = await postJson('/api/v311/shopee-recovery', { action: 'status', reportDate: target || '' });
        const date = normalizeDate(payload?.reportDate || target);
        return { done: Boolean((!target || date === target) && payload?.complete === true), date, payload };
      }
      if (stage.key === 'WHPP') {
        const verified = await verifyWhpp(target);
        return { done: true, date: normalizeDate(verified.reportDate || target), payload: verified };
      }
    } catch (error) {
      if (isAuth(error)) throw error;
      return { done: false, error };
    }
    return { done: false };
  }

  function whppStillPending(error) {
    return ['WHPP_STAGE_NOT_FINALIZED','WHPP_SUMMARY_DATE_MISMATCH'].includes(String(error?.code || ''));
  }

  async function waitForWhppFinalized(target, timeoutMs = 10 * 60 * 1000) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        return await verifyWhpp(target);
      } catch (error) {
        if (isAuth(error)) throw error;
        if (!whppStillPending(error) && !isTransient(error)) throw error;
        lastError = error;
      }

      const progress = await jsonFetch('/api/whpp/progress').catch(() => null);
      const processing = progress?.processing || {};
      const runtime = progress?.runtime || {};
      const phase = String(processing.phase || runtime.lastMessage || '扫描/轨迹');
      const batchIndex = Number(processing.batchIndex || runtime.batchIndex || 0);
      const totalBatches = Number(processing.totalBatches || runtime.totalBatches || 0);
      if (processing.error && !processing.running && !processing.paused) {
        throw new Error(String(processing.error));
      }
      setStatus(`WHPP本土处理中：${phase}${batchIndex && totalBatches ? ` · ${batchIndex}/${totalBatches}` : ''}`);
      await wait(1200);
    }
    const error = new Error(lastError?.message || 'WHPP后台任务超过10分钟仍未生成正式快照，断点已保留，可继续处理。');
    error.code = lastError?.code || 'WHPP_FINALIZE_TIMEOUT';
    throw error;
  }

  async function waitForWhppActiveRun(target, timeoutMs = 10 * 60 * 1000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const progress = await jsonFetch('/api/whpp/progress').catch(() => null);
      const processing = progress?.processing || {};
      if (!processing.running && !processing.paused) return waitForWhppFinalized(target, Math.max(1000, deadline - Date.now()));
      setStatus(`WHPP本土已有任务，正在等待当前任务完成… ${Number(processing.batchIndex || 0)}/${Number(processing.totalBatches || 0)}`);
      await wait(1000);
    }
    throw new Error('WHPP本土已有任务超过10分钟未完成，已停止把它当作成功。');
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
        if (stage.key === 'WHPP') return await waitForWhppFinalized(target);
        return { label: stage.label, ok: true };
      } catch (error) {
        if (alreadyDone(error)) {
          if (stage.key === 'WHPP') return await waitForWhppFinalized(target);
          return { label: stage.label, ok: true, skipped: true };
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
    if (busy) return;
    const target = targetDate();
    setUnifiedStage('CCSL', true, target);
    setBusy(true, `正在启动 ${target || '当日'} 七业务处理…`);
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
        setUnifiedStage(stage.key, true, target);
        setBusy(true, `${stage.label}处理中…`);
        const truth = await canonicalStageTruth(stage, target);
        if (truth.done) {
          setStatus(`第 ${index + 1}/3 步：${stage.label}已有正式结果，跳过重复处理，继续下一阶段`);
          results.push({ label: stage.label, ok: true, skipped: true, canonicalComplete: true });
          continue;
        }
        setStatus(`第 ${index + 1}/3 步：${stage.label}正在处理，完成后自动进入下一步`);
        const result = await runStage(stage, mode === 'resume', target);
        results.push(result);
        if (result.ok === false) break;
      }

      const failed = results.filter(item => item.ok === false);
      const allThreeResolved = results.length === 3 && failed.length === 0;
      if (!allThreeResolved) {
        setUnifiedStage('FAILED', false, target);
        const message = failed.length
          ? failed.map(item => `${item.label}：${item.error || '失败'}`).join('；')
          : '尚有阶段未完成';
        setStatus(`七业务未全部完成：${message}。已完成断点保留。`, 'danger');
      } else {
        setUnifiedStage('DONE', false, target);
        setStatus('七业务当日日报处理完成：CCSL → SHOPEE → WHPP均已验证正式结果。', 'success');
      }
      document.dispatchEvent(new CustomEvent('ce-qc-run-complete', { detail: { results, reportDate: target, complete: allThreeResolved } }));
      try { if (typeof global.refresh === 'function') await global.refresh(); } catch {}
      return { ok: allThreeResolved, results, reportDate: target };
    } catch (error) {
      setUnifiedStage('ERROR', false, target);
      const text = isAuth(error)
        ? 'CE登录已失效，请重新登录后点击继续处理；已完成断点不会丢失。'
        : `处理连接异常：${String(error.message || error)}；已完成断点不会丢失。`;
      setStatus(text, 'danger');
      return { ok: false, error: error.message || String(error), results };
    } finally {
      setBusy(false);
    }
  }

  function install() {
    global.runUnified = () => execute('start');
    global.resumeUnified = () => execute('resume');
    global.__CE_QC_V67_RESILIENT_RUN_GUARD__ = { version: VERSION, run: execute, targetDate, verifyWhpp, readWhppSummary, canonicalStageTruth };
    console.info('[CE-QC][V354_THREE_STAGE_RUNNER]', VERSION, 'V67 is the single run/resume owner; completed CCSL/SHOPEE stages are skipped and WHPP requires explicit canonical completion even at 0 tickets.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0), { once: true });
  else setTimeout(install, 0);
})(window);
