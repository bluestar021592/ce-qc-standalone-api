import express from 'express';
import { networkInterfaces } from 'node:os';
import { getDb, getRuntimeConfig } from './db.js';
import { collectV202Rows, V202_DELIVERY_TRUTH_VERSION } from './v202DeliveryTruth.js';
import { statsOf, average } from './v200Metrics.js';
import { ensureV203ManualEvidenceSchema, V203_MANUAL_EVIDENCE_VERSION } from './v203ManualEvidenceStore.js';
import { inspectV203PublicTunnel } from './v203PublicTunnelSupervisor.js';

export const V203_DASHBOARD_INTEGRITY_VERSION='2026-08-18-v204-useful-dashboard-attempt-network-v4';
const CACHE_TTL_MS=Math.max(15_000,Math.min(10*60_000,Number(process.env.V203_ATTEMPT_CACHE_MS||60_000)));
const cache=new Map();
function dateKey(value=''){const m=String(value||'').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';}
function latestDate(){try{return String(getDb().prepare("SELECT reportDate FROM unified_import_batches WHERE status='VALID' ORDER BY reportDate DESC,createdAt DESC LIMIT 1").get()?.reportDate||'');}catch{return '';}}
function ratio(a,b){return b?Number(((Number(a||0)/Number(b))*100).toFixed(2)):0;}
function summarize(type,rows,range){
  const eligible=rows.filter(row=>row.metricEligible!==false);
  const stats=statsOf(eligible,range).overall;
  const manualRows=rows.filter(row=>row.metricEligible===false);
  return{
    businessType:type,total:stats.total,pod:stats.pod,a1:stats.a1,a2:stats.a2,a3:stats.a3,attemptUnknown:stats.attemptUnknown,
    a1Rate:ratio(stats.a1,stats.pod),a2Rate:ratio(stats.a2,stats.pod),a3Rate:ratio(stats.a3,stats.pod),unknownRate:ratio(stats.attemptUnknown,stats.pod),
    averageDays:average(stats.days),ppAverageDays:average(stats.ppDays),pvAverageDays:average(stats.pvDays),
    averageSamples:stats.days.length,ppAverageSamples:stats.ppDays.length,pvAverageSamples:stats.pvDays.length,manualEvidenceRows:manualRows.length
  };
}
function weighted(parts,field,sampleField){const denominator=parts.reduce((s,x)=>s+Number(x[sampleField]||0),0);return denominator?Number((parts.reduce((s,x)=>s+Number(x[field]||0)*Number(x[sampleField]||0),0)/denominator).toFixed(2)):0;}
async function attemptSummaryHandler(req,res){
  try{
    const latest=latestDate();const from=dateKey(req.query.fromDate)||latest;const to=dateKey(req.query.toDate)||from;
    if(!from||!to||from>to)return res.status(400).json({ok:false,error:'派次看板日期范围无效。'});
    const requested=String(req.query.businessType||'ALL').toUpperCase();
    const types=requested==='SHOPEECN'||requested==='SHOPEEVN'?[requested]:['SHOPEECN','SHOPEEVN'];
    const key=`${types.join(',')}|${from}|${to}`;const old=cache.get(key);if(old&&Date.now()-old.at<CACHE_TTL_MS){res.setHeader('Cache-Control','no-store');return res.json(old.value);}
    const range={from,to};const parts=[];
    for(const type of types){const rows=await collectV202Rows(type,range);parts.push(summarize(type,rows,range));}
    const combined={
      businessType:requested==='ALL'?'SHOPEE CN+VN':requested,
      total:parts.reduce((s,x)=>s+x.total,0),pod:parts.reduce((s,x)=>s+x.pod,0),a1:parts.reduce((s,x)=>s+x.a1,0),a2:parts.reduce((s,x)=>s+x.a2,0),a3:parts.reduce((s,x)=>s+x.a3,0),attemptUnknown:parts.reduce((s,x)=>s+x.attemptUnknown,0),manualEvidenceRows:parts.reduce((s,x)=>s+x.manualEvidenceRows,0),
      averageSamples:parts.reduce((s,x)=>s+x.averageSamples,0),ppAverageSamples:parts.reduce((s,x)=>s+x.ppAverageSamples,0),pvAverageSamples:parts.reduce((s,x)=>s+x.pvAverageSamples,0)
    };
    combined.a1Rate=ratio(combined.a1,combined.pod);combined.a2Rate=ratio(combined.a2,combined.pod);combined.a3Rate=ratio(combined.a3,combined.pod);combined.unknownRate=ratio(combined.attemptUnknown,combined.pod);
    combined.averageDays=weighted(parts,'averageDays','averageSamples');combined.ppAverageDays=weighted(parts,'ppAverageDays','ppAverageSamples');combined.pvAverageDays=weighted(parts,'pvAverageDays','pvAverageSamples');
    const value={ok:true,version:V203_DASHBOARD_INTEGRITY_VERSION,truthVersion:V202_DELIVERY_TRUTH_VERSION,range,combined,parts,rule:{attempt:'真实开始派送(4003/70/日报W-Y)→本次失败Pending/150→再次真实开始派送=下一派；代码60、经过天数、Pending条数不制造派次。',average:'下单日期→真实POD日期，首尾自然日计1天；仅有真实下单时间和POD时间的票进入平均值。',denominator:'派次占比以POD票数为分母；证据不足单独显示，不强行算1派。'},generatedAt:new Date().toISOString()};
    cache.set(key,{at:Date.now(),value});res.setHeader('Cache-Control','no-store');res.json(value);
  }catch(error){res.status(500).json({ok:false,error:error.message});}
}
function lanIps(){const out=[];for(const list of Object.values(networkInterfaces()))for(const item of list||[]){if(item.family!=='IPv4'||item.internal||/^169\.254\./.test(item.address))continue;if(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address))out.push(item.address);}return[...new Set(out)];}
function networkHandler(req,res){
  const cfg=getRuntimeConfig();const ips=lanIps();const publicHostname=String(process.env.PUBLIC_HOSTNAME||'').trim();const publicOrigin=String(process.env.PUBLIC_ORIGIN||'').trim();const cfConfigured=Boolean(String(process.env.CF_ACCESS_TEAM_DOMAIN||'').trim()&&String(process.env.CF_ACCESS_AUD||'').trim());const direct=String(process.env.PUBLIC_DIRECT_ENABLED||'').trim()==='1';const tunnel=inspectV203PublicTunnel();
  const namedOrigin=publicOrigin||(publicHostname?`https://${publicHostname}`:'');
  const quickOrigin=String(tunnel.quickUrl||'').trim();
  const tunnelReady=tunnel.status==='RUNNING';
  const namedApplicationReady=Boolean(publicHostname&&(cfConfigured||direct));
  const quickApplicationReady=Boolean(tunnel.mode==='QUICK'&&quickOrigin&&tunnelReady);
  const activeOrigin=quickApplicationReady?quickOrigin:namedOrigin;
  const applicationReady=namedApplicationReady||quickApplicationReady;
  const publicReady=quickApplicationReady||(namedApplicationReady&&tunnelReady);
  res.setHeader('Cache-Control','no-store');res.json({ok:true,version:V203_DASHBOARD_INTEGRITY_VERSION,bind:{host:cfg.host,port:cfg.port,lanEnabled:cfg.host==='0.0.0.0',localUrl:`http://127.0.0.1:${cfg.port}`,lanUrls:ips.map(ip=>`http://${ip}:${cfg.port}`)},public:{hostname:publicHostname,origin:activeOrigin,configuredOrigin:namedOrigin,quickOrigin,cloudflareAccessConfigured:cfConfigured,directPublicEnabled:direct,applicationReady,tunnelConfigured:tunnel.configured,tunnelMode:tunnel.mode,tunnelStatus:tunnel.status,tunnelRunning:tunnelReady,tunnelPid:tunnel.pid,publicReady,security:'公网入口必须保留系统账号登录。Named Tunnel + Cloudflare Access最稳定；未配置Named Tunnel时可自动使用临时Quick Tunnel。',lastTunnelError:tunnel.lastError||'',quickTemporary:tunnel.mode==='QUICK'},manualEvidenceVersion:V203_MANUAL_EVIDENCE_VERSION});
}
let installed=false;const previousListen=express.application.listen;
express.application.listen=function v204DashboardIntegrityListen(...args){if(!installed){installed=true;ensureV203ManualEvidenceSchema();this.get('/api/v203/attempt-summary',attemptSummaryHandler);this.get('/api/v203/network-access',networkHandler);}return previousListen.apply(this,args);};
export function inspectV203DashboardIntegrity(){return{version:V203_DASHBOARD_INTEGRITY_VERSION,cacheSize:cache.size,cacheTtlMs:CACHE_TTL_MS};}
