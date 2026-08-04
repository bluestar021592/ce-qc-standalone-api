let appState = {};
let shopeeState = {};
let ceAuth = {};
let accessSession = {};
let currentPage = pageFromPath();
let runInFlight = false;
let historyCatalog = { CCSL: [], SHOPEE: [] };
let historyModeDate = '';
let shopeeRecipientGroup = 'ALL';
const visualMode = new URLSearchParams(location.search).get('visualTest') === '1';
let visualFixture = null;
let purgeChallenge = null;
let purgeCountdownTimer = null;
const homeFilters = { business: 'ALL', region: 'ALL' };
const previewState = {
  home: { business: 'CCSL', category: 'allData', query: '' },
  reports: { business: 'CCSL', category: 'allData', region: 'ALL', recipientGroup: 'ALL', query: '' },
  CCSL: { business: 'CCSL', category: 'allData', query: '' },
  SHOPEE: { business: 'SHOPEE', category: 'ALL_all', recipientGroup: 'ALL', query: '' }
};

normalizeTopNavigation();
separateLegacyPanels();

function normalizeTopNavigation() {
  const nav = document.querySelector('.side-nav');
  if (!nav) return;
  const items = [
    ['home','首页总看板','home','/'], ['ccsl','CCSL看板','package','/ccsl'], ['shopee','SHOPEE看板','bag','/shopee'],
    ['import','数据导入','database','/import'], ['tracking','轨迹查询','route','/tracking'], ['exceptions','异常明细','alert','/exceptions'],
    ['reports','报表导出','clipboard','/reports'], ['settings','系统设置','settings','/settings'], ['logs','操作日志','clipboard','/logs'],
    ['data-management','数据管理','database','/data-management']
  ];
  nav.innerHTML = items.map(([page,label,icon,path]) => `<button class="side-link ${page === currentPage ? 'active' : ''} ${page === 'data-management' ? 'admin-only' : ''}" data-page="${page}" data-path="${path}" onclick="navigatePage('${page}')" ${page === 'data-management' ? 'hidden' : ''}><svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-${icon}"></use></svg><span class="side-label">${label}</span></button>`).join('');
}

function separateLegacyPanels() {
  const grid = document.querySelector('#settingsPage .settings-grid');
  if (!grid) return;
  grid.querySelectorAll('section').forEach(section => {
    const title = section.querySelector('h3')?.textContent || '';
    if (title.includes('导出与长期备份') || title.includes('操作日志') || title.includes('数据管理')) section.hidden = true;
  });
  if (!document.getElementById('networkSettingsPanel')) grid.insertAdjacentHTML('beforeend', '<section id="networkSettingsPanel" class="panel operation-panel"><div class="panel-title"><h3>网络与访问</h3></div><div id="networkAccessCards"></div></section>');
}

const settingsGrid = document.querySelector('#settingsPage .settings-grid');
if (settingsGrid && !document.getElementById('userManagementPanel')) settingsGrid.insertAdjacentHTML('beforeend', '<section id="userManagementPanel" class="panel operation-panel admin-only" hidden><div class="panel-title"><h3>用户与权限</h3><button class="text-button" onclick="loadUserManagement()">刷新</button></div><form id="userCreateForm" class="user-create-form" onsubmit="createInternalUser(event)"><input name="username" placeholder="用户名" required><input name="displayName" placeholder="姓名" required><input name="email" type="email" placeholder="邮箱"><input name="departmentCompany" placeholder="部门/公司"><select name="role"><option>VIEWER</option><option>OPERATOR</option><option>ADMIN</option></select><select name="businessScope"><option>ALL</option><option>CCSL</option><option>SHOPEE</option></select><input name="temporaryPassword" type="password" minlength="10" placeholder="临时密码（至少10位）" required><button class="btn primary" type="submit">新增用户</button></form><div id="userManagementTable" class="preview-table-wrap"></div></section>');

document.querySelectorAll('.modal .icon-button').forEach(button => {
  button.innerHTML = '<svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-close"></use></svg>';
});

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.error || response.statusText || '请求失败');
  return result;
}

async function refresh() {
  if (visualMode) {
    visualFixture ||= await fetch('/visual-dashboard-fixture.json', { cache: 'no-store' }).then(response => response.json());
    appState = buildVisualCcslState(visualFixture);
    shopeeState = buildVisualShopeeState(visualFixture);
    ceAuth = { loggedIn: true, account: '张三', role: '运营专员' };
    accessSession = { user: { displayName: '张三', department: '质控部', role: 'OPERATOR', devMode: true }, unreadNotifications: 0 };
    historyCatalog = { CCSL: [{ reportDate: visualFixture.reportDate }], SHOPEE: [{ reportDate: visualFixture.reportDate }] };
    renderAll();
    return;
  }
  const [ccsl, shopee, auth, session, ccslHistory, shopeeHistory] = await Promise.all([
    api('/api/state'), api('/api/shopee/state'), api('/api/ce-auth-status'),
    api('/api/session'),
    api('/api/history?businessType=CCSL'), api('/api/history?businessType=SHOPEE')
  ]);
  appState = ccsl.state || {};
  shopeeState = shopee.state || {};
  ceAuth = auth.authStatus || {};
  accessSession = session || {};
  historyCatalog = { CCSL: ccslHistory.rows || [], SHOPEE: shopeeHistory.rows || [] };
  historyModeDate = '';
  renderAll();
}

function renderAll() {
  renderPageVisibility();
  renderTopbar();
  renderSystemStatus();
  renderAuthPanels();
  renderNetworkSettings();
  if (currentPage === 'settings') loadUserManagement();
  renderHome();
  renderCcslPage();
  renderShopeePage();
  renderReportsPage();
  renderExceptionsPage();
  if (currentPage === 'logs') loadAuditLogs();
  if (currentPage === 'data-management') loadDataManagement();
  renderRulesPage();
  renderCcslOperations();
  renderShopeeOperations();
  renderHistoryOptions();
  const trackDate = document.getElementById('trackReportDate');
  if (trackDate && !trackDate.value) trackDate.value = latestDate(appState.reportDate, shopeeState.reportDate) || new Date().toISOString().slice(0, 10);
}

function renderNetworkSettings() {
  const target = document.getElementById('networkAccessCards');
  if (!target) return;
  const network = appState.network || {};
  const rows = [['本机访问', network.localUrl || 'http://127.0.0.1:5177'], ['同一局域网访问', network.lanUrl || '未检测到有效局域网IPv4'], ['不同网络/外地访问', network.publicUrl || 'https://qc.cambodianexpress.com']];
  target.innerHTML = `<div class="access-address-list">${rows.map(([label,url]) => `<div><span>${label}</span><b>${escapeHtml(url)}</b><button class="icon-button" title="复制地址" onclick="navigator.clipboard.writeText('${escapeAttr(url)}')"><svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-clipboard"></use></svg></button></div>`).join('')}</div><p class="operation-status">公网需 Named Tunnel 与 Cloudflare Access 配置完成后启用。</p>`;
}

function renderExceptionsPage() {
  const panel = document.getElementById('exceptionsPreviewPanel');
  if (!panel) return;
  const ccRows = appState.detailTabs?.coreAbnormal?.rows || [];
  const shRows = shopeeState.detailTabs?.abnormal?.rows || [];
  const rows = [...ccRows.map(row => ({ ...row, 业务板块: 'CCSL' })), ...shRows.map(row => ({ ...row, 业务板块: 'SHOPEE' }))].slice(0, 300);
  const fields = ['业务板块', '运单号', 'shipmentCode', '主分类', '异常分类', '最新节点', '是否POD'];
  panel.innerHTML = `<div class="panel-title"><h3>异常明细</h3><span class="status-pill muted">${formatInt(rows.length)} 条预览</span></div><div class="preview-table-wrap">${renderSimpleTable(rows, fields)}</div>`;
}

async function loadAuditLogs() {
  const target = document.getElementById('auditLogTable');
  if (!target || accessSession.user?.role !== 'ADMIN') return;
  try {
    const result = await api('/api/admin/audit-logs');
    target.innerHTML = renderSimpleTable(result.rows || [], ['createdAt','userEmail','userRole','action','businessType','reportDate','runId','ipAddress']);
  } catch (error) { target.innerHTML = `<div class="empty-state compact">${escapeHtml(error.message)}</div>`; }
}

async function loadDataManagement() {
  if (accessSession.user?.role !== 'ADMIN') return;
  const status = document.getElementById('dataDbStatus');
  if (status) status.innerHTML = `<dl class="data-status-list"><dt>数据库</dt><dd>${escapeHtml(appState.dbStatus?.dbFile || '')}</dd><dt>Schema</dt><dd>${escapeHtml(appState.dbStatus?.dbSchemaVersion || '')}</dd><dt>状态</dt><dd>${escapeHtml(appState.dbStatus?.sqlite || 'normal')}</dd></dl>`;
  try {
    const result = await api('/api/backups');
    const rows = result.backups || [];
    document.getElementById('backupListTable').innerHTML = `<div class="table-toolbar backup-toolbar"><span>当前备份 ${formatInt(rows.length)} 个</span><button class="text-button danger-action" onclick="deleteAllDatabaseBackups(${Number(rows.length)})">一键删除全部备份</button></div>${rows.length ? `<table class="preview-table"><thead><tr><th>创建时间</th><th>文件名</th><th>类型</th><th>校验</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.createdAt || '')}</td><td>${escapeHtml(row.fileName || '')}</td><td>${escapeHtml(row.reason || '')}</td><td>${escapeHtml(String(row.fileHash || '').slice(0, 12))}</td><td>${escapeHtml(row.status || 'ACTIVE')}</td><td class="backup-actions"><button class="text-button" onclick="downloadFile('/api/backups/${Number(row.id)}/download')">下载</button><button class="text-button" onclick="restoreDatabaseBackup(${Number(row.id)})">恢复</button>${String(row.status || 'ACTIVE') === 'ACTIVE' ? `<button class="text-button danger-action" onclick="deleteDatabaseBackup(${Number(row.id)},'${escapeAttr(row.fileName || '')}')">删除</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state compact">暂无备份</div>'}`;
  } catch (error) { document.getElementById('backupListTable').innerHTML = `<div class="empty-state compact">${escapeHtml(error.message)}</div>`; }
}

async function backupDatabaseNow() {
  try { const result = await api('/api/admin/backup-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); alert(`备份完成：${result.filePath}`); await loadDataManagement(); }
  catch (error) { alert(`备份失败：${error.message}`); }
}

async function restoreDatabaseBackup(backupId) {
  if (!confirm('恢复数据库会先备份当前数据并重启数据库连接。确定继续？')) return;
  const confirmText = prompt('请输入：恢复此数据库备份');
  if (confirmText !== '恢复此数据库备份') return;
  try {
    await api('/api/admin/restore-backup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backupId, confirmText })
    });
    alert('数据库恢复成功，页面将重新加载。');
    location.reload();
  } catch (error) { alert(`恢复失败：${error.message}`); }
}

async function deleteDatabaseBackup(backupId, fileName) {
  if (!confirm(`确定删除备份：${fileName}？`)) return;
  const confirmText = prompt('请输入：删除备份');
  if (confirmText !== '删除备份') return;
  try {
    await api('/api/admin/delete-backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backupId, confirmText }) });
    await loadDataManagement();
  } catch (error) { alert(`删除备份失败：${error.message}`); }
}

async function deleteAllDatabaseBackups(count) {
  if (!Number(count || 0)) return alert('当前没有可删除的备份。');
  if (!confirm(`将删除全部 ${count} 个备份文件，但不会删除当前正式数据库。确定继续？`)) return;
  const confirmText = prompt('请准确输入：永久删除全部备份');
  if (confirmText !== '永久删除全部备份') return;
  try {
    const result = await api('/api/admin/delete-all-backups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmText }) });
    alert(`已删除 ${result.deletedCount || 0} 个备份${result.failedCount ? `，失败 ${result.failedCount} 个` : ''}。`);
    await loadDataManagement();
  } catch (error) { alert(`一键删除全部备份失败：${error.message}`); }
}

async function loadUserManagement(includeDeleted = false) {
  const target = document.getElementById('userManagementTable');
  if (!target || accessSession.user?.role !== 'ADMIN') return;
  try {
    const result = await api(`/api/admin/users${includeDeleted ? '?includeDeleted=1' : ''}`);
    target.innerHTML = `<div class="table-toolbar"><button class="text-button" onclick="loadUserManagement(${includeDeleted ? 'false' : 'true'})">${includeDeleted ? '隐藏已删除用户' : '查看已删除用户'}</button></div><table class="preview-table"><thead><tr><th>用户名</th><th>姓名</th><th>角色</th><th>范围</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead><tbody>${(result.rows || []).map(row => `<tr><td>${escapeHtml(row.username)}</td><td>${escapeHtml(row.displayName)}</td><td>${escapeHtml(row.role)}</td><td>${escapeHtml(row.businessScope)}</td><td>${escapeHtml(row.status === 'DELETED' ? '已删除' : (row.enabled ? '启用' : '停用'))}</td><td>${escapeHtml(row.lastLoginAt || '—')}</td><td class="user-actions">${row.status === 'DELETED' ? `<button class="text-button" onclick="restoreInternalUser(${Number(row.id)})">恢复用户</button>` : `<button class="text-button" onclick="toggleInternalUser(${Number(row.id)},${row.enabled ? 'false' : 'true'})">${row.enabled ? '停用' : '启用'}</button><button class="text-button" onclick="resetInternalUserPassword(${Number(row.id)})">重置密码</button><button class="text-button" onclick="revokeInternalUserSessions(${Number(row.id)})">强制退出</button><button class="text-button danger-action" onclick="deleteInternalUser(${Number(row.id)},'${escapeAttr(row.username)}')">删除用户</button>`}</td></tr>`).join('')}</tbody></table>`;
  } catch (error) { target.innerHTML = `<div class="empty-state compact">${escapeHtml(error.message)}</div>`; }
}

async function createInternalUser(event) {
  event.preventDefault(); const form = event.currentTarget; const payload = Object.fromEntries(new FormData(form));
  try { await api('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); form.reset(); await loadUserManagement(); alert('用户已创建。请通过安全渠道告知临时密码。'); }
  catch (error) { alert(`新增用户失败：${error.message}`); }
}

async function toggleInternalUser(id, enabled) {
  try { await api(`/api/admin/users/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }); await loadUserManagement(); }
  catch (error) { alert(`操作失败：${error.message}`); }
}

async function resetInternalUserPassword(id) {
  const temporaryPassword = prompt('请输入至少10位的新临时密码：'); if (!temporaryPassword) return;
  try { await api(`/api/admin/users/${id}/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ temporaryPassword }) }); alert('密码已重置，旧会话已撤销。'); }
  catch (error) { alert(`重置失败：${error.message}`); }
}

async function revokeInternalUserSessions(id) {
  if (!confirm('确定强制该用户退出全部会话？')) return;
  try { await api(`/api/admin/users/${id}/revoke-sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); alert('会话已撤销。'); }
  catch (error) { alert(`操作失败：${error.message}`); }
}

async function deleteInternalUser(id, username) {
  const confirmation = prompt(`此操作会停用用户并撤销其会话。请输入用户名 ${username} 确认删除：`);
  if (confirmation === null) return;
  try {
    await api(`/api/admin/users/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: confirmation }) });
    await loadUserManagement();
  } catch (error) { alert(`删除失败：${error.message}`); }
}

async function restoreInternalUser(id) {
  if (!confirm('恢复后该用户需要使用管理员重置后的密码重新登录。')) return;
  try { await api(`/api/admin/users/${id}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await loadUserManagement(true); }
  catch (error) { alert(`恢复失败：${error.message}`); }
}

function pageFromPath() {
  const value = location.pathname.toLowerCase();
  const routes = { '/ccsl':'ccsl', '/shopee':'shopee', '/import':'import', '/tracking':'tracking', '/track':'tracking', '/exceptions':'exceptions', '/reports':'reports', '/settings':'settings', '/logs':'logs', '/data-management':'data-management' };
  for (const [path,page] of Object.entries(routes)) if (value === path || value.startsWith(`${path}/`)) return page;
  return 'home';
}

function navigatePage(page, anchor = '') {
  currentPage = ['ccsl', 'shopee', 'tracking', 'exceptions', 'reports', 'import', 'settings', 'logs', 'data-management'].includes(page) ? page : 'home';
  const path = currentPage === 'home' ? '/' : `/${currentPage}`;
  if (location.pathname !== path) history.pushState({}, '', path);
  renderAll();
  if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  else scrollTo({ top: 0, behavior: 'smooth' });
}

function renderPageVisibility() {
  for (const page of ['home', 'ccsl', 'shopee', 'tracking', 'exceptions', 'reports', 'import', 'settings', 'logs', 'data-management']) {
    const el = document.getElementById(page === 'tracking' ? 'trackPage' : `${page}Page`);
    if (el) el.hidden = page !== currentPage;
  }
  document.querySelectorAll('[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === currentPage));
}

function activeBusinessPage() { return currentPage === 'shopee' ? 'shopee' : 'ccsl'; }

function toggleSidebar() { document.body.classList.toggle('sidebar-collapsed'); }

function toggleNavGroup(id) { document.getElementById(id)?.classList.toggle('collapsed'); }

function renderTopbar() {
  const state = currentPage === 'shopee' ? shopeeState : appState;
  const titles = { home: '首页总看板', ccsl: 'CCSL看板', shopee: 'SHOPEE看板', track: '轨迹查询', reports: '报表数据预览', import: '数据导入', rules: '规则说明', settings: '系统设置' };
  Object.assign(titles, { tracking: '轨迹查询', exceptions: '异常明细', logs: '操作日志', 'data-management': '数据管理', reports: '报表导出' });
  document.getElementById('pageTitle').textContent = titles[currentPage] || '首页总看板';
  const user = accessSession.user || {};
  document.querySelectorAll('.admin-only').forEach(element => { element.hidden = user.role !== 'ADMIN'; });
  document.getElementById('headerUserName').textContent = user.displayName || user.email || '本地用户';
  document.getElementById('headerUserRole').textContent = `${user.department || '质控部'} · ${user.role || 'VIEWER'}`;
  const notification = document.getElementById('notificationCount');
  const unread = Number(accessSession.unreadNotifications || 0);
  if (notification) { notification.hidden = unread <= 0; notification.textContent = unread > 99 ? '99+' : String(unread); }
  const selectedDate = currentPage === 'home' ? latestDate(appState.reportDate, shopeeState.reportDate) : state.reportDate;
  const dateSelect = document.getElementById('topHistoryDate');
  if (dateSelect && selectedDate && ![...dateSelect.options].some(option => option.value === selectedDate)) dateSelect.add(new Option(selectedDate, selectedDate));
  if (dateSelect) dateSelect.value = historyModeDate || selectedDate || '';
}

function renderSystemStatus() {
  const db = appState.dbStatus || shopeeState.dbStatus || {};
  const podLocks = Number(appState.podLocks || 0) + Number(shopeeState.podLocks || 0);
  const carry = Number(appState.carry || 0) + Number(shopeeState.carry || 0);
  document.getElementById('sideSystemStatus').innerHTML = `
    <strong>系统状态</strong>
    ${statusLine('CE API连接', ceAuth.loggedIn ? '正常' : '未登录', ceAuth.loggedIn)}
    ${statusLine('数据库状态', db.ok ? '正常' : '异常', db.ok)}
    ${statusLine('存储状态', db.usingFallbackDataDir ? '备用目录' : '正常', !db.usingFallbackDataDir)}
    ${statusLine('POD锁状态', `${formatInt(podLocks)}条`, true)}
    ${statusLine('跨日Carry', `${formatInt(carry)}条`, true)}
    <small>程序版本：v2.0.0</small>`;
}

function statusLine(label, value, ok) {
  return `<div><i class="${ok ? 'ok' : 'warn'}"></i><span>${escapeHtml(label)}：</span><b>${escapeHtml(value)}</b></div>`;
}

function renderHistoryOptions() {
  const select = document.getElementById('topHistoryDate');
  if (!select) return;
  const dates = [...new Set([...historyCatalog.CCSL, ...historyCatalog.SHOPEE].map(row => row.reportDate).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  const current = historyModeDate || latestDate(appState.reportDate, shopeeState.reportDate);
  select.innerHTML = dates.length ? dates.map(date => `<option value="${escapeAttr(date)}" ${date === current ? 'selected' : ''}>${escapeHtml(date)}</option>`).join('') : '<option value="">—</option>';
}

async function loadHistoryDate(reportDate) {
  if (visualMode) return renderAll();
  if (!reportDate) return refresh();
  const ccsl = historyCatalog.CCSL.find(row => row.reportDate === reportDate);
  const shopee = historyCatalog.SHOPEE.find(row => row.reportDate === reportDate);
  const requests = [
    ccsl ? api(`/api/snapshot/CCSL/${encodeURIComponent(ccsl.snapshotId)}`) : Promise.resolve({ state: { businessType: 'CCSL', reportDate } }),
    shopee ? api(`/api/snapshot/SHOPEE/${encodeURIComponent(shopee.snapshotId)}`) : Promise.resolve({ state: { businessType: 'SHOPEE', reportDate } })
  ];
  try {
    const [ccslResult, shopeeResult] = await Promise.all(requests);
    appState = ccslResult.state || {};
    shopeeState = shopeeResult.state || {};
    historyModeDate = reportDate;
    renderAll();
  } catch (error) { alert(`历史日报读取失败：${error.message}`); }
}

function setHomeBusinessFilter(value) {
  homeFilters.business = ['CCSL', 'SHOPEE'].includes(value) ? value : 'ALL';
  if (homeFilters.business === 'CCSL') homeFilters.region = 'ALL';
  renderAll();
}

function setHomeRegionFilter(value) {
  homeFilters.region = ['PP', 'PV', 'UNKNOWN'].includes(value) ? value : 'ALL';
  if (homeFilters.region !== 'ALL' && homeFilters.business === 'CCSL') homeFilters.business = 'SHOPEE';
  renderAll();
}

function updateTrackCodeCount() {
  const codes = parseTrackCodes();
  const label = document.getElementById('trackCodeCount');
  if (label) label.textContent = `${codes.length} / 200`;
}

async function queryTrackNow() {
  const shipmentCodes = parseTrackCodes();
  if (!shipmentCodes.length) return alert('请至少输入一个运单号');
  const businessType = document.getElementById('trackBusiness').value;
  const reportDate = document.getElementById('trackReportDate').value || latestDate(appState.reportDate, shopeeState.reportDate) || new Date().toISOString().slice(0, 10);
  const button = document.getElementById('trackQueryButton');
  button.disabled = true;
  document.getElementById('trackQueryStatus').textContent = `正在查询 ${shipmentCodes.length} 票，单批最多50票...`;
  try {
    const result = await api('/api/track-query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ businessType, reportDate, shipmentCodes }) });
    renderManualTrackResult(result);
    document.getElementById('trackQueryStatus').innerHTML = statusPill(`查询完成：${shipmentCodes.length}票`, true);
  } catch (error) {
    document.getElementById('trackQueryStatus').innerHTML = `<span class="status-pill danger">查询失败：${escapeHtml(error.message)}</span>`;
  } finally { button.disabled = false; }
}

function parseTrackCodes() {
  return [...new Set(String(document.getElementById('trackCodes')?.value || '').split(/[\s,;]+/).map(value => value.trim().toUpperCase()).filter(Boolean))].slice(0, 200);
}

function renderManualTrackResult(result) {
  const rows = result.rows || (result.shipmentCodes || []).map(shipmentCode => ({ shipmentCode }));
  const failed = (result.batches || []).filter(row => row.status === 'failed').length;
  document.getElementById('trackBatchSummary').textContent = `${result.batches?.length || 0}个批次 · 失败${failed}批`;
  document.getElementById('trackResultSummary').innerHTML = `<div class="track-summary-cards"><span>业务 <b>${escapeHtml(result.businessType)}</b></span><span>日报日期 <b>${escapeHtml(result.reportDate)}</b></span><span>运单 <b>${formatInt(result.shipmentCodes?.length || 0)}</b></span><span>轨迹节点 <b>${formatInt(result.trackEvents?.length || 0)}</b></span><span>问题件 <b>${formatInt(result.exceptionItems?.length || 0)}</b></span></div>`;
  document.getElementById('trackResultTable').innerHTML = renderSimpleTable(rows, ['shipmentCode', '扫描状态', 'regionCode', 'primaryCategory', 'Pending次数', 'OC天数', 'returnRequired', 'POD状态', '退回状态', 'API状态']);
  document.getElementById('trackEventsTable').innerHTML = renderSimpleTable(result.trackEvents || [], ['shipmentCode', 'eventTime', 'eventCode', 'trackingEventCode', 'trackingEventDescZh', 'locationCode', 'eventShop', 'operator']);
  document.getElementById('trackExceptionsTable').innerHTML = renderSimpleTable(result.exceptionItems || [], ['shipmentCode', 'exceptionType', 'exceptionDesc', 'reportTime', 'reportShop', 'statusCode', 'fileId']);
}

function renderSimpleTable(rows, fields) {
  if (!rows.length) return '<div class="empty-state">暂无数据</div>';
  return `<table class="preview-table"><thead><tr>${fields.map(field => `<th>${escapeHtml(field)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, 300).map(row => `<tr>${fields.map(field => `<td>${escapeHtml(row?.[field] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function renderHome() {
  DashboardComponents.renderHome(buildDashboardSnapshot());
}

function renderHomeKpis() {
  const includeCcsl = homeFilters.business !== 'SHOPEE' && homeFilters.region === 'ALL';
  const includeShopee = homeFilters.business !== 'CCSL';
  const cc = includeCcsl ? ccslMetrics() : { total: 0, pod: 0 };
  const sh = includeShopee ? filteredShopeeMetrics(homeFilters.region) : emptyHomeMetrics();
  const total = cc.total + sh.total;
  const pod = cc.pod + sh.pod;
  const date = latestDate(appState.reportDate, shopeeState.reportDate);
  const useSharedTrend = homeFilters.region === 'ALL';
  const combined = (ccKey, shKey, value, status = 'warning') => useSharedTrend
    ? combineTrends(includeCcsl && ccKey ? metricTrend(appState, ccKey) : validTrend([]), includeShopee && shKey ? metricTrend(shopeeState, shKey) : validTrend([]))
    : trendWithCurrent(date, value, status);
  const ccPending1 = metricValue(appState, 'Pending1+', includeCcsl);
  const ccPending2 = metricValue(appState, 'Pending2+', includeCcsl);
  const ccPending3 = metricValue(appState, 'Pending3+', includeCcsl);
  const ccOc1 = metricValue(appState, 'OC1+', includeCcsl);
  const ccOc2 = metricValue(appState, 'OC2+', includeCcsl);
  const ccOc3 = metricValue(appState, 'OC3+', includeCcsl);
  const workOrders = metricValue(appState, '工单未处理', includeCcsl);
  const defs = [
    ['今日总单', total, combined('今日PNH', 'ALL_今日总单', total, 'volume'), '件', 'blue', 'all'],
    ['已签收率', rate(pod, total), useSharedTrend ? ratioTrend(combined('今日POD', 'ALL_今日POD', pod), combined('今日PNH', 'ALL_今日总单', total)) : trendWithCurrent(date, rate(pod, total), 'normal'), '%', 'green', 'pod'],
    ['Pending1+', ccPending1 + sh.pending1, combined('Pending1+', 'ALL_Pending1+', ccPending1 + sh.pending1), '件', 'blue', 'pending1'],
    ['Pending2+', ccPending2 + sh.pending2, combined('Pending2+', 'ALL_Pending2+', ccPending2 + sh.pending2), '件', 'blue', 'pending2'],
    ['Pending3+', ccPending3 + sh.pending3, combined('Pending3+', 'ALL_Pending3+', ccPending3 + sh.pending3, 'danger'), '件', 'red', 'pending3'],
    ['OC1+', ccOc1 + sh.oc1, combined('OC1+', 'ALL_OC1+', ccOc1 + sh.oc1), '件', 'orange', 'oc1'],
    ['OC2+', ccOc2 + sh.oc2, combined('OC2+', 'ALL_OC2+', ccOc2 + sh.oc2), '件', 'blue', 'oc2'],
    ['OC3+', ccOc3 + sh.oc3, combined('OC3+', 'ALL_OC3+', ccOc3 + sh.oc3, 'danger'), '件', 'blue', 'oc3'],
    ['入库无扫描', metricValue(appState, '入库无扫描节点', includeCcsl) + sh.inboundNoScan, combined('入库无扫描节点', 'ALL_入库无扫描', metricValue(appState, '入库无扫描节点', includeCcsl) + sh.inboundNoScan, 'warning'), '件', 'purple', 'inboundNoScan'],
    ['工单未处理', workOrders, metricTrend(appState, '工单未处理'), '件', 'red', 'workOrderAbnormal']
  ];
  document.getElementById('homeKpis').innerHTML = defs.map(([label, value, trend, unit, color, action]) => renderKpiCard(label, value, trend, unit, color, action)).join('');
}

function renderKpiCard(label, value, trend, unit, color, action = '') {
  const yesterday = trend?.[5]?.hasData ? trend[5].value : null;
  const current = trend?.[6]?.hasData ? trend[6].value : value;
  const delta = yesterday === null || yesterday === 0 || current === null ? null : ((current - yesterday) / Math.abs(yesterday)) * 100;
  return `<article class="kpi-card ${color} ${action ? 'clickable' : ''}" ${action ? `role="button" tabindex="0" onclick="openHomeMetricDetail('${escapeAttr(action)}')" onkeydown="if(event.key==='Enter')this.click()"` : ''}>
    <div class="kpi-label"><span class="metric-icon"></span>${escapeHtml(label)}</div>
    <strong>${formatMetric(value, unit)}</strong>
    <div class="kpi-compare"><span>昨日：${formatMetric(yesterday, unit)}</span><b class="${delta === null ? 'flat' : delta > 0 ? 'up' : 'down'}">${delta === null ? '—' : `${delta > 0 ? '↑' : '↓'} ${Math.abs(delta).toFixed(2)}%`}</b></div>
    ${renderTrend7(trend, unit, 'kpi')}
  </article>`;
}

function renderCcslOverview() {
  const metrics = ccslMetrics();
  const items = [
    ['今日件数', metrics.total], ['签收件数', metrics.pod], ['签收率', formatMetric(metrics.podRate, '%')],
    ['Pending1+', metricValue(appState, 'Pending1+')], ['Pending2+', metricValue(appState, 'Pending2+')], ['Pending3+', metricValue(appState, 'Pending3+')],
    ['OC1+', metricValue(appState, 'OC1+')], ['OC2+', metricValue(appState, 'OC2+')], ['OC3+', metricValue(appState, 'OC3+')],
    ['入库无扫描', metricValue(appState, '入库无扫描节点')], ['工单未处理', metricValue(appState, '工单未处理')]
  ];
  return `<div class="overview-metric-grid">${items.map(([label, value]) => `<button onclick="openBusinessMetric('CCSL','${escapeAttr(tabForMetric('CCSL', label))}')"><span>${escapeHtml(label)}</span><b>${typeof value === 'string' ? escapeHtml(value) : formatInt(value)}</b></button>`).join('')}</div>`;
}

function renderShopeeOverview() {
  const regions = shopeeState.dashboard?.regions || {};
  return `<div class="shopee-region-pair">${['PP', 'PV'].map(code => renderRegionBlock(code, regions[code] || {})).join('')}</div>`;
}

function renderRegionBlock(code, row) {
  const label = code === 'PP' ? '本省（PP）' : '外省（PV）';
  const items = [
    ['今日件数', row.total], ['签收率', formatMetric(row.podRate || 0, '%')], ['签收件数', row.pod],
    ['Pending1+', row.pending1], ['Pending2+', row.pending2], ['Pending3+', row.pending3],
    ['OC1+', row.oc1], ['OC2+', row.oc2], ['OC3+', row.oc3], ['入库无扫描', row.inboundNoScan], ['退回待处理', row.returnRequired]
  ];
  return `<section class="region-block ${code.toLowerCase()}"><h4>${label}<small>${code === 'PP' ? '金边/本省' : '外省专线'}</small></h4><div>${items.map(([name, value]) => `<button onclick="openRegionDetail('${code}','${escapeAttr(tabForMetric('SHOPEE', name))}')"><span>${escapeHtml(name)}</span><b>${typeof value === 'string' ? escapeHtml(value) : formatInt(value || 0)}</b></button>`).join('')}</div></section>`;
}

function renderHomeTrends() {
  const sh = shopeeState.dashboard || {};
  const totalTrend = metricTrend(appState, '今日PNH');
  const shTotalTrend = metricTrend(shopeeState, 'ALL_今日总单');
  const panels = [
    ['签收率趋势', [
      ['CCSL', metricTrend(appState, '首投POD率'), 'blue'], ['SHOPEE', metricTrend(shopeeState, 'ALL_POD率'), 'green'],
      ['SHOPEE本省（PP）', sh.regionTrends?.PP?.podRate, 'green'], ['SHOPEE外省（PV）', sh.regionTrends?.PV?.podRate, 'orange']
    ]],
    ['Pending率趋势', [
      ['CCSL', ratioTrend(metricTrend(appState, 'Pending1+'), totalTrend), 'blue'], ['SHOPEE本省（PP）', sh.regionTrends?.PP?.pendingRate, 'green'], ['SHOPEE外省（PV）', sh.regionTrends?.PV?.pendingRate, 'orange']
    ]],
    ['OC率趋势', [
      ['CCSL', ratioTrend(metricTrend(appState, 'OC1+'), totalTrend), 'blue'], ['SHOPEE本省（PP）', sh.regionTrends?.PP?.ocRate, 'green'], ['SHOPEE外省（PV）', sh.regionTrends?.PV?.ocRate, 'orange']
    ]],
    ['本省/外省 对比（SHOPEE）', [
      ['本省（PP）签收率', sh.regionTrends?.PP?.podRate, 'green'], ['外省（PV）签收率', sh.regionTrends?.PV?.podRate, 'orange'], ['SHOPEE总体', ratioTrend(metricTrend(shopeeState, 'ALL_今日POD'), shTotalTrend), 'blue']
    ]]
  ];
  return panels.map(([title, series]) => renderTrendPanel(title, series)).join('');
}

function renderTrendPanel(title, series) {
  return `<article class="panel trend-panel"><div class="panel-title"><h3>${escapeHtml(title)}</h3><span>近7天</span></div><div class="trend-series-list">${series.map(([label, trend, color]) => `<div class="trend-series ${color}"><b>${escapeHtml(label)}</b>${renderTrend7(trend, '%', 'summary')}</div>`).join('')}</div></article>`;
}

function renderHomeIssues() {
  const ccRows = (appState.detailTabs?.coreAbnormal?.rows || []).map(row => ({ ...row, _business: 'CCSL', _region: '金边' }));
  const shRows = (shopeeState.detailTabs?.abnormal?.rows || []).map(row => ({ ...row, _business: 'SHOPEE', _region: normalizedRegion(row) }));
  const rows = [...ccRows, ...shRows].slice(0, 8);
  document.getElementById('homeIssueCount').textContent = formatInt(ccRows.length + shRows.length);
  document.getElementById('homeIssueTable').innerHTML = rows.length ? `<table class="compact-table"><thead><tr><th>运单号</th><th>渠道</th><th>区域</th><th>当前状态</th><th>Pending</th><th>OC</th><th>次日追踪</th><th>操作</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(billOf(row))}</td><td>${row._business}</td><td>${escapeHtml(row._region)}</td><td><span class="table-status">${escapeHtml(pick(row, ['primaryCategory','主分类','异常分类']))}</span></td><td>${formatInt(row.Pending次数 || row.Pending当前次数 || 0)}</td><td>${formatInt(row.OC天数 || 0)}</td><td>${row.是否POD === '是' ? '否' : '是'}</td><td><a class="table-link" href="/detail?businessType=${row._business}&reportDate=${encodeURIComponent(row._business === 'SHOPEE' ? shopeeState.reportDate || '' : appState.reportDate || '')}&shipmentCode=${encodeURIComponent(billOf(row))}" target="_blank">查看</a></td></tr>`).join('')}</tbody></table>` : '<div class="empty-state compact">暂无当前异常</div>';
}

function openHomeMetricDetail(tab) {
  const type = tab === 'workOrderAbnormal' ? 'CCSL' : (homeFilters.business === 'SHOPEE' ? 'SHOPEE' : 'CCSL');
  previewState.reports.business = type;
  const ccslMap = { all: 'allData', pod: 'podClosed', pending1: 'pendingAll', pending2: 'pending2plus', pending3: 'pending3', oc1: 'ocAll', oc2: 'oc2plus', oc3: 'oc3' };
  previewState.reports.category = type === 'CCSL' ? (ccslMap[tab] || tab) : tab;
  navigatePage('reports');
}

function openBusinessMetric(type, tab) {
  openMetricDetail(type, tab);
}

function openRegionDetail(code, tab) {
  previewState.reports.business = 'SHOPEE';
  previewState.reports.category = tab || 'all';
  previewState.reports.region = code === 'PV' ? 'PV' : 'PP';
  navigatePage('reports', 'reportPreviewPanel');
}

function renderBusinessSummary(type, state) {
  const isShopee = type === 'SHOPEE';
  const metrics = isShopee ? shopeeMetrics() : ccslMetrics();
  const trends = isShopee
    ? [['签收率', metricTrend(state, 'ALL_POD率'), '%'], ['Pending件数', metricTrend(state, 'ALL_Pending1+'), '件'], ['OC件数', metricTrend(state, 'ALL_OC1+'), '件'], ['入库无扫描', metricTrend(state, 'ALL_入库无扫描'), '件']]
    : [['签收率', metricTrend(state, '首投POD率'), '%'], ['异常率', metricTrend(state, '异常率'), '%'], ['Pending件数', sumMetricTrends(state, ['Pending1次', 'Pending2次', 'Pending3次以上']), '件'], ['OC件数', sumMetricTrends(state, ['OC1天', 'OC2天', 'OC3天以上']), '件'], ['入库无扫描', metricTrend(state, '入库无扫描节点'), '件']];
  return `<section class="panel business-summary ${isShopee ? 'shopee-panel' : ''}">
    <div class="panel-title"><h3>${isShopee ? 'SHOPEE看板' : 'CCSL看板'}</h3><button class="text-button ${isShopee ? 'shopee-text' : ''}" onclick="navigatePage('${isShopee ? 'shopee' : 'ccsl'}')">进入${isShopee ? 'SHOPEE' : 'CCSL'}看板</button></div>
    <div class="summary-content">
      <div class="summary-meta">
        ${metaLine('日报状态', state.dailyReportReady || state.sourceName ? '已导入' : '未导入', Boolean(state.dailyReportReady || state.sourceName))}
        ${metaLine('日报日期', state.reportDate || '—')}
        ${metaLine('总运单数', state.reportDate ? formatInt(metrics.total) : '—')}
        ${metaLine('处理状态', runStatusText(state), state.runStatus === 'finished')}
        ${metaLine('最后处理', lastProcessed(state) || '—')}
        ${metaLine('数据版本', state.snapshotId ? '已锁定' : '待处理')}
        <div class="summary-actions"><button class="btn ${isShopee ? 'shopee' : 'primary'}" onclick="navigatePage('${isShopee ? 'shopee' : 'ccsl'}')">查看详情</button><button class="btn ghost" onclick="exportBusiness('${type}')">导出报表</button></div>
      </div>
      <div class="summary-trends">${trends.map(([label, trend, unit]) => `<div class="summary-trend-row"><b>${escapeHtml(label)}${unit === '%' ? '（%）' : '（件）'}</b>${renderTrend7(trend, unit, 'summary')}</div>`).join('')}</div>
    </div>
  </section>`;
}

function metaLine(label, value, positive = false) {
  return `<div class="meta-line"><span>${escapeHtml(label)}：</span><b class="${positive ? 'positive' : ''}">${escapeHtml(value)}</b></div>`;
}

function renderCcslPage() {
  const metrics = ccslMetrics();
  document.getElementById('ccslPageMeta').textContent = pageMeta(appState);
  document.getElementById('ccslKpis').innerHTML = businessKpiDefs('CCSL', metrics).map(def => renderKpiCard(...def)).join('');
  document.getElementById('ccslMetrics').innerHTML = renderMetricBoard('CCSL', dashboardRows(appState));
  renderCcslOperations();
  renderPreview('ccslPreviewPanel', 'CCSL', false);
}

function renderShopeePage() {
  document.getElementById('shopeePageMeta').textContent = pageMeta(shopeeState);
  renderShopeeImportMeta();
  renderShopeeRecipientFilters();
  renderShopeeRecipientGroups();
  document.getElementById('shopeeRegions').innerHTML = renderShopeeRegions();
  document.getElementById('shopeeRecipientTrends').innerHTML = renderShopeeRecipientTrends();
  renderShopeeOperations();
  renderPreview('shopeePreviewPanel', 'SHOPEE', false);
}

function renderShopeeImportMeta() {
  const summary = shopeeState.dailySummary || {};
  const counts = summary.groupCounts || {};
  const reconciliation = shopeeState.dashboard?.recipientReconciliation?.status || summary.reconciliation?.status || '待处理';
  document.getElementById('shopeeImportMeta').innerHTML = `<div class="import-meta-line">
    <span>文件 <b>${escapeHtml(shopeeState.sourceName || '未导入')}</b></span><span>reportDate <b>${escapeHtml(shopeeState.reportDate || '—')}</b></span>
    <span>有效单量 <b>${formatInt(summary.totalRecognized || shopeeState.total || 0)}</b></span><span>收件人字段 <b>${escapeHtml(summary.recipientHeader || '—')}</b></span>
    <span>CN <b>${formatInt(counts.CN || 0)}</b></span><span>VN <b>${formatInt(counts.VN || 0)}</b></span><span>OTHER <b>${formatInt(counts.OTHER || 0)}</b></span><span>对账 <b>${escapeHtml(reconciliation)}</b></span>
  </div>${(summary.warnings || []).length ? `<div class="import-warning">${(summary.warnings || []).map(escapeHtml).join('；')}</div>` : ''}`;
}

function renderShopeeRecipientFilters() {
  const groups = ['ALL', 'CN', 'VN'];
  document.getElementById('shopeeRecipientFilters').innerHTML = groups.map(group => `<button class="${shopeeRecipientGroup === group ? 'active' : ''}" onclick="setShopeeRecipientGroup('${group}')">${escapeHtml(recipientGroupLabel(group))}</button>`).join('');
}

function setShopeeRecipientGroup(group) {
  shopeeRecipientGroup = ['CN', 'VN'].includes(group) ? group : 'ALL';
  previewState.SHOPEE.recipientGroup = shopeeRecipientGroup;
  previewState.SHOPEE.category = `${shopeeRecipientGroup}_all`;
  renderShopeePage();
}

function renderShopeeRecipientGroups() {
  const groups = shopeeState.dashboard?.recipientGroups || {};
  const visible = shopeeRecipientGroup === 'ALL' ? ['ALL', 'CN', 'VN'] : [shopeeRecipientGroup];
  document.getElementById('shopeeRecipientGroups').innerHTML = visible.map(group => renderRecipientGroupPanel(group, groups[group] || {})).join('');
}

function renderRecipientGroupPanel(group, summary) {
  const metrics = summary.metrics || {};
  const defs = [
    ['今日件数', metrics.total, 'all', '件'], ['今日POD', metrics.pod, 'pod', '件'], ['POD率', metrics.podRate, 'pod', '%'],
    ['首派成功率', metrics.firstAttemptRate, 'firstAttempt', '%'], ['Pending1+', metrics.pending1, 'pending1', '件'], ['Pending2+', metrics.pending2, 'pending2', '件'],
    ['Pending3+', metrics.pending3plus, 'pending3', '件'], ['OC1+', metrics.oc1, 'oc1', '件'], ['OC2+', metrics.oc2, 'oc2', '件'],
    ['OC3+', metrics.oc3plus, 'oc3', '件'], ['入库无扫描', metrics.inboundNoScan, 'inboundNoScan', '件']
  ];
  return `<article class="panel recipient-group-card ${group === 'OTHER' ? 'other' : ''}"><header><h3>${escapeHtml(recipientGroupLabel(group))}</h3><span>${formatInt(summary.monitorCount || 0)}票纳入监控</span></header><div class="recipient-metric-grid">${defs.map(([label, value, tab, unit]) => `<button onclick="openShopeeGroupMetric('${group}','${tab}')"><span>${escapeHtml(label)}</span><b>${formatMetric(value || 0, unit)}</b></button>`).join('')}</div></article>`;
}

function openShopeeGroupMetric(group, tab) {
  shopeeRecipientGroup = ['CN', 'VN'].includes(group) ? group : 'ALL';
  previewState.SHOPEE.recipientGroup = shopeeRecipientGroup;
  openMetricDetail('SHOPEE', `${shopeeRecipientGroup}_${tab}`);
}

function renderShopeeRecipientTrends() {
  const trends = shopeeState.dashboard?.recipientTrends || {};
  const seriesGroups = shopeeRecipientGroup === 'CN' || shopeeRecipientGroup === 'VN' ? [shopeeRecipientGroup] : ['CN', 'VN'];
  const colors = { CN: 'blue', VN: 'orange' };
  const panel = (title, key) => renderTrendPanel(title, seriesGroups.map(group => [recipientGroupLabel(group), trends[group]?.[key], colors[group]]));
  const summaries = shopeeState.dashboard?.recipientGroups || {};
  return [panel('首派成功率趋势', 'firstAttemptRate'), panel('OC率趋势', 'ocRate'), panel('POD率趋势', 'podRate'), `<article class="panel trend-panel"><div class="panel-title"><h3>收件人来源对比（今日）</h3><span>独立分子/分母</span></div><div class="recipient-compare">${seriesGroups.map(group => { const row = summaries[group]?.metrics || {}; return `<div><span>${escapeHtml(recipientGroupLabel(group))}</span><b>${formatInt(row.total || 0)}件</b><small>POD ${formatInt(row.pod || 0)} · ${formatMetric(row.podRate || 0, '%')} · 首派 ${formatMetric(row.firstAttemptRate || 0, '%')}</small></div>`; }).join('')}</div></article>`].join('');
}

function renderShopeeRegions() {
  const regions = shopeeState.dashboard?.regions || {};
  return ['PP', 'PV'].map(code => `<article class="panel region-card ${code.toLowerCase()}">${renderRegionBlock(code, regions[code] || {})}</article>`).join('');
}

function businessKpiDefs(type, metrics) {
  const state = type === 'SHOPEE' ? shopeeState : appState;
  const totalKey = type === 'SHOPEE' ? 'ALL_今日总单' : '今日PNH';
  const podKey = type === 'SHOPEE' ? 'ALL_今日POD' : '今日POD';
  const rateKey = type === 'SHOPEE' ? 'ALL_POD率' : '首投POD率';
  const key = name => type === 'SHOPEE' ? `ALL_${name}` : name;
  return [
    ['今日件数', metrics.total, metricTrend(state, totalKey), '件', 'blue'],
    ['签收件数', metrics.pod, metricTrend(state, podKey), '件', 'green'],
    ['签收率', metrics.podRate, metricTrend(state, rateKey), '%', 'purple'],
    ['Pending1+', metricValue(state, key('Pending1+')), metricTrend(state, key('Pending1+')), '件', 'blue'],
    ['Pending2+', metricValue(state, key('Pending2+')), metricTrend(state, key('Pending2+')), '件', 'blue'],
    ['Pending3+', metricValue(state, key('Pending3+')), metricTrend(state, key('Pending3+')), '件', 'red'],
    ['OC1+', metricValue(state, key('OC1+')), metricTrend(state, key('OC1+')), '件', 'orange'],
    ['OC2+', metricValue(state, key('OC2+')), metricTrend(state, key('OC2+')), '件', 'blue'],
    ['OC3+', metricValue(state, key('OC3+')), metricTrend(state, key('OC3+')), '件', 'red'],
    ['入库无扫描', metricValue(state, type === 'SHOPEE' ? 'ALL_入库无扫描' : '入库无扫描节点'), metricTrend(state, type === 'SHOPEE' ? 'ALL_入库无扫描' : '入库无扫描节点'), '件', 'purple'],
    [type === 'SHOPEE' ? '退回待处理' : '工单未处理', metricValue(state, type === 'SHOPEE' ? '退回待处理' : '工单未处理'), metricTrend(state, type === 'SHOPEE' ? '退回待处理' : '工单未处理'), '件', 'red']
  ];
}

function renderMetricBoard(type, rows) {
  if (!rows.length) return '<div class="empty-state">暂无处理快照，导入日报并完成处理后显示。</div>';
  const wanted = type === 'SHOPEE' ? [
    '今日总单','今日POD','POD率','首派成功率','Pending1+','Pending2+','Pending3+','OC1+','OC2+','OC3+','入库无扫描'
  ] : ['今日PNH','今日POD','首投POD率','Pending1+','Pending2+','Pending3+','OC1+','OC2+','OC3+','入库无扫描节点','工单未处理'];
  const filtered = wanted.map(name => rows.find(row => row.项目 === name)).filter(Boolean);
  return renderExceptionTable(type, filtered, true);
}

function renderExceptionTable(type, rows, full = false) {
  const state = type === 'SHOPEE' ? shopeeState : appState;
  const total = (type === 'SHOPEE' ? shopeeMetrics() : ccslMetrics()).total || 0;
  if (!rows.length) return '<div class="empty-state">暂无异常明细</div>';
  return `<div class="metric-table ${full ? 'full' : ''}">
    <div class="metric-table-head"><span>异常类型</span><span>当前件数</span><span>占比</span><span>最长滞留</span><span>7天实际趋势</span><span>操作</span></div>
    ${rows.map(row => {
      const count = metricNumber(row.数值原值 ?? row.数值 ?? row.数量);
      const tab = row.明细Tab || tabForMetric(type, row.项目 || row.异常类型);
      const trend = row.迷你走势数据 || metricTrend(state, row.项目 || row.异常类型);
      const longest = row.最长滞留 || longestStay(detailRows(state, tab));
      return `<div class="metric-table-row">
        <strong><i class="metric-dot ${severityClass(row.状态 || row.严重等级)}"></i>${escapeHtml(row.项目 || row.异常类型 || '')}</strong>
        <b>${formatInt(count)}</b><span>${total ? `${((count / total) * 100).toFixed(2)}%` : '—'}</span><span>${escapeHtml(longest || '—')}</span>
        ${renderTrend7(trend, '件', 'table')}
        <button class="btn tiny" onclick="openMetricDetail('${type}','${escapeAttr(tab)}')">查看明细</button>
      </div>`;
    }).join('')}
  </div>`;
}

function renderTrend7(trend, unit = '件', variant = '') {
  const items = validTrend(trend);
  const values = items.filter(item => item.hasData).map(item => Math.abs(Number(item.value || 0)));
  const max = Math.max(1, ...values);
  const points = items.map((item, index) => item.hasData ? `${index * 100 + 50},${52 - Math.round((Math.abs(Number(item.value || 0)) / max) * 38)}` : null);
  const segments = [];
  let segment = [];
  for (const point of points) {
    if (point) segment.push(point);
    else if (segment.length) { segments.push(segment); segment = []; }
  }
  if (segment.length) segments.push(segment);
  return `<div class="trend7 ${escapeAttr(variant)}" data-start="${escapeAttr(items[0]?.date || '')}" data-end="${escapeAttr(items[6]?.date || '')}">
    <div class="trend7-values">${items.map(item => `<span class="${item.hasData ? severityClass(item.status) : 'missing'}">${formatMetric(item.hasData ? item.value : null, unit)}</span>`).join('')}</div>
    <div class="trend7-plot"><svg viewBox="0 0 700 56" preserveAspectRatio="none" aria-hidden="true">${segments.map(pointsPart => `<polyline points="${pointsPart.join(' ')}"></polyline>`).join('')}</svg>${items.map((item, index) => `<i class="${item.hasData ? severityClass(item.status) : 'missing'}" style="left:${(index / 6) * 100}%;top:${item.hasData ? 52 - Math.round((Math.abs(Number(item.value || 0)) / max) * 38) : 50}px"></i>`).join('')}</div>
    <div class="trend7-dates">${items.map(item => `<span>${escapeHtml(item.date ? item.date.slice(5) : '—')}</span>`).join('')}</div>
  </div>`;
}

function validTrend(value) {
  const list = Array.isArray(value) ? value.slice(0, 7) : [];
  return Array.from({ length: 7 }, (_, index) => {
    const item = list[index] || {};
    return { date: item.date || '', value: item.value, hasData: Boolean(item.hasData), status: item.status || 'missing' };
  });
}

function dashboardRows(state) {
  if (state.businessType === 'SHOPEE') return state.dashboard?.dashboardRows || state.detailTabs?.dashboard?.rows || [];
  return state.detailTabs?.dashboard?.rows || [];
}

function metricTrend(state, name) {
  return validTrend(dashboardRows(state).find(row => row.项目 === name || row.metricKey === name)?.迷你走势数据);
}

function sumMetricTrends(state, names) {
  const trends = names.map(name => metricTrend(state, name));
  return Array.from({ length: 7 }, (_, index) => {
    const points = trends.map(trend => trend[index]).filter(item => item?.hasData);
    return { date: points[0]?.date || trends[0]?.[index]?.date || '', value: points.length ? points.reduce((sum, item) => sum + Number(item.value || 0), 0) : null, hasData: points.length > 0, status: points.some(item => item.status === 'danger') ? 'danger' : points.some(item => item.status === 'warning') ? 'warning' : points.length ? 'normal' : 'missing' };
  });
}

function combineTrends(a, b) {
  const left = validTrend(a); const right = validTrend(b);
  return left.map((item, index) => {
    const other = right[index]; const hasData = item.hasData || other.hasData;
    return { date: item.date || other.date, value: hasData ? Number(item.hasData ? item.value : 0) + Number(other.hasData ? other.value : 0) : null, hasData, status: hasData ? (item.status === 'danger' || other.status === 'danger' ? 'danger' : item.status === 'warning' || other.status === 'warning' ? 'warning' : 'volume') : 'missing' };
  });
}

function ratioTrend(numerator, denominator) {
  return validTrend(denominator).map((item, index) => {
    const pod = validTrend(numerator)[index];
    const hasData = item.hasData && pod.hasData && Number(item.value || 0) > 0;
    return { date: item.date || pod.date, value: hasData ? Number(((Number(pod.value) / Number(item.value)) * 100).toFixed(2)) : null, hasData, status: hasData ? 'normal' : 'missing' };
  });
}

function trendWithCurrent(reportDate, value, status = 'volume') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(reportDate || ''))) return validTrend([]);
  const end = new Date(`${reportDate}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(end); day.setUTCDate(end.getUTCDate() + index - 6);
    return { date: day.toISOString().slice(0, 10), value: index === 6 ? Number(value || 0) : null, hasData: index === 6, status: index === 6 ? status : 'missing' };
  });
}

function ccslMetrics() {
  const dashboard = appState.dashboard || {};
  return { total: Number(dashboard.pnh || dashboard.totalMonitored || 0), pod: Number(dashboard.todayPod || 0), podRate: Number(dashboard.podRate || 0), abnormal: Number(dashboard.abnormalCount || 0), pending: Number(dashboard.categories?.pendingTotal || 0), oc: Number(dashboard.categories?.ocTotal || 0) };
}

function shopeeMetrics() {
  return recipientMetrics('ALL');
}

function recipientMetrics(group = 'ALL') {
  const normalized = ['CN', 'VN', 'OTHER'].includes(group) ? group : 'ALL';
  const metrics = shopeeState.dashboard?.recipientGroups?.[normalized]?.metrics
    || (normalized === 'ALL' ? shopeeState.dashboard?.metrics : {})
    || {};
  return {
    total: Number(metrics.total || 0),
    pod: Number(metrics.pod || 0),
    podRate: Number(metrics.podRate || 0),
    firstAttemptRate: Number(metrics.firstAttemptRate || 0),
    pending1: Number(metrics.pending1 || 0),
    pending2: Number(metrics.pending2 || 0),
    pending3: Number(metrics.pending3plus || metrics.pending3 || 0),
    pending3plus: Number(metrics.pending3plus || metrics.pending3 || 0),
    oc1: Number(metrics.oc1 || 0),
    oc2: Number(metrics.oc2 || 0),
    oc3: Number(metrics.oc3plus || metrics.oc3 || 0),
    oc3plus: Number(metrics.oc3plus || metrics.oc3 || 0),
    inboundNoScan: Number(metrics.inboundNoScan || 0),
    shopTransit: Number(metrics.shopTransit || 0), shopArrived: Number(metrics.shopArrived || 0),
    shopPending: Number(metrics.shopPending || 0), shopRetention1: Number(metrics.shopRetention1 || 0),
    shopRetention2: Number(metrics.shopRetention2 || 0), shopRetention3: Number(metrics.shopRetention3 || 0),
    abnormal: Number(metrics.abnormal || 0),
    returnRequired: Number(metrics.returnRequired || 0)
  };
}

function emptyHomeMetrics() {
  return { total: 0, pod: 0, pending1: 0, pending2: 0, pending3: 0, oc1: 0, oc2: 0, oc3: 0, inboundNoScan: 0, returnRequired: 0 };
}

function filteredShopeeMetrics(region = 'ALL') {
  if (region === 'ALL') return recipientMetrics('ALL');
  const rows = (shopeeState.detailTabs?.all?.rows || []).filter(row => normalizedRegion(row) === region);
  return {
    total: rows.length,
    pod: rows.filter(row => row.是否POD === '是' || row.POD状态 === 'POD').length,
    pending1: rows.filter(row => Number(row.Pending次数 || row.Pending当前次数 || 0) >= 1).length,
    pending2: rows.filter(row => Number(row.Pending次数 || row.Pending当前次数 || 0) >= 2).length,
    pending3: rows.filter(row => Number(row.Pending次数 || row.Pending当前次数 || 0) >= 3).length,
    oc1: rows.filter(row => Number(row.OC天数 || 0) >= 1).length,
    oc2: rows.filter(row => Number(row.OC天数 || 0) >= 2).length,
    oc3: rows.filter(row => Number(row.OC天数 || 0) >= 3).length,
    inboundNoScan: rows.filter(row => row.入库无扫描节点 === '是').length,
    returnRequired: rows.filter(row => row.returnRequired === true || row.退回待处理 === '是').length
  };
}

function metricValue(state, name, enabled = true) {
  if (!enabled) return 0;
  const row = dashboardRows(state).find(item => item.项目 === name || item.metricKey === name);
  return metricNumber(row?.数值原值 ?? row?.数值 ?? 0);
}

function normalizedRegion(row = {}) {
  const code = String(row.regionCode || row.区域 || '').toUpperCase();
  if (code.startsWith('PP') || row.regionType === 'PHNOM_PENH') return 'PP';
  if (code.startsWith('PV') || row.regionType === 'PROVINCE') return 'PV';
  return 'UNKNOWN';
}

function ccslExceptionRows() {
  const rows = dashboardRows(appState);
  return ['Pending1+','Pending2+','Pending3+','入库无扫描节点','OC1+','OC2+','OC3+','工单未处理'].map(name => rows.find(row => row.项目 === name)).filter(Boolean);
}

function shopeeExceptionRows() {
  const rows = dashboardRows(shopeeState);
  return ['Pending1+','Pending2+','Pending3+','入库无扫描','OC1+','OC2+','OC3+','退回待处理'].map(name => rows.find(row => row.项目 === name)).filter(Boolean);
}

function renderReportsPage() {
  const filter = previewState.reports;
  const type = filter.business === 'SHOPEE' ? 'SHOPEE' : 'CCSL';
  const state = type === 'SHOPEE' ? shopeeState : appState;
  const tabs = state.detailTabs || {};
  const recipientGroup = type === 'SHOPEE' && ['CN', 'VN'].includes(filter.recipientGroup) ? filter.recipientGroup : 'ALL';
  if (!tabs[filter.category]) filter.category = type === 'SHOPEE' ? `${recipientGroup}_all` : 'allData';
  const business = document.getElementById('reportBusiness');
  if (!business) return;
  business.value = type;
  document.getElementById('reportRegion').value = type === 'SHOPEE' ? (filter.region || 'ALL') : 'ALL';
  const recipientSelect = document.getElementById('reportRecipientGroup');
  if (recipientSelect) { recipientSelect.value = recipientGroup; recipientSelect.disabled = type !== 'SHOPEE'; }
  document.getElementById('reportDateRange').value = state.reportDate ? `${state.reportDate} ~ ${state.reportDate}` : '暂无已保存日报';
  const category = document.getElementById('reportCategory');
  category.innerHTML = Object.entries(tabs)
    .filter(([, value]) => Array.isArray(value?.rows))
    .filter(([key]) => type !== 'SHOPEE' || key.startsWith(`${recipientGroup}_`) || ['pp', 'pv', 'recipientConflicts'].includes(key))
    .map(([key, value]) => `<option value="${escapeAttr(key)}" ${key === filter.category ? 'selected' : ''}>${escapeHtml(value.label || tabLabel(type, key))}</option>`).join('');
  const metrics = type === 'SHOPEE' ? recipientMetrics(recipientGroup) : ccslMetrics();
  const summary = type === 'SHOPEE'
    ? [['总记录', metrics.total, 'blue', `${recipientGroup}_all`], ['Pending异常', metrics.pending1, 'purple', `${recipientGroup}_pending1`], ['OC异常', metrics.oc1, 'orange', `${recipientGroup}_oc1`], ['入库无扫描', metrics.inboundNoScan, 'blue', `${recipientGroup}_inboundNoScan`], ['Pending3+', metrics.pending3plus, 'red', `${recipientGroup}_pending3`], ['已签收', metrics.pod, 'green', `${recipientGroup}_pod`]]
    : [['总记录', metrics.total, 'blue', 'allData'], ['Pending异常', metricValue(state, 'Pending1+'), 'purple', 'pendingAll'], ['OC异常', metricValue(state, 'OC1+'), 'orange', 'ocAll'], ['入库无扫描', metricValue(state, '入库无扫描节点'), 'blue', 'inboundNoScan'], ['工单未处理', metricValue(state, '工单未处理'), 'orange', 'workOrderAbnormal'], ['已签收', metrics.pod, 'green', 'podClosed']];
  document.getElementById('reportSummaryCards').innerHTML = summary.map(([label, value, color, tab]) => `<button class="report-summary-card ${color}" onclick="setReportCategory('${tab}')"><i></i><span>${label}</span><b>${formatInt(value)}</b></button>`).join('');
  renderReportPreview();
}

function renderReportPreview() {
  const filter = previewState.reports;
  const type = filter.business === 'SHOPEE' ? 'SHOPEE' : 'CCSL';
  const state = type === 'SHOPEE' ? shopeeState : appState;
  const tab = state.detailTabs?.[filter.category] || { rows: [], total: 0 };
  const query = String(filter.query || '').trim().toLowerCase();
  const region = type === 'SHOPEE' ? (filter.region || 'ALL') : 'ALL';
  const recipientGroup = type === 'SHOPEE' && ['CN', 'VN'].includes(filter.recipientGroup) ? filter.recipientGroup : 'ALL';
  const filteredRows = (tab.rows || []).filter(row => {
    if (type === 'SHOPEE' && region !== 'ALL' && normalizedRegion(row) !== region) return false;
    if (type === 'SHOPEE' && recipientGroup !== 'ALL' && recipientGroupOfRow(row) !== recipientGroup) return false;
    return !query || JSON.stringify(row).toLowerCase().includes(query);
  });
  const rows = filteredRows.slice(0, 200);
  document.getElementById('reportPreviewPanel').innerHTML = `<div class="panel-title"><div><h3>导出字段预览</h3><p>当前显示 1-${formatInt(rows.length)} / ${formatInt(filteredRows.length)} 条</p></div><button class="btn ghost" onclick="exportBusiness('${type}')">下载${type} Excel</button></div><div class="preview-meta"><span>业务板块 <b>${type}</b></span><span>日报日期 <b>${escapeHtml(state.reportDate || '—')}</b></span>${type === 'SHOPEE' ? `<span>收件人来源 <b>${escapeHtml(recipientGroupLabel(recipientGroup))}</b></span>` : ''}<span>数据总数 <b>${formatInt(filteredRows.length)}</b></span><span>数据版本 <b>${state.snapshotId ? '已锁定' : '待处理'}</b></span></div><div class="preview-table-wrap">${rows.length ? renderPreviewTable(rows, type) : '<div class="empty-state">当前筛选暂无数据</div>'}</div><p class="preview-footnote">ⓘ 收件人来源与PP/PV是两个独立维度；页面与Excel均读取同一已保存快照。</p>`;
}

function setReportBusiness(value) {
  previewState.reports.business = value === 'SHOPEE' ? 'SHOPEE' : 'CCSL';
  previewState.reports.recipientGroup = 'ALL';
  previewState.reports.category = value === 'SHOPEE' ? 'ALL_all' : 'allData';
  previewState.reports.region = 'ALL';
  renderReportsPage();
}

function setReportRegion(value) {
  previewState.reports.region = value === 'PP' || value === 'PV' ? value : 'ALL';
  renderReportPreview();
}

function setReportRecipientGroup(value) {
  previewState.reports.recipientGroup = ['CN', 'VN'].includes(value) ? value : 'ALL';
  if (previewState.reports.business === 'SHOPEE') previewState.reports.category = `${previewState.reports.recipientGroup}_all`;
  renderReportsPage();
}

function setReportCategory(value) {
  previewState.reports.category = value;
  renderReportsPage();
}

function setReportSearch(value) {
  previewState.reports.query = value;
  renderReportPreview();
}

function renderRulesPage() {
  const target = document.getElementById('rulesContent');
  if (!target) return;
  target.innerHTML = [
    ['Pending连续规则', '同一自然日重复Pending只计一次；1+/2+/3+为累计门槛。'],
    ['OC周期规则', 'Inbound、派件分配和派送不提前关闭OC；POD或退回才最终闭环。'],
    ['退回待处理', '连续3个自然日Pending且仍未POD或退回，进入退回待处理。'],
    ['PP/PV隔离', 'PP代表本省金边，PV代表外省；无法确认时保持待确认，不猜测。'],
    ['跨日续查', '未闭环运单次日重新扫描、查询轨迹和问题件；API失败不丢票。'],
    ['导出一致性', '页面、详情、预览和XLSX读取同一已保存快照，导出阶段不调用CE API。']
  ].map(([title, text]) => `<article class="panel rule-card"><h3>${title}</h3><p>${text}</p></article>`).join('');
}

function renderPreview(containerId, scope, businessSelectable) {
  const filter = previewState[scope];
  const type = businessSelectable ? filter.business : scope;
  const state = type === 'SHOPEE' ? shopeeState : appState;
  const tabs = state.detailTabs || {};
  if (!tabs[filter.category]) filter.category = type === 'SHOPEE' ? `${filter.recipientGroup || 'ALL'}_all` : 'allData';
  const tab = tabs[filter.category] || { rows: [], total: 0, label: '全部明细' };
  const query = String(filter.query || '').trim().toLowerCase();
  const rows = (tab.rows || []).filter(row => !query || JSON.stringify(row).toLowerCase().includes(query)).slice(0, 200);
  const businessSelect = businessSelectable ? `<label>业务板块<select onchange="setPreviewFilter('${scope}','business',this.value)"><option value="CCSL" ${type === 'CCSL' ? 'selected' : ''}>CCSL</option><option value="SHOPEE" ${type === 'SHOPEE' ? 'selected' : ''}>SHOPEE</option></select></label>` : `<span class="fixed-business">${type}</span>`;
  const categoryOptions = Object.entries(tabs).filter(([, value]) => Array.isArray(value?.rows)).map(([key, value]) => `<option value="${escapeAttr(key)}" ${key === filter.category ? 'selected' : ''}>${escapeHtml(value.label || tabLabel(type, key))}</option>`).join('');
  document.getElementById(containerId).innerHTML = `
    <div class="panel-title"><div><h3>数据明细与导出预览</h3><p>导出前核对当前快照及关键字段</p></div><button class="btn ${type === 'SHOPEE' ? 'shopee' : 'primary'}" ${state.snapshotId ? '' : 'disabled'} onclick="exportBusiness('${type}')">导出${type} Excel</button></div>
    <div class="preview-meta"><span>业务板块 <b>${type}</b></span><span>日报日期 <b>${escapeHtml(state.reportDate || '—')}</b></span><span>数据总数 <b>${formatInt(tab.total ?? rows.length)}</b></span><span>数据版本 <b>${state.snapshotId ? '已锁定' : '待处理'}</b></span></div>
    <div class="preview-filters">${businessSelect}<label>日期<input value="${escapeAttr(state.reportDate || '')}" readonly></label><label>异常类型<select onchange="setPreviewFilter('${scope}','category',this.value)">${categoryOptions}</select></label><label class="search-field">运单号 / CP码 / 收件人<input value="${escapeAttr(filter.query)}" oninput="setPreviewFilter('${scope}','query',this.value)"></label><button class="btn ghost" onclick="renderPreview('${containerId}','${scope}',${businessSelectable})">查询</button></div>
    <div class="preview-table-wrap">${rows.length ? renderPreviewTable(rows, type) : '<div class="empty-state">当前筛选暂无数据</div>'}</div>`;
}

function setPreviewFilter(scope, key, value) {
  previewState[scope][key] = value;
  if (key === 'business') previewState[scope].category = value === 'SHOPEE' ? 'ALL_all' : 'allData';
  const id = scope === 'home' ? 'homePreview' : scope === 'CCSL' ? 'ccslPreviewPanel' : 'shopeePreviewPanel';
  renderPreview(id, scope, scope === 'home');
}

function renderPreviewTable(rows, type) {
  const fields = type === 'SHOPEE'
    ? ['运单号','收件人来源','收件人原值','区域','最新节点','最新时间','当前分类','Pending次数','Pending连续性','OC天数','POD状态','操作']
    : ['运单号','区域','收件人','最新节点','最新时间','当前分类','Pending次数','Pending连续性','OC天数','入库无扫描','工单未处理','POD状态','操作'];
  return `<table class="preview-table"><thead><tr>${fields.map(field => `<th>${field}</th>`).join('')}</tr></thead><tbody>${rows.map(row => {
    const bill = billOf(row);
    const region = pick(row, ['regionCode','区域','门店编码','CP码','pickupShop','deliveryShop']) || '—';
    const pendingCount = row.Pending当前次数 ?? row.Pending次数 ?? row.Pending最大次数 ?? '—';
    const pendingContinuity = row.Pending连续性 ?? (row.Pending连续 === true ? '连续' : row.Pending不连续 === true ? '不连续' : '—');
    const detailLink = `<a class="table-link" href="/detail?businessType=${type}&reportDate=${encodeURIComponent(type === 'SHOPEE' ? shopeeState.reportDate || '' : appState.reportDate || '')}&shipmentCode=${encodeURIComponent(bill)}" target="_blank">查看轨迹</a>`;
    const common = [bill, region, pick(row, ['收件人','customerName','receiverName']), pick(row, ['latestEventDesc','最后节点','latestNode']), pick(row, ['latestEventTime','最后节点时间']), pick(row, ['primaryCategory','主分类','异常分类']), pendingCount, pendingContinuity, row.OC天数 ?? row.OC最大天数 ?? '—'];
    const values = type === 'SHOPEE'
      ? [bill, recipientGroupOfRow(row), row.recipient_raw || '—', region, pick(row, ['latestEventDesc','最后节点','latestNode']), pick(row, ['latestEventTime','最后节点时间']), pick(row, ['primaryCategory','主分类','异常分类']), pendingCount, pendingContinuity, row.OC天数 ?? row.OC最大天数 ?? '—', pick(row, ['POD状态','是否POD']), detailLink]
      : [...common, row.异常分类 === '入库无扫描' ? '是' : '否', row.异常分类 === '需人工复核' ? '是' : '否', pick(row, ['POD状态','是否POD']), detailLink];
    return `<tr>${values.map((value, index) => `<td>${index === values.length - 1 ? value : escapeHtml(value ?? '—')}</td>`).join('')}</tr>`;
  }).join('')}</tbody></table>`;
}

function openMetricDetail(type, tab) {
  navigatePage(type === 'SHOPEE' ? 'shopee' : 'ccsl');
  previewState[type].category = tab || (type === 'SHOPEE' ? 'all' : 'allData');
  requestAnimationFrame(() => {
    renderPreview(type === 'SHOPEE' ? 'shopeePreviewPanel' : 'ccslPreviewPanel', type, false);
    document.getElementById(type === 'SHOPEE' ? 'shopeePreviewPanel' : 'ccslPreviewPanel')?.scrollIntoView({ behavior: 'smooth' });
  });
}

function renderCcslOperations() {
  const summary = appState.dailySummary || {};
  document.getElementById('fileStatus').innerHTML = `${statusPill(appState.sourceName ? '日报已导入' : '未导入日报', Boolean(appState.sourceName))}<p>${escapeHtml(appState.sourceName || '未选择文件')}</p><p>日期：${escapeHtml(appState.reportDate || '—')} · PNH ${formatInt(summary.pnh || 0)} · 非PNH ${formatInt(summary.nonPnh || 0)}</p>`;
  document.getElementById('ccslRunStatus').innerHTML = runStatusMarkup(appState);
  document.getElementById('shopCodeSettingStatus').innerHTML = `当前门店CP码：<b>${formatInt(appState.shopCodes?.count || 0)}</b>个`;
  document.getElementById('logs').textContent = (appState.logs || []).slice(-300).join('\n');
}

function renderShopeeOperations() {
  const summary = shopeeState.dailySummary || {};
  const groups = summary.groupCounts || {};
  document.getElementById('shopeeFileStatus').innerHTML = `${statusPill(shopeeState.sourceName ? '日报已导入' : '未导入日报', Boolean(shopeeState.sourceName))}<p>${escapeHtml(shopeeState.sourceName || '未选择文件')}</p><p>日期：${escapeHtml(shopeeState.reportDate || '—')} · 有效 ${formatInt(summary.totalRecognized || shopeeState.total || 0)} · CN ${formatInt(groups.CN || 0)} · VN ${formatInt(groups.VN || 0)} · 冲突 ${formatInt(summary.conflictCount || 0)}</p>`;
  document.getElementById('shopeeRunStatus').innerHTML = runStatusMarkup(shopeeState);
  document.getElementById('shopeeLogs').textContent = (shopeeState.logs || []).slice(-300).join('\n');
}

function runStatusMarkup(state) {
  const processing = state.processing || {};
  const isScan = /扫描/.test(String(processing.phase || ''));
  const done = isScan ? Number(state.scanResults || 0) : Number(state.trackResults || 0);
  const total = isScan ? Number(state.scanPool || state.total || 0) : Number(state.needTrackBills || state.scanPool || state.total || 0);
  const label = isScan ? '扫描进度' : '轨迹进度';
  const batchSize = isScan ? 350 : 50;
  return `${statusPill(runStatusText(state), state.runStatus === 'finished')}<p>当前阶段：${escapeHtml(processing.phase || '待处理')}</p><p>${label}：${formatInt(done)} / ${formatInt(total)} · 单批最大${batchSize}</p>`;
}

function renderAuthPanels() {
  const html = ceAuth.loggedIn
    ? `${statusPill('CE系统已登录', true)}<p>登录用户：${escapeHtml(ceAuth.account || ceAuth.userId || '—')}</p><div class="button-row"><button class="btn ghost" onclick="showLoginForms()">重新登录</button><button class="btn ghost" onclick="logoutCe()">退出</button></div>`
    : `<label class="field-label">tenantId<input class="auth-tenant" value="000000" autocomplete="off"></label><label class="field-label">username<input class="auth-user" autocomplete="username"></label><label class="field-label">password<input class="auth-password" type="password" autocomplete="current-password"></label><button class="btn primary full" onclick="loginCe(this)">登录CE系统</button><div class="auth-message"></div>`;
  document.getElementById('ceAuthPanel').innerHTML = html;
  document.getElementById('shopeeAuthPanel').innerHTML = html;
}

function showLoginForms() { ceAuth = {}; renderAuthPanels(); }

async function loginCe(button) {
  const panel = button.closest('.auth-panel');
  const username = panel.querySelector('.auth-user')?.value.trim();
  const password = panel.querySelector('.auth-password')?.value || '';
  const tenantId = panel.querySelector('.auth-tenant')?.value.trim() || '000000';
  if (!username || !password) return alert('请输入CE账号和密码');
  try {
    const result = await api('/api/ce-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId, username, password, grant_type: 'password', scope: 'all', type: 'account' }) });
    panel.querySelector('.auth-password').value = '';
    ceAuth = result.authStatus || {};
    renderAll();
  } catch (error) {
    panel.querySelector('.auth-password').value = '';
    alert(`CE登录失败：${error.message}`);
  }
}

async function logoutCe() { const result = await api('/api/ce-logout', { method: 'POST' }); ceAuth = result.authStatus || {}; renderAll(); }

async function importExcel() {
  const file = document.getElementById('excelFile').files[0];
  if (!file) return alert('请选择CCSL日报Excel');
  const body = new FormData(); body.append('file', file); body.append('reportDate', document.getElementById('reportDate').value || '');
  try { const result = await api('/api/import-excel', { method: 'POST', body }); appState = result.state; renderAll(); alert(`CCSL日报导入成功：PNH ${result.parsed.pnh || 0}，非PNH ${result.parsed.nonPnh || 0}。`); } catch (error) { alert(`CCSL日报导入失败：${error.message}`); }
}

async function importShopeeExcel() {
  const file = document.getElementById('shopeeExcelFile').files[0];
  if (!file) return alert('请选择SHOPEE日报Excel');
  const body = new FormData(); body.append('file', file); body.append('reportDate', document.getElementById('shopeeReportDate').value || '');
  try {
    const result = await api('/api/shopee/import-excel', { method: 'POST', body });
    shopeeState = result.state;
    renderAll();
    const parsed = result.parsed || {};
    const groups = parsed.groupCounts || {};
    alert(`SHOPEE日报导入成功：有效${parsed.totalRecognized || 0}票，CN ${groups.CN || 0}，VN ${groups.VN || 0}，OTHER ${groups.OTHER || 0}，冲突${parsed.conflictCount || 0}票。`);
  } catch (error) { alert(`SHOPEE日报导入失败：${error.message}`); }
}

function openBackupImport() { document.getElementById('backupDialog').hidden = false; }
function closeBackupImport() { document.getElementById('backupDialog').hidden = true; }

async function importBackup() {
  const file = document.getElementById('backupFile').files[0];
  if (!file) return alert('请选择长期JSON');
  const body = new FormData(); body.append('file', file);
  try {
    const result = await api('/api/import-backup', { method: 'POST', body });
    appState = result.state || appState; shopeeState = result.shopeeState || shopeeState;
    document.getElementById('backupImportResult').innerHTML = statusPill(result.message || '长期备份恢复完成', true);
    renderAll();
  } catch (error) { alert(`长期JSON导入失败：${error.message}`); }
}

async function run() { await executeRun('/api/run', 'CCSL'); }
async function resumeProcess() { await executeRun('/api/resume', 'CCSL'); }
async function pauseProcess() { const result = await api('/api/pause', { method: 'POST' }); appState = result.state; renderAll(); }
async function runShopee() { await executeRun('/api/shopee/run/start', 'SHOPEE'); }
async function resumeShopee() { await executeRun('/api/shopee/run/resume', 'SHOPEE'); }
async function pauseShopee() { const result = await api('/api/shopee/run/pause', { method: 'POST' }); shopeeState = result.state; renderAll(); }

async function executeRun(url, type) {
  if (runInFlight) return;
  runInFlight = true;
  try { const result = await api(url, { method: 'POST' }); if (type === 'SHOPEE') shopeeState = result.state; else appState = result.state; renderAll(); alert(`${type}处理完成。`); }
  catch (error) { alert(`${type}处理失败：${error.message}`); }
  finally { runInFlight = false; }
}

async function importShopCodes() {
  const file = document.getElementById('shopCodeFile').files[0]; if (!file) return alert('请选择门店CP码Excel');
  const body = new FormData(); body.append('file', file);
  try { const result = await api('/api/import-shop-codes', { method: 'POST', body }); await refresh(); alert(`门店CP码导入完成：当前${result.imported.total}个。`); } catch (error) { alert(`门店CP码导入失败：${error.message}`); }
}

async function clearLogs() { const result = await api('/api/clear-logs', { method: 'POST' }); appState = result.state; renderAll(); }

async function openDataPurge() {
  if (accessSession.user?.role !== 'ADMIN') return;
  try {
    purgeChallenge = await api('/api/admin/data-purge/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const total = Object.values(purgeChallenge.counts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    document.getElementById('purgePreview').innerHTML = `<div class="purge-warning">此操作会清除所有历史业务数据。</div><dl><dt>数据库</dt><dd>${escapeHtml(purgeChallenge.databasePath)}</dd><dt>业务记录总行数</dt><dd>${formatInt(total)}</dd><dt>自动备份</dt><dd>${escapeHtml(purgeChallenge.backup?.path || '')}</dd><dt>将被删除</dt><dd>${(purgeChallenge.deleteScope || []).map(escapeHtml).join('、')}</dd><dt>将被保留</dt><dd>${(purgeChallenge.retainedScope || []).map(escapeHtml).join('、')}</dd></dl>`;
    document.getElementById('purgeAdmin').textContent = purgeChallenge.administrator || '';
    document.getElementById('purgeStepOne').hidden = false;
    document.getElementById('purgeStepTwo').hidden = true;
    document.getElementById('dataPurgeDialog').hidden = false;
  } catch (error) { alert(`无法开始清除：${error.message}`); }
}

function continueDataPurge() {
  document.getElementById('purgeStepOne').hidden = true;
  document.getElementById('purgeStepTwo').hidden = false;
  document.getElementById('purgePhrase').value = '';
  document.getElementById('purgeBackupConfirmed').checked = false;
  let remaining = Math.max(0, Math.ceil((new Date(purgeChallenge.notBefore).getTime() - Date.now()) / 1000));
  clearInterval(purgeCountdownTimer);
  const tick = () => { document.getElementById('purgeCountdown').textContent = remaining > 0 ? `请等待 ${remaining} 秒` : '可以执行最终确认'; updatePurgeButton(); remaining -= 1; };
  tick(); purgeCountdownTimer = setInterval(() => { tick(); if (remaining < 0) clearInterval(purgeCountdownTimer); }, 1000);
}

function updatePurgeButton() {
  const ready = purgeChallenge && Date.now() >= new Date(purgeChallenge.notBefore).getTime();
  const phraseOk = document.getElementById('purgePhrase')?.value === '永久清除全部业务数据';
  const backupOk = document.getElementById('purgeBackupConfirmed')?.checked;
  document.getElementById('purgeExecuteButton').disabled = !(ready && phraseOk && backupOk);
}

async function executeDataPurge() {
  const button = document.getElementById('purgeExecuteButton'); button.disabled = true;
  try {
    await api('/api/admin/data-purge/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId: purgeChallenge.challengeId, phrase: document.getElementById('purgePhrase').value, backupConfirmed: document.getElementById('purgeBackupConfirmed').checked }) });
    closeDataPurge(); localStorage.clear(); sessionStorage.clear(); await refresh(); alert('全部业务数据已清除，系统备份已保留。');
  } catch (error) { alert(`清除失败：${error.message}`); updatePurgeButton(); }
}

function closeDataPurge() { clearInterval(purgeCountdownTimer); const dialog = document.getElementById('dataPurgeDialog'); if (dialog) dialog.hidden = true; purgeChallenge = null; }

function exportBusiness(type) {
  const state = type === 'SHOPEE' ? shopeeState : appState;
  if (!state.snapshotId) return alert(`${type}暂无已完成处理快照，不能导出。`);
  const base = type === 'SHOPEE' ? '/api/shopee/export-xlsx' : '/api/export-xlsx';
  downloadFile(`${base}?snapshotId=${encodeURIComponent(state.snapshotId)}`);
}

async function downloadFile(url) {
  try {
    const response = await fetch(url); if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || response.statusText); }
    const blob = await response.blob(); const disposition = response.headers.get('content-disposition') || ''; const match = disposition.match(/filename="?([^";]+)"?/i);
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = decodeURIComponent(match?.[1] || 'download'); link.click(); URL.revokeObjectURL(link.href);
  } catch (error) { alert(`导出失败：${error.message}`); }
}

function buildDashboardSnapshot() {
  return visualMode && visualFixture ? buildVisualDashboardSnapshot(visualFixture) : buildProductionDashboardSnapshot();
}

function buildVisualDashboardSnapshot(fixture) {
  const actions = { total: 'all', podRate: 'pod', pending1: 'pending1', pending2: 'pending2', pending3: 'pending3', oc1: 'oc1', oc2: 'oc2', oc3: 'oc3', inboundNoScan: 'inboundNoScan', ticketOpen: 'workOrderAbnormal' };
  const topKpis = (fixture.topKpis || []).map(item => {
    const unit = item.key === 'podRate' ? '%' : '件';
    const isBase = ['total', 'podRate'].includes(item.key);
    const metaValue = isBase ? metricNumber(item.yesterday) : metricNumber(item.ratio);
    const positiveGood = item.key === 'podRate';
    const signed = String(item.change || '').startsWith('-') ? `↓ ${String(item.change).slice(1)}` : `↑ ${String(item.change || '').replace(/^\+/, '')}`;
    const increased = !String(item.change || '').startsWith('-');
    return {
      key: item.key, label: item.label, value: metricNumber(item.value), unit,
      metaLabel: isBase ? '昨日' : '占比', metaValue, metaUnit: item.key === 'total' ? '件' : '%',
      change: signed, changeTone: increased === positiveGood ? 'good' : 'bad',
      trend: fixture.kpiTrends?.[item.key] || [], action: actions[item.key]
    };
  });
  return {
    visualTestOnly: true,
    reportDate: fixture.reportDate,
    topKpis,
    ccsl: { ...fixture.ccsl, podRate: metricNumber(fixture.ccsl?.podRate) },
    shopee: {
      all: { ...fixture.shopee?.all, podRate: metricNumber(fixture.shopee?.all?.podRate), firstAttemptRate: metricNumber(fixture.shopee?.all?.firstAttemptRate) },
      cn: { ...fixture.shopee?.cn, podRate: metricNumber(fixture.shopee?.cn?.podRate), firstAttemptRate: metricNumber(fixture.shopee?.cn?.firstAttemptRate) },
      vn: { ...fixture.shopee?.vn, podRate: metricNumber(fixture.shopee?.vn?.podRate), firstAttemptRate: metricNumber(fixture.shopee?.vn?.firstAttemptRate) },
      other: { ...fixture.shopee?.other, podRate: metricNumber(fixture.shopee?.other?.podRate), firstAttemptRate: metricNumber(fixture.shopee?.other?.firstAttemptRate) },
      pp: { ...fixture.shopee?.pp, podRate: metricNumber(fixture.shopee?.pp?.podRate), returnPending: fixture.shopee?.pp?.returnPending || 0 },
      pv: { ...fixture.shopee?.pv, podRate: metricNumber(fixture.shopee?.pv?.podRate), returnPending: fixture.shopee?.pv?.returnPending || 0 }
    },
    dates: fixture.dates || [],
    trends: {
      podCcsl: fixture.trends?.podRate?.ccsl || [], podPp: fixture.trends?.podRate?.pp || [], podPv: fixture.trends?.podRate?.pv || [],
      pendingCcsl: fixture.trends?.pendingRate?.ccsl || [], pendingPp: fixture.trends?.pendingRate?.pp || [], pendingPv: fixture.trends?.pendingRate?.pv || [],
      ocCcsl: fixture.trends?.ocRate?.ccsl || [], ocPp: fixture.trends?.ocRate?.pp || [], ocPv: fixture.trends?.ocRate?.pv || []
    },
    issues: fixture.issues || [],
    issueCount: fixture.issueCount || fixture.issues?.length || 0
  };
}

function buildVisualCcslState(fixture) {
  const source = fixture.ccsl || {};
  const metrics = [
    ['今日PNH', source.today, scaleVisualSeries(source.today)], ['今日POD', source.pod, scaleVisualSeries(source.pod)],
    ['首投POD率', metricNumber(source.podRate), fixture.trends?.podRate?.ccsl],
    ['Pending1+', source.pending1, scaleVisualSeries(source.pending1)], ['Pending2+', source.pending2, scaleVisualSeries(source.pending2)], ['Pending3+', source.pending3, scaleVisualSeries(source.pending3)],
    ['OC1+', source.oc1, scaleVisualSeries(source.oc1)], ['OC2+', source.oc2, scaleVisualSeries(source.oc2)], ['OC3+', source.oc3, scaleVisualSeries(source.oc3)],
    ['入库无扫描节点', source.inboundNoScan, scaleVisualSeries(source.inboundNoScan)], ['工单未处理', source.ticketOpen, scaleVisualSeries(source.ticketOpen)]
  ];
  const dashboard = metrics.map(([name, value, values]) => ({ 项目: name, 数值: Number(value || 0), metricKey: name, 迷你走势数据: visualTrendPoints(fixture.reportDate, values) }));
  const rows = (fixture.issues || []).filter(row => String(row.channel || '').startsWith('CCSL')).map(visualIssueRow);
  return {
    businessType: 'CCSL', reportDate: fixture.reportDate, sourceName: `CCSL_${fixture.reportDate}.xlsx`, dailyReportReady: true,
    runStatus: 'finished', snapshotId: 'VISUAL-CCSL-SNAPSHOT', lastRunFinishedAt: `${fixture.reportDate}T20:42:00+07:00`, dbStatus: { ok: true },
    dailySummary: { pnh: source.today, nonPnh: 418 }, dashboard: { pnh: source.today, totalMonitored: source.today, todayPod: source.pod, podRate: metricNumber(source.podRate) },
    detailTabs: { dashboard: { rows: dashboard, total: dashboard.length }, allData: { rows, total: rows.length, label: '全部数据' }, coreAbnormal: { rows, total: rows.length, label: '核心异常' }, workOrderAbnormal: { rows: rows.filter(row => row.工单未处理 === '是'), total: rows.filter(row => row.工单未处理 === '是').length, label: '工单未处理' } },
    logs: ['视觉验收数据已加载', 'CCSL快照已锁定', '页面与导出使用同一快照'], processing: { phase: '处理完成' }, trackResults: source.today, needTrackBills: source.today, total: source.today
  };
}

function buildVisualShopeeState(fixture) {
  const groupSource = { ALL: fixture.shopee?.all || {}, CN: fixture.shopee?.cn || {}, VN: fixture.shopee?.vn || {}, OTHER: fixture.shopee?.other || {} };
  const groupMetrics = Object.fromEntries(Object.entries(groupSource).map(([group, row]) => [group, {
    total: Number(row.today || 0), pod: Number(row.pod || 0), podRate: metricNumber(row.podRate), firstAttemptRate: metricNumber(row.firstAttemptRate),
    pending1: Number(row.pending1 || 0), pending2: Number(row.pending2 || 0), pending3plus: Number(row.pending3 || 0),
    oc1: Number(row.oc1 || 0), oc2: Number(row.oc2 || 0), oc3plus: Number(row.oc3 || 0), inboundNoScan: Number(row.inboundNoScan || 0), returnRequired: Number(row.returnPending || 0)
  }]));
  const recipientGroups = Object.fromEntries(Object.entries(groupMetrics).map(([group, metrics]) => [group, { metrics, monitorCount: metrics.total }]));
  const dashboardRows = [];
  const metricDefs = [
    ['今日总单', 'total'], ['今日POD', 'pod'], ['POD率', 'podRate'], ['首派成功率', 'firstAttemptRate'],
    ['Pending1+', 'pending1'], ['Pending2+', 'pending2'], ['Pending3+', 'pending3plus'], ['OC1+', 'oc1'], ['OC2+', 'oc2'], ['OC3+', 'oc3plus'], ['入库无扫描', 'inboundNoScan']
  ];
  for (const [group, metrics] of Object.entries(groupMetrics)) {
    for (const [label, key] of metricDefs) {
      const recipientTrend = fixture.recipientTrends?.[group]?.[key];
      const values = recipientTrend || scaleVisualSeries(metrics[key]);
      dashboardRows.push({ 项目: group === 'ALL' ? label : `${group} ${label}`, metricKey: `${group}_${label}`, 数值: metrics[key], 迷你走势数据: visualTrendPoints(fixture.reportDate, values) });
    }
  }
  const rows = (fixture.issues || []).filter(row => String(row.channel || '').startsWith('SHOPEE')).map(visualIssueRow);
  const tabs = { all: { rows, total: rows.length, label: '全部数据' }, abnormal: { rows, total: rows.length, label: '当前异常' }, dashboard: { rows: dashboardRows, total: dashboardRows.length } };
  for (const group of ['ALL', 'CN', 'VN', 'OTHER']) {
    const groupRows = group === 'ALL' ? rows : rows.filter(row => row.recipient_group === group);
    const filters = {
      all: groupRows, pod: groupRows.filter(row => row.是否POD === '是'), pending1: groupRows.filter(row => Number(row.Pending次数 || 0) >= 1),
      pending2: groupRows.filter(row => Number(row.Pending次数 || 0) >= 2), pending3: groupRows.filter(row => Number(row.Pending次数 || 0) >= 3),
      oc1: groupRows.filter(row => Number(row.OC天数 || 0) >= 1), oc2: groupRows.filter(row => Number(row.OC天数 || 0) >= 2), oc3: groupRows.filter(row => Number(row.OC天数 || 0) >= 3),
      inboundNoScan: groupRows.filter(row => row.入库无扫描节点 === '是'), firstAttempt: groupRows.filter(row => row.是否POD === '是')
    };
    for (const [key, tabRows] of Object.entries(filters)) tabs[`${group}_${key}`] = { rows: tabRows, total: tabRows.length, label: `${recipientGroupLabel(group)} ${key}` };
  }
  const toRegion = row => ({ total: Number(row.today || 0), pod: Number(row.pod || 0), podRate: metricNumber(row.podRate), pending1: Number(row.pending1 || 0), pending2: Number(row.pending2 || 0), pending3: Number(row.pending3 || 0), oc1: Number(row.oc1 || 0), oc2: Number(row.oc2 || 0), oc3: Number(row.oc3 || 0), inboundNoScan: Number(row.inboundNoScan || 0), returnRequired: Number(row.returnPending || 0) });
  const recipientTrends = Object.fromEntries(['CN', 'VN'].map(group => [group, Object.fromEntries(['podRate', 'firstAttemptRate', 'ocRate'].map(key => [key, visualTrendPoints(fixture.reportDate, fixture.recipientTrends?.[group]?.[key] || [])]))]));
  const regionTrend = code => ({ podRate: visualTrendPoints(fixture.reportDate, fixture.trends?.podRate?.[code.toLowerCase()] || []), pendingRate: visualTrendPoints(fixture.reportDate, fixture.trends?.pendingRate?.[code.toLowerCase()] || []), ocRate: visualTrendPoints(fixture.reportDate, fixture.trends?.ocRate?.[code.toLowerCase()] || []) });
  return {
    businessType: 'SHOPEE', reportDate: fixture.reportDate, sourceName: `SHOPEE_${fixture.reportDate}.xlsx`, dailyReportReady: true,
    runStatus: 'finished', snapshotId: 'VISUAL-SHOPEE-SNAPSHOT', lastRunFinishedAt: `${fixture.reportDate}T20:42:00+07:00`, dbStatus: { ok: true },
    dailySummary: { totalRecognized: groupMetrics.ALL.total, groupCounts: { CN: groupMetrics.CN.total, VN: groupMetrics.VN.total, OTHER: groupMetrics.OTHER.total }, conflictCount: 0, recipientHeader: '收件人', reconciliation: { status: 'PASSED' } },
    dashboard: { metrics: groupMetrics.ALL, recipientGroups, recipientTrends, recipientReconciliation: { status: 'PASSED' }, regions: { PP: toRegion(fixture.shopee?.pp || {}), PV: toRegion(fixture.shopee?.pv || {}) }, regionTrends: { PP: regionTrend('PP'), PV: regionTrend('PV') }, dashboardRows },
    detailTabs: tabs, logs: ['视觉验收数据已加载', 'SHOPEE收件人来源对账通过', '快照与导出数据一致'], processing: { phase: '处理完成' }, trackResults: groupMetrics.ALL.total, needTrackBills: groupMetrics.ALL.total, total: groupMetrics.ALL.total
  };
}

function visualIssueRow(row) {
  const recipientGroup = ['CN', 'VN', 'OTHER'].includes(row.recipientGroup) ? row.recipientGroup : 'OTHER';
  return {
    shipmentCode: row.shipmentCode, 运单号: row.shipmentCode, recipient_group: recipientGroup, recipient_raw: row.recipientRaw || '',
    regionCode: String(row.channel || '').endsWith('-PV') ? 'PV' : 'PP', 区域: row.region || '', primaryCategory: row.status, 主分类: row.status, 异常分类: row.status,
    Pending次数: Number(row.pending || 0), Pending当前次数: Number(row.pending || 0), Pending连续性: Number(row.pending || 0) >= 2 ? '连续' : Number(row.pending || 0) ? '单次' : '无',
    OC天数: Number(row.oc || 0), 入库无扫描节点: row.inboundNoScan ? '是' : '否', 工单未处理: row.ticketOpen ? '是' : '否', 是否POD: /POD|签收/.test(row.status || '') ? '是' : '否', POD状态: /POD|签收/.test(row.status || '') ? 'POD' : '未POD',
    latestEventDesc: row.status, latestEventTime: row.updatedAt, latestNode: row.region, 跨日状态: row.trackQuery ? '明日继续' : '当日'
  };
}

function scaleVisualSeries(current) {
  const value = Number(current || 0);
  return [0.91, 0.94, 0.93, 0.96, 0.97, 0.985, 1].map(ratio => Number((value * ratio).toFixed(value < 100 ? 2 : 0)));
}

function visualTrendPoints(reportDate, values = []) {
  const end = new Date(`${reportDate}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(end); day.setUTCDate(end.getUTCDate() + index - 6);
    const value = values[index];
    return { date: day.toISOString().slice(0, 10), value: value === undefined || value === null ? null : Number(value), hasData: value !== undefined && value !== null, status: value === undefined || value === null ? 'missing' : 'normal' };
  });
}

function buildProductionDashboardSnapshot() {
  const cc = ccslMetrics();
  const sh = filteredShopeeMetrics('ALL');
  const date = latestDate(appState.reportDate, shopeeState.reportDate);
  const total = cc.total + sh.total;
  const pod = cc.pod + sh.pod;
  const totalTrend = combineTrends(metricTrend(appState, '今日PNH'), metricTrend(shopeeState, 'ALL_今日总单'));
  const podTrend = combineTrends(metricTrend(appState, '今日POD'), metricTrend(shopeeState, 'ALL_今日POD'));
  const shared = (ccKey, shKey) => combineTrends(metricTrend(appState, ccKey), metricTrend(shopeeState, shKey));
  const defs = [
    ['total', '今日总单', total, '件', totalTrend, 'all', false],
    ['podRate', '已签收率', rate(pod, total), '%', ratioTrend(podTrend, totalTrend), 'pod', true],
    ['pending1', 'Pending1+', metricValue(appState, 'Pending1+') + sh.pending1, '件', shared('Pending1+', 'ALL_Pending1+'), 'pending1', false],
    ['pending2', 'Pending2+', metricValue(appState, 'Pending2+') + sh.pending2, '件', shared('Pending2+', 'ALL_Pending2+'), 'pending2', false],
    ['pending3', 'Pending3+', metricValue(appState, 'Pending3+') + sh.pending3, '件', shared('Pending3+', 'ALL_Pending3+'), 'pending3', false],
    ['oc1', 'OC1+', metricValue(appState, 'OC1+') + sh.oc1, '件', shared('OC1+', 'ALL_OC1+'), 'oc1', false],
    ['oc2', 'OC2+', metricValue(appState, 'OC2+') + sh.oc2, '件', shared('OC2+', 'ALL_OC2+'), 'oc2', false],
    ['oc3', 'OC3+', metricValue(appState, 'OC3+') + sh.oc3, '件', shared('OC3+', 'ALL_OC3+'), 'oc3', false],
    ['inboundNoScan', '入库无扫描', metricValue(appState, '入库无扫描节点') + sh.inboundNoScan, '件', shared('入库无扫描节点', 'ALL_入库无扫描'), 'inboundNoScan', false],
    ['ticketOpen', '工单未处理', metricValue(appState, '工单未处理'), '件', metricTrend(appState, '工单未处理'), 'workOrderAbnormal', false]
  ];
  const topKpis = defs.map(([key, label, value, unit, trend, action, positiveGood]) => {
    const previous = trendPoint(trend, 5);
    const current = trendPoint(trend, 6) ?? value;
    const delta = previous === null || previous === 0 || current === null ? null : ((current - previous) / Math.abs(previous)) * 100;
    const countMetric = unit === '件' && key !== 'total';
    return {
      key, label, value, unit, action, trend,
      metaLabel: countMetric ? '占比' : '昨日',
      metaValue: countMetric ? rate(value, total) : previous,
      metaUnit: countMetric || unit === '%' ? '%' : '件',
      change: delta === null ? '—' : `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta).toFixed(2)}${unit === '%' ? 'pp' : '%'}`,
      changeTone: delta === null ? '' : ((delta >= 0) === positiveGood ? 'good' : 'bad')
    };
  });
  const regions = shopeeState.dashboard?.regions || {};
  const ccslTotalTrend = metricTrend(appState, '今日PNH');
  const ccslPodRateTrend = metricTrend(appState, '首投POD率');
  const shDashboard = shopeeState.dashboard || {};
  const ccslIssues = (appState.detailTabs?.coreAbnormal?.rows || []).map(row => issueFromRow(row, 'CCSL', '金边'));
  const shopeeIssues = (shopeeState.detailTabs?.abnormal?.rows || []).map(row => issueFromRow(row, `SHOPEE-${normalizedRegion(row)}`, normalizedRegion(row) === 'PV' ? '外省/省外' : '金边/本省'));
  return {
    reportDate: date,
    topKpis,
    ccsl: {
      today: cc.total, pod: cc.pod, podRate: cc.podRate,
      yesterdayToday: trendPoint(ccslTotalTrend, 5), yesterdayPod: trendPoint(metricTrend(appState, '今日POD'), 5), yesterdayPodRate: trendPoint(ccslPodRateTrend, 5),
      pending1: metricValue(appState, 'Pending1+'), pending2: metricValue(appState, 'Pending2+'), pending3: metricValue(appState, 'Pending3+'),
      oc1: metricValue(appState, 'OC1+'), oc2: metricValue(appState, 'OC2+'), oc3: metricValue(appState, 'OC3+'),
      inboundNoScan: metricValue(appState, '入库无扫描节点'), ticketOpen: metricValue(appState, '工单未处理')
    },
    shopee: {
      all: productionRecipient('ALL'),
      cn: productionRecipient('CN'),
      vn: productionRecipient('VN'),
      other: productionRecipient('OTHER'),
      pp: productionRegion(regions.PP),
      pv: productionRegion(regions.PV)
    },
    dates: trendDates(ccslPodRateTrend, date),
    trends: {
      podCcsl: trendValues(ccslPodRateTrend), podPp: trendValues(shDashboard.regionTrends?.PP?.podRate), podPv: trendValues(shDashboard.regionTrends?.PV?.podRate),
      pendingCcsl: trendValues(ratioTrend(metricTrend(appState, 'Pending1+'), ccslTotalTrend)), pendingPp: trendValues(shDashboard.regionTrends?.PP?.pendingRate), pendingPv: trendValues(shDashboard.regionTrends?.PV?.pendingRate),
      ocCcsl: trendValues(ratioTrend(metricTrend(appState, 'OC1+'), ccslTotalTrend)), ocPp: trendValues(shDashboard.regionTrends?.PP?.ocRate), ocPv: trendValues(shDashboard.regionTrends?.PV?.ocRate)
    },
    issues: [...ccslIssues, ...shopeeIssues].slice(0, 5),
    issueCount: ccslIssues.length + shopeeIssues.length
  };
}

function productionRegion(region = {}) {
  return { today: Number(region.total || 0), pod: Number(region.pod || 0), podRate: Number(region.podRate || 0), pending1: Number(region.pending1 || 0), pending2: Number(region.pending2 || 0), pending3: Number(region.pending3 || 0), oc1: Number(region.oc1 || 0), oc2: Number(region.oc2 || 0), oc3: Number(region.oc3 || 0), inboundNoScan: Number(region.inboundNoScan || 0), returnPending: Number(region.returnRequired || 0), shopTransit: Number(region.shopTransit || 0), shopArrived: Number(region.shopArrived || 0), shopPending: Number(region.shopPending || 0), shopRetention1: Number(region.shopRetention1 || 0), shopRetention2: Number(region.shopRetention2 || 0), shopRetention3: Number(region.shopRetention3 || 0) };
}

function productionRecipient(group) {
  const metrics = recipientMetrics(group);
  return {
    group,
    label: recipientGroupLabel(group),
    today: metrics.total,
    pod: metrics.pod,
    podRate: metrics.podRate,
    firstAttemptRate: metrics.firstAttemptRate,
    pending1: metrics.pending1,
    pending2: metrics.pending2,
    pending3: metrics.pending3plus,
    oc1: metrics.oc1,
    oc2: metrics.oc2,
    oc3: metrics.oc3plus,
    inboundNoScan: metrics.inboundNoScan
  };
}

function issueFromRow(row, channel, region) {
  const business = channel.startsWith('SHOPEE') ? 'SHOPEE' : 'CCSL';
  const shipmentCode = billOf(row);
  return {
    shipmentCode, channel, region,
    status: pick(row, ['primaryCategory', '主分类', '异常分类', '当前分类']),
    pending: Number(row.Pending次数 || row.Pending当前次数 || 0), oc: Number(row.OC天数 || 0),
    inboundNoScan: row.入库无扫描节点 === '是' || /入库无扫描/.test(String(row.primaryCategory || row.异常分类 || '')),
    ticketOpen: row.工单未处理 === '是' || row.工单异常 === '是',
    trackQuery: row.是否POD !== '是', updatedAt: pick(row, ['最新轨迹时间', '最后事件时间', '更新时间']),
    href: `/detail?businessType=${business}&reportDate=${encodeURIComponent(business === 'SHOPEE' ? shopeeState.reportDate || '' : appState.reportDate || '')}&shipmentCode=${encodeURIComponent(shipmentCode)}`
  };
}

function trendPoint(trend, index) { const item = validTrend(trend)[index]; return item?.hasData && Number.isFinite(Number(item.value)) ? Number(item.value) : null; }
function trendValues(trend) { return validTrend(trend).map(item => item.hasData && Number.isFinite(Number(item.value)) ? Number(item.value) : null); }
function trendDates(trend, reportDate) {
  const dates = validTrend(trend).map(item => item.date).filter(Boolean);
  if (dates.length === 7) return dates;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(reportDate || ''))) return Array(7).fill('—');
  const end = new Date(`${reportDate}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, index) => { const day = new Date(end); day.setUTCDate(end.getUTCDate() + index - 6); return day.toISOString().slice(0, 10); });
}

function metricNumber(value) { const match = String(value ?? '').replaceAll(',', '').match(/-?\d+(\.\d+)?/); return match ? Number(match[0]) : 0; }
function rate(a, b) { return b ? Number(((a / b) * 100).toFixed(2)) : 0; }
function formatInt(value) { return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }); }
function formatMetric(value, unit = '') { if (value === null || value === undefined || value === '') return '—'; const number = Number(value); if (!Number.isFinite(number)) return escapeHtml(value); if (unit === '%') return `${Number(number.toFixed(2))}%`; if (unit === '天') return `${Math.round(number)}天`; return formatInt(number); }
function severityClass(value = '') { const text = String(value); if (/danger|critical|严重|重点|失败|异常/.test(text)) return 'danger'; if (/warning|关注|跟进/.test(text)) return 'warning'; if (/normal|正常|完成|成功/.test(text)) return 'normal'; if (/volume/.test(text)) return 'volume'; return 'neutral'; }
function statusPill(text, ok) { return `<span class="status-pill ${ok ? 'success' : 'muted'}">${escapeHtml(text)}</span>`; }
function runStatusText(state) { return ({ running: '处理中', paused: '已暂停', failed: '失败可恢复', finished: '已完成' })[state.runStatus] || (state.snapshotId ? '已完成' : '待处理'); }
function lastProcessed(state) { return state.lastRunSummary?.completedAt || state.lastRun?.completedAt || state.currentRun?.completedAt || ''; }
function pageMeta(state) { return `日报 ${state.reportDate || '—'} · ${runStatusText(state)} · 数据版本${state.snapshotId ? '已锁定' : '待处理'}`; }
function latestDate(a, b) { return String(a || '') > String(b || '') ? a : (b || a || ''); }
function pick(row, keys) { for (const key of keys) if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') return row[key]; return '—'; }
function billOf(row = {}) { return String(row.shipmentCode || row.运单号 || '').trim().toUpperCase(); }
function recipientGroupOfRow(row = {}) { const value = String(row.recipient_group || row.recipientGroup || 'OTHER').trim().toUpperCase(); return ['CN', 'VN'].includes(value) ? value : 'OTHER'; }
function recipientGroupLabel(group = 'ALL') { return ({ ALL: 'SHOPEE全部', CN: 'Shopee CN', VN: 'Shopee VN', OTHER: '其他待确认' })[String(group).toUpperCase()] || 'SHOPEE全部'; }
function detailRows(state, tab) { return state.detailTabs?.[tab]?.rows || []; }
function longestStay(rows) { const max = Math.max(0, ...rows.map(row => Math.max(Number(row.OC天数 || 0), Number(row.盘点天数 || 0), Number(row.派送中天数 || row.派送中停留天数 || 0), Number(row.门店滞留天数 || row.节点未更新天数 || 0)))); return max ? `${max}天` : '—'; }
function tabForMetric(type, metric) {
  const sh = { '今日件数':'all','总件数':'all','签收件数':'pod','已签收':'pod','签收率':'pod','Pending1+':'pending1','Pending2+':'pending2','Pending3+':'pending3','OC1+':'oc1','OC2+':'oc2','OC3+':'oc3','入库无扫描':'inboundNoScan','退回待处理':'returnRequired' };
  const cc = { '今日件数':'allData','签收件数':'podClosed','签收率':'podClosed','Pending1+':'pendingAll','Pending2+':'pending2plus','Pending3+':'pending3','OC1+':'ocAll','OC2+':'oc2plus','OC3+':'oc3','入库无扫描':'inboundNoScan','入库无扫描节点':'inboundNoScan','工单未处理':'workOrderAbnormal','盘点2天':'cycle2','在途门店':'shopTransit','到达门店':'shopArrived','门店Pending':'shopPending','门店滞留1天+':'shopRetention1','门店滞留2天+':'shopRetention2','门店滞留3天+':'shopRetention3','门店途中2天':'shopTransit','门店滞留':'shopStuck' };
  return (type === 'SHOPEE' ? sh : cc)[metric] || (type === 'SHOPEE' ? 'all' : 'allData');
}
function tabLabel(type, key) {
  if (type === 'SHOPEE') {
    const match = String(key).match(/^(ALL|CN|VN|OTHER)_(.+)$/);
    if (match) return `${recipientGroupLabel(match[1])} · ${tabLabel('SHOPEE', match[2])}`;
    return ({ all:'全部明细',pod:'已签收',firstAttempt:'首派成功',abnormal:'全部异常',pending1:'Pending1+',pending2:'Pending2+',pending3:'Pending3+',oc1:'OC1+',oc2:'OC2+',oc3:'OC3+',inboundNoScan:'入库无扫描',returnRequired:'退回待处理',pp:'本省PP明细',pv:'外省PV明细',recipientConflicts:'收件人分组冲突' }[key] || key);
  }
  return ({ allData:'全部数据',podClosed:'已签收',pendingAll:'Pending1+',pending2plus:'Pending2+',pending3:'Pending3+',ocAll:'OC1+',oc2plus:'OC2+',oc3:'OC3+',workOrderAbnormal:'工单未处理',nextCarry:'明日继续',coreAbnormal:'核心异常' }[key] || key);
}
function escapeHtml(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
function escapeAttr(value) { return escapeHtml(value); }

function updateClock() {
  const target = document.getElementById('headerTime');
  if (target) target.textContent = new Date().toLocaleString('zh-CN', { hour12: false });
}

window.addEventListener('popstate', () => { currentPage = pageFromPath(); renderAll(); });
updateClock(); setInterval(updateClock, 1000);
refresh().catch(error => alert(`页面数据读取失败：${error.message}`));
document.getElementById('adminDataNav')?.addEventListener('click', openDataPurge);
setInterval(() => { if (runInFlight) refresh().catch(() => {}); }, 3000);
if (!visualMode && 'EventSource' in window) {
  const events = new EventSource('/api/events');
  events.addEventListener('DATA_RESET', async () => {
    localStorage.clear(); sessionStorage.clear();
    await refresh().catch(() => location.reload());
  });
}
