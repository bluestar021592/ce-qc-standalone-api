// V788 WHPP D-drive isolation-copy, read-only SQL aggregate probe.
// This MUST NOT be pointed at the production database by the Windows launcher.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const defaultFile=process.platform==='win32'
  ?path.win32.join('D:\\CE_QC_V788_验收副本','ce_qc_monitor.db'):'';
const file=process.argv[2]||defaultFile;
const sqlName=name=>['business_daily_parse_rows','shipment_current_state',
  'qc_tracking_ledger','business_shipment_tracks','business_pod_locks'].includes(name);
function audit(db) {
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1500;');
  const tables=['business_daily_parse_rows','shipment_current_state','qc_tracking_ledger',
    'business_shipment_tracks','business_pod_locks'];
  const missing=tables.filter(name=>!sqlName(name)||
    !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  if(missing.length) return {ok:false,code:'REQUIRED_TABLES_MISSING',missingTables:missing};
  const sql=`
    WITH members AS (
      SELECT DISTINCT reportDate,UPPER(TRIM(shipmentCode)) code
      FROM business_daily_parse_rows
      WHERE businessType='WHPP' AND TRIM(COALESCE(shipmentCode,''))<>''
    ), current_once AS (
      SELECT reportDate,UPPER(TRIM(shipmentCode)) code,COUNT(*) records,MIN(state) state
      FROM shipment_current_state WHERE businessType='WHPP'
      GROUP BY reportDate,UPPER(TRIM(shipmentCode))
    ), ledger_once AS (
      SELECT UPPER(TRIM(shipmentCode)) code,COUNT(*) records,MIN(trackingStatus) trackingStatus
      FROM qc_tracking_ledger WHERE businessType='WHPP'
      GROUP BY UPPER(TRIM(shipmentCode))
    ), tms_once AS (
      SELECT reportDate,UPPER(TRIM(shipmentCode)) code,COUNT(*) records,
        MIN(shipmentStatus) shipmentStatus
      FROM business_shipment_tracks WHERE businessType='WHPP'
      GROUP BY reportDate,UPPER(TRIM(shipmentCode))
    ), pod_lock_once AS (
      SELECT UPPER(TRIM(shipmentCode)) code,COUNT(*) records,
        MIN(podTime) podTime
      FROM business_pod_locks WHERE businessType='WHPP'
      GROUP BY UPPER(TRIM(shipmentCode))
    )
    SELECT m.reportDate AS date,COUNT(*) AS sourceMembers,
      SUM(CASE WHEN COALESCE(c.records,0)>1 OR COALESCE(l.records,0)>1
        OR COALESCE(t.records,0)>1 OR COALESCE(p.records,0)>1
        THEN 1 ELSE 0 END) AS ambiguousEvidenceMembers,
      SUM(CASE WHEN c.shipmentCode IS NOT NULL THEN 1 ELSE 0 END) AS currentMatched,
      SUM(CASE WHEN UPPER(COALESCE(c.state,''))='POD' THEN 1 ELSE 0 END) AS podLabels,
      SUM(CASE WHEN UPPER(COALESCE(c.state,'')) IN ('RETURNED','RETURN_COMPLETED') THEN 1 ELSE 0 END) AS returnedLabels,
      SUM(CASE WHEN UPPER(COALESCE(l.trackingStatus,''))='OPEN'
         AND UPPER(COALESCE(c.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED')
        THEN 1 ELSE 0 END) AS openLedgerWithTerminalLabels,
      SUM(CASE WHEN t.shipmentStatus='60' THEN 1 ELSE 0 END) AS persistedTms60,
      SUM(CASE WHEN t.shipmentStatus='80' THEN 1 ELSE 0 END) AS persistedTms80,
      SUM(CASE WHEN t.shipmentStatus='81' THEN 1 ELSE 0 END) AS persistedTms81,
      SUM(CASE WHEN UPPER(COALESCE(c.state,''))='POD'
        AND TRIM(COALESCE(t.shipmentStatus,''))='60' THEN 1 ELSE 0 END) AS exactPodTmsMatches,
      SUM(CASE WHEN UPPER(COALESCE(c.state,'')) IN ('RETURNED','RETURN_COMPLETED')
        AND TRIM(COALESCE(t.shipmentStatus,''))='81' THEN 1 ELSE 0 END) AS exactReturnedTmsMatches,
      SUM(CASE WHEN UPPER(COALESCE(c.state,''))='POD'
        AND TRIM(COALESCE(t.shipmentStatus,'')) IN ('80','81') THEN 1
        WHEN UPPER(COALESCE(c.state,'')) IN ('RETURNED','RETURN_COMPLETED')
        AND TRIM(COALESCE(t.shipmentStatus,'')) IN ('60','80') THEN 1
        ELSE 0 END) AS terminalStateTmsConflicts,
      SUM(CASE WHEN UPPER(COALESCE(c.state,'')) IN ('RETURNED','RETURN_COMPLETED')
        AND TRIM(COALESCE(t.shipmentStatus,''))='80' THEN 1 ELSE 0 END) AS returnInProgressMislabeled,
      SUM(CASE WHEN p.shipmentCode IS NOT NULL AND UPPER(COALESCE(c.state,''))='POD'
        AND COALESCE(p.podTime,'')<>'' THEN 1 ELSE 0 END) AS podTimeLockCandidates,
      SUM(CASE WHEN p.shipmentCode IS NOT NULL AND UPPER(COALESCE(c.state,''))='POD'
        AND p.podTime GLOB '????-??-??*' AND julianday(p.podTime) IS NOT NULL
        AND substr(p.podTime,1,10)>=m.reportDate
        THEN 1 ELSE 0 END) AS podTimeFormatDateCandidates,
      SUM(CASE WHEN p.shipmentCode IS NOT NULL AND UPPER(COALESCE(c.state,''))='POD'
        AND COALESCE(p.podTime,'')<>'' AND
        (julianday(p.podTime) IS NULL OR substr(p.podTime,1,10)<m.reportDate)
        THEN 1 ELSE 0 END) AS invalidPodTimeCandidates
    FROM members m
    LEFT JOIN current_once c ON c.code=m.code AND c.reportDate=m.reportDate AND c.records=1
    LEFT JOIN ledger_once l ON l.code=m.code AND l.records=1
    LEFT JOIN tms_once t ON t.code=m.code AND t.reportDate=m.reportDate AND t.records=1
    LEFT JOIN pod_lock_once p ON p.code=m.code AND p.records=1
    GROUP BY m.reportDate ORDER BY m.reportDate
  `;
  const rows=db.prepare(sql).all();
  const fields=['sourceMembers','ambiguousEvidenceMembers','currentMatched','podLabels','returnedLabels',
    'openLedgerWithTerminalLabels','persistedTms60','persistedTms80','persistedTms81',
    'exactPodTmsMatches','exactReturnedTmsMatches','terminalStateTmsConflicts',
    'returnInProgressMislabeled','podTimeLockCandidates','podTimeFormatDateCandidates',
    'invalidPodTimeCandidates'];
  const totals=Object.fromEntries(fields.map(k=>[k,rows.reduce((n,row)=>n+Number(row[k]||0),0)]));
  return {ok:true,readOnly:true,source:'D_DRIVE_ISOLATION_COPY',
    dates:rows.map(row=>Object.fromEntries(['date',...fields].map(k=>[k,row[k]]))),totals,
    note:'时间格式及日期核验仅筛查候选值，未证明凭据来源或实际签收，仍不是可信POD时间；TMS60/81匹配仅证明保存记录一致，不等于重新调用TMS实时确认'};
}
if(!file){
  console.log('BLOCKED：未指定隔离副本数据库；未连接正式系统。');
  process.exitCode=10;
}else{
  let db;
  try{
    const abs=path.resolve(file);
    if(process.platform==='win32'){
      const expected=path.win32.resolve(defaultFile).toLowerCase();
      if(abs.toLowerCase()!==expected)throw new Error('ONLY_D_DRIVE_ISOLATION_COPY_ALLOWED');
    }
    const s=fs.lstatSync(abs);
    if(!s.isFile()||s.isSymbolicLink()||s.size<=0)throw new Error('INVALID_READONLY_COPY');
    db=new DatabaseSync(abs,{readOnly:true});
    const result=audit(db);
    console.log('V788 WHPP | 只读核对D盘隔离副本，不修改正式5177数据库');
    if(!result.ok)console.log('BLOCKED：所需数据库表不完整（'+(result.missingTables||[]).join(',')+'）');
    else {
      for(const row of result.dates) console.log(
        [row.date,'来源'+row.sourceMembers,'当前匹配'+row.currentMatched,
         'POD标签'+row.podLabels,'退回标签'+row.returnedLabels,
         '证据键冲突'+row.ambiguousEvidenceMembers,
         '旧OPEN终态'+row.openLedgerWithTerminalLabels,'TMS60='+row.persistedTms60,
         'TMS80='+row.persistedTms80,'TMS81='+row.persistedTms81,
         '逐票POD匹配'+row.exactPodTmsMatches,'逐票退回匹配'+row.exactReturnedTmsMatches,
         '终态矛盾'+row.terminalStateTmsConflicts,
         '80误判已退回'+row.returnInProgressMislabeled,
         'POD时间锁候选'+row.podTimeLockCandidates,
         '日期格式候选'+row.podTimeFormatDateCandidates,
         '无效时间候选'+row.invalidPodTimeCandidates].join(' | '));
      console.log('合计 '+JSON.stringify(result.totals));
      console.log(result.note);
    }
    console.log('本项不证明原始Excel、可信POD时间及看板导出通过，禁止据此发布或清空数据。');
  }catch(e){
    console.log('BLOCKED：隔离数据库检查失败（'+String(e?.message||e).slice(0,150)+'），无数据修改。');
  }finally{if(db)try{db.close()}catch{}}
  // Always fail closed: this is a diagnostic, not release authorization.
  process.exitCode=10;
}
