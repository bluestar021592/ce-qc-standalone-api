(function installV139CarryManualWindow(global) {
  if (global.__CE_QC_V139_CARRY_MANUAL_WINDOW__) return;
  global.__CE_QC_V139_CARRY_MANUAL_WINDOW__ = true;
  const VERSION = '2026-08-16-v139-carry-manual-window-v3';
  let busy = false;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;' }[ch]));
  }
  function fmt(value) { return Number(value || 0).toLocaleString('zh-CN'); }
  function visibleImportPage() {
    return location.pathname === '/import' || document.getElementById('importPage')?.hidden === false || document.getElementById('importPage')?.classList?.contains('active');
  }

  function installLayoutStyle() {
    if (document.getElementById('v139ImportLayoutStyle')) return;
    const style = document.createElement('style');
    style.id = 'v139ImportLayoutStyle';
    style.textContent = `
      #importPage .operations-dashboard {
        display: grid !important;
        grid-template-columns: minmax(430px, .92fr) minmax(540px, 1.08fr) !important;
        grid-template-areas:
          "import summary"
          "run carry" !important;
        gap: 12px !important;
        align-items: start !important;
      }
      #importPage #unifiedImport { grid-area: import; align-self: start !important; }
      #importPage #runPanel { grid-area: run; align-self: start !important; }
      #importPage #v139CarryManualPanel { grid-area: carry; align-self: start !important; }
      #importPage .unified-summary-panel {
        grid-area: summary;
        min-height: 0 !important;
        height: auto !important;
        align-self: start !important;
      }
      #importPage .unified-summary-panel #unifiedClassificationSummary {
        min-height: 0 !important;
        height: auto !important;
      }
      #importPage .unified-summary-panel .empty-state,
      #importPage .unified-summary-panel .empty-state.compact {
        min-height: 170px !important;
        padding: 28px 18px !important;
      }
      #importPage #v139CarryManualPanel .preview-table-wrap {
        max-height: 300px;
        overflow: auto;
      }
      #importPage #v139CarryManualPanel .empty-state { min-height: 120px !important; }
      @media (max-width: 1280px) {
        #importPage .operations-dashboard {
          grid-template-columns: 1fr !important;
          grid-template-areas:
            "import"
            "summary"
            "run"
            "carry" !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function host() {
    installLayoutStyle();
    const page = document.getElementById('importPage');
    if (!page) return null;
    let panel = document.getElementById('v139CarryManualPanel');
    if (panel) return panel;
    const runPanel = document.getElementById('ccslRunStatus')?.closest('section,article,.panel');
    panel = document.createElement('section');
    panel.id = 'v139CarryManualPanel';
    panel.className = 'panel operation-panel';
    panel.innerHTML = `
      <div class="panel-title"><div><h3>跨日遗留独立处理</h3><p>历史跨日遗留不再进入当日日报全自动；这里只在你手动点击时复查。</p></div><span class="status-pill muted">独立队列</span></div>
      <div class="unified-count-grid" id="v139CarrySummary"></div>
      <div class="button-row" style="align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px">
        <label>业务 <select id="v139CarryBusiness" style="min-width:150px"><option value="ALL">全部业务</option><option value="CE">CE</option><option value="CEAF">CEAF</option><option value="TBKH">TBKH</option><option value="ALI1688">ALI1688</option><option value="SHOPEECN">SHOPEE CN</option><option value="SHOPEEVN">SHOPEE VN</option></select></label>
        <button id="v139CarryRefresh" class="btn ghost compact" type="button">刷新遗留</button>
        <button id="v139CarryRun" class="btn primary" type="button">手动复查下一批200票</button>
      </div>
      <div id="v139CarryStatus" class="operation-status" style="margin-top:10px"></div>
      <div id="v139CarryPreview" class="preview-table-wrap" style="margin-top:10px"></div>`;
    if (runPanel?.parentElement) runPanel.insertAdjacentElement('afterend', panel);
    else page.appendChild(panel);
    panel.querySelector('#v139CarryRefresh')?.addEventListener('click', () => load());
    panel.querySelector('#v139CarryRun')?.addEventListener('click', () => run());
    panel.querySelector('#v139CarryBusiness')?.addEventListener('change', () => load());
    return panel;
  }

  async function json(url, options = {}) {
    const response = await fetch(url, { cache:'no-store', credentials:'same-origin', ...options });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok || payload.ok === false) throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    return payload;
  }

  function syncDailyQueueSummary(summary = {}) {
    try {
      if (typeof unifiedImportState === 'undefined' || !unifiedImportState) return;
      const carry = unifiedImportState.carryover || {};
      const todayOpen = Number(carry.todayOpen || 0);
      unifiedImportState.carryover = {
        ...carry,
        currentOpen: todayOpen,
        historicalOpen: Number(summary.historicalOpen || carry.historicalOpen || 0),
        cumulativeHistorical: Number(summary.cumulativeHistorical || carry.cumulativeHistorical || 0),
        historicalClosed: Number(summary.historicalClosed || carry.historicalClosed || 0),
        historicalSeparate: true
      };
      if (typeof renderUnifiedImportResult === 'function') renderUnifiedImportResult();
      const statusRoot = document.getElementById('fileStatus');
      if (statusRoot) {
        for (const node of statusRoot.querySelectorAll('p,span,div')) {
          if (node.childElementCount === 0 && /当前处理队列/.test(node.textContent || '')) {
            node.textContent = String(node.textContent || '').replace('当前处理队列', '当日自动处理队列');
          }
        }
      }
    } catch (error) {
      console.warn('[CE-QC][V139] daily queue summary sync skipped', error);
    }
  }

  function render(payload) {
    const panel = host();
    if (!panel) return;
    const s = payload.summary || {};
    syncDailyQueueSummary(s);
    const by = s.byBusiness || {};
    panel.querySelector('#v139CarrySummary').innerHTML = [
      ['当前历史未闭环', s.historicalOpen],
      ['累计进入过跨日', s.cumulativeHistorical],
      ['历史已闭环', s.historicalClosed],
      ['最早未闭环日期', s.oldestOpenDate || '—']
    ].map(([label,value]) => `<div><span>${escapeHtml(label)}</span><b>${typeof value === 'number' ? fmt(value) : escapeHtml(value)}</b></div>`).join('');
    const rows = payload.rows || [];
    panel.querySelector('#v139CarryPreview').innerHTML = rows.length
      ? `<table class="preview-table"><thead><tr><th>来源日期</th><th>业务</th><th>运单号</th><th>当前分类</th><th>最后节点</th><th>API状态</th></tr></thead><tbody>${rows.slice(0,30).map(row => `<tr><td>${escapeHtml(row.sourceReportDate || '')}</td><td>${escapeHtml(row.businessType || '')}</td><td>${escapeHtml(row.shipmentCode || '')}</td><td>${escapeHtml(row.category || '待复查')}</td><td>${escapeHtml(row.latestNode || '—')}</td><td>${escapeHtml(row.apiStatus || '—')}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty-state">当前筛选范围没有历史跨日未闭环。</div>';
    const parts = Object.entries(by).filter(([,value]) => Number(value || 0) > 0).map(([key,value]) => `${key} ${fmt(value)}`);
    panel.querySelector('#v139CarryStatus').innerHTML = `<span class="status-pill success">当日日报已与跨日遗留分离</span><p>历史遗留：${parts.join(' · ') || '0'}。手动复查每次最多200票，不会加入当天全自动任务。</p><p class="muted">扫描/轨迹请求失败会自动补偿重试至少3轮，仍失败的票继续保留在这里。</p>`;
  }

  async function load() {
    if (!visibleImportPage()) return;
    const panel = host();
    if (!panel) return;
    const business = panel.querySelector('#v139CarryBusiness')?.value || 'ALL';
    try {
      const payload = await json(`/api/v139/carryover?businessType=${encodeURIComponent(business)}&limit=200`);
      render(payload);
    } catch (error) {
      panel.querySelector('#v139CarryStatus').innerHTML = `<span class="status-pill danger">跨日遗留读取失败：${escapeHtml(error.message)}</span>`;
    }
  }

  async function run() {
    if (busy) return;
    const panel = host();
    if (!panel) return;
    busy = true;
    const button = panel.querySelector('#v139CarryRun');
    const business = panel.querySelector('#v139CarryBusiness')?.value || 'ALL';
    if (button) { button.disabled = true; button.textContent = '正在复查跨日遗留…'; }
    panel.querySelector('#v139CarryStatus').innerHTML = '<span class="status-pill warning">正在手动复查下一批，日常全自动不受影响…</span>';
    try {
      const payload = await json('/api/v139/carryover/recheck', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ businessType: business, limit: 200 })
      });
      panel.querySelector('#v139CarryStatus').innerHTML = `<span class="status-pill success">本批复查完成</span><p>处理 ${fmt(payload.processed)} 票 · 本批闭环 ${fmt(payload.closed)} · 仍未闭环 ${fmt(payload.stillOpen)} · 扫描失败 ${fmt(payload.scanFailed)} · 轨迹失败 ${fmt(payload.trackFailed)}</p>`;
      await load();
    } catch (error) {
      panel.querySelector('#v139CarryStatus').innerHTML = `<span class="status-pill danger">跨日复查失败：${escapeHtml(error.message)}</span><p>已完成结果不会丢失，可稍后再次点击。</p>`;
    } finally {
      busy = false;
      if (button) { button.disabled = false; button.textContent = '手动复查下一批200票'; }
    }
  }

  function ensure() {
    if (!visibleImportPage()) return;
    installLayoutStyle();
    host();
    load();
  }
  document.addEventListener('click', event => {
    if (event.target?.closest?.('[data-page="import"],.side-link[data-path="/import"]')) setTimeout(ensure, 120);
  }, true);
  document.addEventListener('ce-qc-run-complete', () => setTimeout(load, 200));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(ensure, 100), { once:true });
  else setTimeout(ensure, 100);
  console.info('[CE-QC][V139_CARRY_MANUAL_WINDOW]', VERSION);
})(window);
