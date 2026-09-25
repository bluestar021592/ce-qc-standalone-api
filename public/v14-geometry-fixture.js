window.__V14_GEOMETRY_FIXTURE__ = Object.freeze({
  sidebar: { x: 0, y: 0, width: 250, height: 1024 },
  topbar: { x: 250, y: 0, width: 1286, height: 64 },
  'business-card-total': { x: 268, y: 88, width: 200, height: 112 },
  'business-card-ce': { x: 478, y: 88, width: 200, height: 112 },
  'business-card-tbkh': { x: 688, y: 88, width: 200, height: 112 },
  'business-card-shopeecn': { x: 898, y: 88, width: 200, height: 112 },
  'business-card-shopeevn': { x: 1108, y: 88, width: 200, height: 112 },
  'business-card-ali1688': { x: 1318, y: 88, width: 200, height: 112 },
  'core-metrics': { x: 268, y: 210, width: 1250, height: 150 },
  'shopee-special': { x: 268, y: 370, width: 558, height: 300 },
  'dispatch-probability': { x: 836, y: 370, width: 682, height: 300 },
  'trend-ticket': { x: 268, y: 680, width: 304, height: 314 },
  'trend-pod': { x: 584, y: 680, width: 304, height: 314 },
  'trend-oc': { x: 899, y: 680, width: 304, height: 314 },
  'trend-first': { x: 1215, y: 680, width: 304, height: 314 }
});

function applyV16TestIds() {
  const selectors = {
    'business-card-total': '#homeBusinessCards > :nth-child(1)',
    'business-card-ce': '#homeBusinessCards > :nth-child(2)',
    'business-card-tbkh': '#homeBusinessCards > :nth-child(3)',
    'business-card-shopeecn': '#homeBusinessCards > :nth-child(4)',
    'business-card-shopeevn': '#homeBusinessCards > :nth-child(5)',
    'business-card-ali1688': '#homeBusinessCards > :nth-child(6)',
    'core-metrics': '.home-core-panel',
    'shopee-special': '.home-special-row > :nth-child(1)',
    'dispatch-probability': '.home-special-row > :nth-child(2)',
    'trend-ticket': '#homeTrendGrid > :nth-child(1)',
    'trend-pod': '#homeTrendGrid > :nth-child(2)',
    'trend-oc': '#homeTrendGrid > :nth-child(3)',
    'trend-first': '#homeTrendGrid > :nth-child(4)'
  };
  Object.entries(selectors).forEach(([testId, selector]) => {
    document.querySelector(selector)?.setAttribute('data-testid', testId);
  });
}

if (new URLSearchParams(location.search).has('visualTest')) {
  applyV16TestIds();
  new MutationObserver(applyV16TestIds).observe(document.getElementById('homePage'), { childList: true, subtree: true });
}

(function installV19StabilityGuard() {
  if (new URLSearchParams(location.search).has('visualTest')) return;

  function selectedUnifiedDate() {
    try {
      if (typeof historyModeDate !== 'undefined' && historyModeDate) return String(historyModeDate);
    } catch {}
    try {
      if (typeof unifiedImportState !== 'undefined' && unifiedImportState?.reportDate) return String(unifiedImportState.reportDate);
    } catch {}
    const selected = document.getElementById('topHistoryDate')?.value;
    return String(selected || '');
  }

  function emptyExactBusinessState(type, reportDate) {
    return {
      businessType: type,
      viewBusinessType: type,
      reportDate: reportDate || '',
      snapshotId: '',
      snapshotStatus: 'UNAVAILABLE',
      dailyReportReady: false,
      pnhBills: [],
      carryBills: [],
      podLocks: [],
      scanPool: [],
      scanResults: [],
      needTrackBills: [],
      trackResults: [],
      trackEvents: [],
      finalRows: [],
      nextCarryBills: [],
      dailyParseRows: [],
      dailyParseSummary: { totalRecognized: 0 },
      detailTabs: {},
      processing: { running: false, paused: false, phase: '' },
      __exactBusinessUnavailable: true
    };
  }

  if (typeof currentBusinessState === 'function' && typeof currentBusinessType === 'function') {
    currentBusinessState = function v19CurrentBusinessState() {
      const type = currentBusinessType();
      const selectedDate = selectedUnifiedDate();
      let exact = null;
      try { exact = typeof businessStates !== 'undefined' ? businessStates?.[type] : null; } catch {}
      if (exact && (!selectedDate || !exact.reportDate || String(exact.reportDate) === selectedDate)) return exact;
      return emptyExactBusinessState(type, selectedDate);
    };
  }

  let recoveryTimer = null;
  let recoveryRunning = false;

  async function tryRecoverBackend() {
    if (recoveryRunning) return;
    recoveryRunning = true;
    try {
      const healthy = typeof rawHealthProbe === 'function' ? await rawHealthProbe(2500) : false;
      if (!healthy) return;
      if (recoveryTimer) {
        clearInterval(recoveryTimer);
        recoveryTimer = null;
      }
      if (typeof refresh === 'function') await refresh();
      try {
        if (typeof processingNotice !== 'undefined') {
          processingNotice = { type: 'SYSTEM', level: 'success', message: '后台服务已自动恢复，页面数据已重新同步。' };
        }
      } catch {}
      if (typeof renderAll === 'function') renderAll();
    } catch (error) {
      console.warn('[V19] backend recovery retry failed', error);
    } finally {
      recoveryRunning = false;
    }
  }

  function startBackendRecovery() {
    if (recoveryTimer) return;
    recoveryTimer = setInterval(() => { void tryRecoverBackend(); }, 3000);
    void tryRecoverBackend();
  }

  if (typeof api === 'function') {
    const originalApi = api;
    api = async function v19ResilientApi(url, options = {}) {
      try {
        return await originalApi(url, options);
      } catch (error) {
        if (error?.code === 'NETWORK_CONNECTION_INTERRUPTED') startBackendRecovery();
        throw error;
      }
    };
  }

  window.addEventListener('online', startBackendRecovery);
  window.__CE_QC_START_BACKEND_RECOVERY__ = startBackendRecovery;
})();

(function installManualRefreshAndNoTrendMode(){
  if (new URLSearchParams(location.search).has('visualTest')) return;

  window.__CE_QC_LIVE_TRENDS_DISABLED__ = true;
  const trendSelectors = ['#homeTrendGrid','#ccslTrendGrid','#shopeeRecipientTrends','#shopeeTrendGrid','.v18-trend-section','#v27ForcedAttemptTrend','#v27ForcedHomeAttemptTrends','.v27-force-trend','.v27-force-attempt'];
  function suppressLegacyTrends(){
    trendSelectors.forEach(selector => document.querySelectorAll(selector).forEach(node => {
      node.hidden = true;
      node.setAttribute('aria-hidden','true');
      node.innerHTML = '';
    }));
  }

  suppressLegacyTrends();
  try {
    const style=document.createElement('style');
    style.id='ce-qc-v582-no-live-trends';
    style.textContent=trendSelectors.join(',')+'{display:none!important}';
    document.head.appendChild(style);
  } catch {}
  [250,1000,3000].forEach(ms=>setTimeout(suppressLegacyTrends,ms));

  if (typeof renderHomeTrends === 'function') renderHomeTrends = function(){ return ''; };
  if (typeof renderShopeeRecipientTrends === 'function') renderShopeeRecipientTrends = function(){ return ''; };

  function ensureManualRefreshButton(){
    const actions=document.querySelector('.top-actions');
    if(!actions||document.getElementById('manualLatestDataRefresh'))return;
    const button=document.createElement('button');
    button.id='manualLatestDataRefresh';
    button.type='button';
    button.className='btn ghost compact';
    button.title='仅重新扫描和查询当前未完成POD包裹；已POD/已退回终态不会重复查询';
    button.textContent='更新最新数据';
    const notification=actions.querySelector('.notification-button');
    actions.insertBefore(button,notification||actions.firstChild);
    button.addEventListener('click', async ()=>{
      if(button.disabled)return;
      button.disabled=true;
      const original=button.textContent;
      button.textContent='更新中…';
      try{
        const call = typeof api === 'function'
          ? api('/api/manual-open-refresh',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})
          : fetch('/api/manual-open-refresh',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'}).then(async response=>{const data=await response.json();if(!response.ok||data?.ok===false)throw new Error(data?.error||`HTTP ${response.status}`);return data;});
        const payload=await call;
        if(typeof refresh==='function')await refresh();
        if(typeof currentPage!=='undefined'&&currentPage==='tracking'&&typeof loadTrackingWorkspace==='function')await loadTrackingWorkspace();
        const result=payload?.result||{};
        alert(`最新数据更新完成：更新前未完成 ${Number(result.openBefore||0).toLocaleString('zh-CN')} 票，已重新处理 ${Number(result.refreshed||0).toLocaleString('zh-CN')} 票，本次闭环 ${Number(result.closed||0).toLocaleString('zh-CN')} 票，仍未完成 ${Number(result.openAfter||0).toLocaleString('zh-CN')} 票${result.failed?`，失败 ${Number(result.failed).toLocaleString('zh-CN')} 票`:''}。`);
      }catch(error){
        alert(`更新最新数据失败：${error?.message||error}`);
      }finally{
        button.disabled=false;
        button.textContent=original;
      }
    });
  }

  ensureManualRefreshButton();
  [250,1000,3000].forEach(ms=>setTimeout(ensureManualRefreshButton,ms));
})();

if (!new URLSearchParams(location.search).has('visualTest')) {
  function loadRuntimeScript(src, done) {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    if (done) script.onload = done;
    document.head.appendChild(script);
  }
  // This loader runs after app.js. Claim the destructive purge UI owner here,
  // before any legacy/stale feature can install an older long-request flow.
  loadRuntimeScript('/v505-data-purge-recovery.js?v=20260911-v505-8');
  loadRuntimeScript('/v502-multidrive-backup-ui.js?v=20260912-v502-3');
  loadRuntimeScript('/v303-authorized-clean-start.js?v=20260825-v303-direct-1', () => {
    loadRuntimeScript('/v304-unified-upload-owner.js?v=20260925-v582-1', () => {
      loadRuntimeScript('/v27-dashboard-fix.js?v=20260808-v27-2', () => {
        // Live dashboard trends are intentionally not mounted. Trend/history
        // calculations remain available only through export/report workflows.
        loadRuntimeScript('/v27-carry-business-filter.js?v=20260809-v29-carry-1', () => {
          loadRuntimeScript('/v29-data-consistency-fix.js?v=20260809-v29-1');
        });
      });
    });
  });
}