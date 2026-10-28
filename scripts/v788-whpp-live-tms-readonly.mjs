// V788 TMS stage-1 audit. Explicit opt-in only; read D-drive isolation-copy DB,
// and query the already-authorized CE TMS shipmentStatus endpoint without ANY writes.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {CEClient} from '../src/ceClient.js';
import {loadTokenSync} from '../src/authStore.js';
import {auditV788WhppLiveTms} from '../src/v788WhppLiveTmsReadonly.js';

const dbFile=String.raw`D:\CE_QC_V788_验收副本\ce_qc_monitor.db`;
const safeMessage={
  INVALID_INPUT:'程序参数缺失',INVALID_SOURCE_MEMBER:'WHPP来源包含无效成员',
  CROSS_DATE_DUPLICATE_WAYBILL:'两天来源中存在重复运单，需要确认归属日期',
  SOURCE_MEMBERSHIP_CHANGED:'原始日报来源不再是190+156=346票，停止调用TMS',
  AMBIGUOUS_LOCAL_EVIDENCE:'本地状态或账本保存了重复键，需先核对',
  TMS_AUTH_REQUIRED:'CE登录已过期，请在原系统重新登录；未自动刷新或修改Token',
  TMS_QUERY_FAILED:'TMS请求异常，具体单号及错误凭据未输出',
  TMS_UNRECOGNIZED_RESPONSE:'TMS响应结构与约定不符，拒绝把内容当终态',
  TERMINAL_EVIDENCE_REVIEW_READY:'当前实时终态逐票吻合，但签收时间、Excel、账本仍待验收',
  TERMINAL_EVIDENCE_INCOMPLETE:'逐票终态证据不完整，禁止批量闭环',
  READONLY_COPY_MISSING:'D盘隔离副本不存在或无效',
  RUNTIME_NOT_SUPPORTED:'必须在具有本机CE登录状态的Windows环境执行',
  LIVE_QUERY_NOT_AUTHORIZED:'需要显式只读核验参数，未连接TMS',
  ORIGIN_NOT_ALLOWED:'CE接口域名不正确，已中止',
  TOKEN_MISSING_OR_EXPIRED:'未找到有效的已有CE登录信息，未尝试刷新或修改Token',
  DATABASE_READ_FAILED:'无法安全读取隔离数据库'
};
const say=(...v)=>console.log(...v);
function readLocalMembers(){
  const st=fs.lstatSync(dbFile);
  if(!st.isFile()||st.isSymbolicLink()||st.size<1024)throw new Error('READONLY_COPY_MISSING');
  const db=new DatabaseSync(dbFile,{readOnly:true});
  try{
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1500;');
    for(const name of ['business_daily_parse_rows','shipment_current_state','qc_tracking_ledger']){
      if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
        throw new Error('DATABASE_READ_FAILED');
    }
    return db.prepare(`
      WITH src AS (
        SELECT DISTINCT reportDate,UPPER(TRIM(shipmentCode)) shipmentCode
        FROM business_daily_parse_rows
        WHERE businessType='WHPP' AND reportDate IN ('2026-07-01','2026-07-02')
          AND TRIM(COALESCE(shipmentCode,''))<>''
      ), cur AS (
        SELECT reportDate,UPPER(TRIM(shipmentCode)) shipmentCode,COUNT(*) cnt,MIN(state) state
        FROM shipment_current_state WHERE businessType='WHPP'
        GROUP BY reportDate,UPPER(TRIM(shipmentCode))
      ), ledger AS (
        SELECT UPPER(TRIM(shipmentCode)) shipmentCode,COUNT(*) cnt,MIN(trackingStatus) trackingStatus
        FROM qc_tracking_ledger WHERE businessType='WHPP'
        GROUP BY UPPER(TRIM(shipmentCode))
      )
      SELECT s.reportDate,s.shipmentCode,c.state currentState,
        l.trackingStatus ledgerStatus,
        COALESCE(c.cnt,0) currentEvidenceRows,
        COALESCE(l.cnt,0) ledgerEvidenceRows
      FROM src s
      LEFT JOIN cur c ON c.reportDate=s.reportDate AND c.shipmentCode=s.shipmentCode
      LEFT JOIN ledger l ON l.shipmentCode=s.shipmentCode
      ORDER BY s.reportDate,s.shipmentCode
    `).all();
  }finally{db.close()}
}
async function main(){
  say('CE QC V788 | 真实TMS终态只读检查 (WHPP 190+156)');
  say('不写入数据库、不刷新Token、不执行状态同步、不清空数据；只输出聚合票数。');
  if(process.platform!=='win32')return 'RUNTIME_NOT_SUPPORTED';
  if(process.argv[2]!=='--live-tms-readonly')return 'LIVE_QUERY_NOT_AUTHORIZED';
  let members;
  try{members=readLocalMembers();}catch(e){
    return e?.message==='READONLY_COPY_MISSING'?'READONLY_COPY_MISSING':'DATABASE_READ_FAILED';
  }
  const counts={'2026-07-01':0,'2026-07-02':0};
  for(const m of members)if(Object.hasOwn(counts,m.reportDate))counts[m.reportDate]++;
  if(counts['2026-07-01']!==190||counts['2026-07-02']!==156||members.length!==346)
    return 'SOURCE_MEMBERSHIP_CHANGED';
  const token=loadTokenSync();
  if(!token?.access_token||!Number.isFinite(token.expires_at)
    ||token.expires_at<=Date.now()+60_000)return 'TOKEN_MISSING_OR_EXPIRED';
  const client=new CEClient();
  let origin='';
  try{origin=new URL(client.baseURL).origin;}catch{}
  if(origin!=='https://otwms.cambodianexpress.com')return 'ORIGIN_NOT_ALLOWED';
  // Directly use HTTP with the already-saved token; do NOT call client.shipmentTrack(),
  // whose auth refresh logic could clear or rewrite local credentials.
  const query=async codes=>{
    const response=await client.http.post('/api/tms-shipment/track',codes,{
      headers:client.headers(),timeout:15000,maxRedirects:0
    });
    if(response?.data?.success!==true||!Array.isArray(response.data.data)){
      const e=new Error('TMS_UNRECOGNIZED_RESPONSE');
      throw e;
    }
    return response.data.data;
  };
  const result=await auditV788WhppLiveTms({members,query,batchSize:25});
  for(const [date,d] of Object.entries(result.dates)){
    say(date+' | 来源 '+d.sourceMembers+' | POD标签 '+d.podLabels
      +' | 退回标签 '+d.returnedLabels+' | 实时60 '+d.tmsPOD60
      +' | 实时80 '+d.tmsReturning80+' | 实时81 '+d.tmsReturned81);
    say('   逐票匹配 POD='+d.matchedPOD+' 退回='+d.matchedReturned
      +' | TMS缺失='+d.missingTms+' 重复='+d.duplicateTms
      +' 矛盾='+d.terminalConflict+' | OPEN账本标签='+d.openLedgerTerminal);
  }
  say('TMS结果：'+(safeMessage[result.outcome]||'未知阻断')+'。');
  say('注意：本次不证明POD真实签收时间，不核对Excel，也不修复OPEN账本。');
  say('发布及清空：BLOCKED（禁止）。');
  return result.outcome;
}
try{
  const code=await main();
  if(!['TERMINAL_EVIDENCE_REVIEW_READY','TERMINAL_EVIDENCE_INCOMPLETE'].includes(code))
    say('检查结束：'+(safeMessage[code]||'异常')+'；未修改正式5177。');
}catch{
  say('检查结果：BLOCKED，出现只读检查异常；不显示密钥、运单号或接口原始报文。');
}
process.exitCode=10; // Never a release, import, purge, or deployment gate.
