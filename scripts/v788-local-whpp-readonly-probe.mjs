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
    )
    SELECT m.reportDate AS date,COUNT(*) AS sourceMembers,
      SUM(CASE WHEN c.shipmentCode IS NOT NULL THEN 1 ELSE 0 END) AS currentMatched,
      SUM(CASE WHEN UPPER(COALESCE(c.state,''))='POD' THEN 1 ELSE 0 END) AS podLabels,
      SUM(CASE WHEN UPPER(COALESCE(c.state,'')) IN ('RETURNED','RETURN_COMPLETED') THEN 1 ELSE 0 END) AS returnedLabels,
      SUM(CASE WHEN UPPER(COALESCE(l.trackingStatus,''))='OPEN'
         AND UPPER(COALESCE(c.state,'')) IN ('POD','RETURNED','RETURN_COMPLETED')
        THEN 1 ELSE 0 END) AS openLedgerWithTerminalLabels,
      SUM(CASE WHEN t.shipmentStatus='60' THEN 1 ELSE 0 END) AS persistedTms60,
      SUM(CASE WHEN t.shipmentStatus='80' THEN 1 ELSE 0 END) AS persistedTms80,
      SUM(CASE WHEN t.shipmentStatus='81' THEN 1 ELSE 0 END) AS persistedTms81,
      SUM(CASE WHEN p.shipmentCode IS NOT NULL AND UPPER(COALESCE(c.state,''))='POD'
        AND COALESCE(p.podTime,'')<>'' THEN 1 ELSE 0 END) AS podTimeLockCandidates
    FROM members m
    LEFT JOIN shipment_current_state c
      ON UPPER(TRIM(c.shipmentCode))=m.code AND c.businessType='WHPP' AND c.reportDate=m.reportDate
    LEFT JOIN qc_tracking_ledger l ON UPPER(TRIM(l.shipmentCode))=m.code AND l.businessType='WHPP'
    LEFT JOIN business_shipment_tracks t
      ON UPPER(TRIM(t.shipmentCode))=m.code AND t.businessType='WHPP' AND t.reportDate=m.reportDate
    LEFT JOIN business_pod_locks p
      ON UPPER(TRIM(p.shipmentCode))=m.code AND p.businessType='WHPP'
    GROUP BY m.reportDate ORDER BY m.reportDate
  `;
  const rows=db.prepare(sql).all();
  const fields=['sourceMembers','currentMatched','podLabels','returnedLabels',
    'openLedgerWithTerminalLabels','persistedTms60','persistedTms80','persistedTms81','podTimeLockCandidates'];
  const totals=Object.fromEntries(fields.map(k=>[k,rows.reduce((n,row)=>n+Number(row[k]||0),0)]));
  return {ok:true,readOnly:true,source:'D_DRIVE_ISOLATION_COPY',
    dates:rows.map(row=>Object.fromEntries(['date',...fields].map(k=>[k,row[k]]))),totals,
    note:'POD时间锁仅为原始候选数量，尚未验证时间格式、凭据来源与Excel签收时效，不是可信POD时间'};
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
         '旧OPEN终态'+row.openLedgerWithTerminalLabels,'TMS60='+row.persistedTms60,
         'TMS80='+row.persistedTms80,'TMS81='+row.persistedTms81,
         'POD时间锁候选'+row.podTimeLockCandidates].join(' | '));
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
