import { getDb,closeDb } from '../src/db.js';
import { readV320HistoricalDailyWithDispatch } from '../src/v320DispatchMetricOverlay.js';
import { writeV334GenericHistoryCache,V334_GENERIC_HISTORY_TYPES } from '../src/v334GenericHistoryCache.js';

const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return i>0?[v.slice(0,i).replace(/^--/,''),v.slice(i+1)]:[v.replace(/^--/,''),'1'];}));
const type=String(args.type||'').toUpperCase(),to=String(args.to||'').slice(0,10),TYPES=new Set(V334_GENERIC_HISTORY_TYPES);
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''));
const send=p=>{try{process.send?.({kind:'V334_GENERIC_HISTORY_PROGRESS',type,...p});}catch{}};

async function main(){
  if(!TYPES.has(type)||!validDate(to))throw new Error('V334 generic worker requires --type=CE|CEAF|ALI1688|WHPP|ALL and --to=YYYY-MM-DD');
  send({status:'RUNNING',phase:'HISTORY_BUILD',cacheReady:false,message:`${type} 正在独立进程重建已保存历史趋势缓存`});
  const db=getDb(),started=Date.now();
  const data=readV320HistoricalDailyWithDispatch(type,to,to,{db,expandSingle:true});
  const rows=(data.daily||[]).filter(row=>Number(row.total||0)>0).map(row=>({reportDate:row.reportDate,total:Number(row.total||0),pod:Number(row.pod||0),ocCurrent:Number(row.ocCurrent||0),sameDayPod:Number(row.sameDayPod||0),ready:row.ready!==false}));
  const written=writeV334GenericHistoryCache(type,rows,db,'V334_ISOLATED_V320_PERSISTED_HISTORY');
  send({status:'COMPLETED',phase:'DONE',cacheReady:true,rowCount:written.rowCount,fromDate:rows[0]?.reportDate||to,toDate:rows.at(-1)?.reportDate||to,elapsedMs:Date.now()-started,message:`${type} 已生成 ${written.rowCount} 个历史日报趋势缓存，不占用网页线程`});
}
try{await main();}catch(error){send({status:'FAILED',phase:'FAILED',cacheReady:false,message:error?.message||String(error)});process.exitCode=1;}finally{try{closeDb();}catch{}}
