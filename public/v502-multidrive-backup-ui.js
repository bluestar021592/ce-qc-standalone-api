(function installV502MultiDriveBackupUi(global){
  if(global.__CE_QC_V502_MULTI_DRIVE_BACKUP_UI__)return;
  const PATCH_ID='2026-09-15-v544-purge-owner-cache-bust-v1';

  const escapeText=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const sizeText=bytes=>typeof global.formatFileSize==='function'?global.formatFileSize(Number(bytes||0)):`${(Number(bytes||0)/1024/1024/1024).toFixed(2)} GB`;
  const driveText=(rows=[],field='totalBytes')=>rows.length?rows.map(row=>`${escapeText(row.drive||'磁盘')} ${sizeText(row[field]||0)}`).join(' ｜ '):'未发现CE受控备份占用';

  async function requestJson(url,options={}){
    const response=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});
    const raw=await response.text();
    let data={};try{data=raw?JSON.parse(raw):{};}catch{}
    if(!response.ok||data.ok===false)throw new Error(data.error||data.message||`HTTP ${response.status}`);
    return data;
  }

  async function decorateBackupStorage(){
    const host=document.getElementById('backupListTable');
    if(!host)return;
    try{
      const result=await requestJson('/api/backups');
      const storage=result.backupStorage||{};
      const toolbar=host.querySelector('.backup-toolbar');
      const summary=toolbar?.querySelector('span');
      if(summary){
        const safety=storage.retainedSafetyBackup;
        summary.innerHTML=`CE备份总占用 <b>${sizeText(storage.totalBytes||0)}</b>（${driveText(storage.driveBreakdown||[]) }）${safety?`<br><small>安全保留：最新已验证恢复备份 ${sizeText(safety.size||0)} · ${escapeText(safety.drive||'')}</small>`:''}`;
      }
      if(toolbar){
        const button=toolbar.querySelector('button.danger-action');
        if(button)button.textContent='一键清理C/D盘CE备份';
      }
    }catch(error){console.warn('[V502] backup storage decoration skipped',error);}
  }

  const originalLoad=global.loadDataManagement;
  if(typeof originalLoad==='function'){
    global.loadDataManagement=async function v502LoadDataManagement(...args){
      const value=await originalLoad.apply(this,args);
      await decorateBackupStorage();
      return value;
    };
    try{loadDataManagement=global.loadDataManagement;}catch{}
  }

  global.deleteAllDatabaseBackups=async function v502DeleteAllDatabaseBackups(){
    if(!confirm('将清理C盘与D盘中由CE系统管理的备份目录。正式数据库不会删除，并至少保留最新一份已验证安全恢复备份。确定继续？'))return;
    const confirmText=prompt('请准确输入：永久删除全部备份');
    if(confirmText!=='永久删除全部备份')return;
    const status=document.getElementById('backupDeleteStatus');
    if(status)status.textContent='正在清理C/D盘CE备份，请稍候...';
    try{
      const result=await requestJson('/api/admin/delete-all-backups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmText})});
      const breakdown=driveText(result.driveBreakdown||[],'deletedBytes');
      const safety=result.retainedSafetyBackup;
      const safetyText=safety?`；保留最新已验证安全备份 ${sizeText(safety.size||0)}（${escapeText(safety.drive||'')}）`:'；未发现可保留的已验证安全备份';
      const message=`C/D盘CE备份清理完成：${breakdown}；合计释放 ${sizeText(result.deletedBytes||0)}，删除 ${Number(result.deletedCount||0)} 个文件${safetyText}${result.failedCount?`；失败 ${Number(result.failedCount)} 个`:''}。`;
      if(status)status.textContent=message;
      alert(message);
      if(typeof global.loadDataManagement==='function')await global.loadDataManagement();
    }catch(error){
      const message=`C/D盘CE备份清理失败：${error.message||error}`;
      if(status)status.textContent=message;
      alert(message);
    }
  };
  try{deleteAllDatabaseBackups=global.deleteAllDatabaseBackups;}catch{}

  function loadStartupProbe(){
    if(global.__CE_QC_V505_PURGE_STARTUP_PROBE__)return;
    const probe=document.createElement('script');
    probe.src='/v505-purge-startup-probe.js?v=20260912-v505-startup-probe-2';
    probe.async=false;
    document.head.appendChild(probe);
  }

  const installedPurgePatch=String(global.__CE_QC_V505_DATA_PURGE_RECOVERY__?.patchId||'');
  if(!installedPurgePatch.includes('v8-version-aware-owner')){
    const script=document.createElement('script');
    script.src='/v505-data-purge-recovery.js?v=20260915-v544-1';
    script.async=false;
    script.onload=loadStartupProbe;
    document.head.appendChild(script);
  }else{
    loadStartupProbe();
  }

  global.__CE_QC_V502_MULTI_DRIVE_BACKUP_UI__={patchId:PATCH_ID,decorateBackupStorage};
  setTimeout(()=>{void decorateBackupStorage();},300);
  console.info('[CE-QC][V502_MULTI_DRIVE_BACKUP_UI]',PATCH_ID);
})(window);