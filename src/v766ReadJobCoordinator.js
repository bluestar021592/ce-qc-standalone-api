import {Worker} from 'node:worker_threads';
import {getRuntimeConfig} from './db.js';

// V766: long synchronous SQLite read computations cannot run on Express'
// event loop. One read-only worker is used per active job; same exact
// snapshot joins its in-flight work. Max two concurrent workers.
const active=new Map();
const settled=new Map();
let running=0;
const queue=[];
const MAX_CONCURRENT=2;
const MAX_QUEUE=20;
const MAX_RUN_MS=90000;
function cacheKey(kind,args){return kind+'|'+String(args.reportDate||'')+'|'+String(args.snapshotId||'')}
function completedFamilyProof(result){
  return ['CCSL','SHOPEE'].every(name=>{
    const item=result?.businesses?.[name];
    return item?.action==='DONE'&&item.exactMemberVerified===true
      &&Number(item.sourceCount)>0&&Number(item.scanCount)===Number(item.sourceCount)
      &&Number(item.finalCount)===Number(item.sourceCount);
  });
}
function start(entry){
  running++;
  const {key,kind,args,resolve,reject}=entry;
  const started=Date.now();
  let worker,timer,done=false;
  const finish=(error,result)=>{
    if(done)return;
    done=true;clearTimeout(timer);
    if(worker)void worker.terminate().catch(()=>{});
    running=Math.max(0,running-1);active.delete(key);
    if(error)reject(error);
    else{
      const ttl=kind==='FAMILY_PROOF'?(completedFamilyProof(result)?10*60*1000:5000):30000;
      settled.delete(key);
      settled.set(key,{result,at:Date.now(),ttl});
      while(settled.size>10)settled.delete(settled.keys().next().value);
      resolve({result,cache:'MISS',elapsedMs:Date.now()-started});
    }
    drain();
  };
  try{
    worker=new Worker(new URL('./v766HeavyReadWorker.mjs',import.meta.url),{
      env:{...process.env,CE_QC_DASHBOARD_READ_WORKER:'1'},
      workerData:{dbFile:getRuntimeConfig().dbFile}
    });
    timer=setTimeout(()=>finish(new Error('V766_READ_JOB_TIMEOUT')),MAX_RUN_MS);
    timer.unref?.();
    worker.on('message',msg=>{
      if(msg?.ok)finish(null,msg.result);
      else finish(new Error(String(msg?.error||'V766_READ_WORKER_FAILED')));
    });
    worker.once('error',error=>finish(error));
    worker.once('exit',code=>{if(!done)finish(new Error('V766_READ_WORKER_EXIT_'+code))});
    worker.postMessage({id:key,kind,...args});
  }catch(error){finish(error)}
}
function drain(){while(running<MAX_CONCURRENT&&queue.length)start(queue.shift())}
export function v766ReadJob(kind,args={}){
  if(!['FAMILY_PROOF','HOME_FULL'].includes(kind))return Promise.reject(new Error('V766_JOB_NOT_ALLOWED'));
  const key=cacheKey(kind,args), prior=settled.get(key);
  if(prior&&Date.now()-prior.at<prior.ttl)return Promise.resolve({result:prior.result,cache:'HIT',elapsedMs:0});
  if(active.has(key))return active.get(key);
  if(queue.length>=MAX_QUEUE)return Promise.reject(new Error('V766_READ_QUEUE_BUSY'));
  const promise=new Promise((resolve,reject)=>{queue.push({key,kind,args,resolve,reject});drain()});
  active.set(key,promise);
  return promise;
}
export function v766ClearReadCache(){settled.clear()}
export function v766ReadStats(){return{running,queued:queue.length,cached:settled.size}}
