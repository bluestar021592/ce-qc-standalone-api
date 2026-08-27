export const V339_CCSL_THROUGHPUT_CORE_ID='2026-08-27-v339-ccsl-hard-bounded-confirm-prefetch-v3';

function clampInt(value,min,max,fallback){
  const parsed=Number(value);
  if(!Number.isFinite(parsed))return fallback;
  return Math.max(min,Math.min(max,Math.trunc(parsed)));
}

export const V339_CCSL_CONFIRM_CONCURRENCY=clampInt(process.env.CCSL_CONFIRM_CONCURRENCY,1,2,2);
export const V339_CCSL_CONFIRM_HARD_BUDGET_MS=clampInt(process.env.CE_CONFIRM_HARD_BUDGET_MS,1000,30000,18000);

function clean(values=[]){
  return [...new Set((values||[]).map(value=>String(value||'').trim().toUpperCase()).filter(Boolean))];
}
function key(values=[]){return clean(values).join('\u001f');}
function successful(statusRows=[]){
  return new Set((statusRows||[]).filter(row=>String(row?.status||'')==='success').map(row=>String(row?.shipmentCode||'').trim().toUpperCase()).filter(Boolean));
}
function stableBatches(sourceBills=[],completed=new Set(),width=350){
  const source=clean(sourceBills),out=[];
  for(let i=0;i<source.length;i+=width){
    const batch=source.slice(i,i+width).filter(code=>!completed.has(code));
    if(batch.length)out.push(batch);
  }
  return out;
}
function boundedQuery(query,batch,budgetMs){
  let timer;
  const timeout=new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      const error=new Error(`V339 CCSL confirm prefetch exceeded ${budgetMs}ms`);
      error.code='V339_CCSL_PREFETCH_HARD_TIMEOUT';
      reject(error);
    },budgetMs);
  });
  return Promise.race([Promise.resolve().then(()=>query(batch)),timeout]).finally(()=>clearTimeout(timer));
}

export function createCcslThroughputClient(state={},client,options={}){
  if(!client||typeof client!=='object'||typeof client.confirmQuery!=='function')return client;
  const rawConfirm=client.confirmQuery.bind(client);
  const width=350;
  const limit=clampInt(options.confirmConcurrency,1,2,V339_CCSL_CONFIRM_CONCURRENCY);
  const budget=clampInt(options.hardBudgetMs,50,30000,V339_CCSL_CONFIRM_HARD_BUDGET_MS);
  const cache=new Map();
  const queue=[];
  let active=0,launched=false;
  let plannedKeys=new Set();

  function pump(){
    while(active<limit&&queue.length){
      const job=queue.shift();
      active+=1;
      boundedQuery(rawConfirm,job.batch,budget)
        .then(value=>job.finish({ok:true,value}),error=>job.finish({ok:false,error}))
        .finally(()=>{active-=1;pump();});
    }
  }
  function enqueue(batch){
    const normalized=clean(batch);
    if(!normalized.length)return null;
    const k=key(normalized);
    if(cache.has(k))return cache.get(k);
    let finish;
    const settled=new Promise(resolve=>{finish=resolve;});
    const entry={key:k,batch:normalized,settled};
    cache.set(k,entry);
    queue.push({batch:normalized,finish});
    pump();
    return entry;
  }
  function launch(focusBatch=[]){
    if(launched)return;
    launched=true;
    const completed=successful(state.scanQueryStatus||[]);
    let batches=stableBatches(state.scanPool||state.pnhBills||[],completed,width);
    plannedKeys=new Set(batches.map(key));
    const focusKey=key(focusBatch);
    if(focusKey&&plannedKeys.has(focusKey))batches=[...batches.filter(batch=>key(batch)===focusKey),...batches.filter(batch=>key(batch)!==focusKey)];
    console.info('[CE-QC][V339_CCSL_PREFETCH]',JSON.stringify({batchSize:width,concurrency:limit,batches:batches.length,completedBills:completed.size,hardBudgetMs:budget,planMode:'stable-filter'}));
    for(const batch of batches)enqueue(batch);
  }
  async function request(codes=[]){
    const batch=clean(codes);
    if(!batch.length)return[];
    launch(batch);
    const k=key(batch);
    // Adaptive fallback children must remain under the native V337/V338
    // queryBatchWithFallback owner instead of being prefetched.
    if(!plannedKeys.has(k))return rawConfirm(batch);
    const entry=cache.get(k)||enqueue(batch);
    const settled=await entry.settled;
    if(!settled.ok){cache.delete(k);throw settled.error;}
    return settled.value;
  }
  const pool={request,stats:()=>({active,queued:queue.length,cached:cache.size,planned:plannedKeys.size,launched,batchSize:width,concurrency:limit,hardBudgetMs:budget})};
  return new Proxy(client,{
    get(target,prop){
      if(prop==='confirmQuery')return codes=>request(codes);
      if(prop==='__v339CcslConfirmPool')return pool;
      const value=Reflect.get(target,prop,target);
      return typeof value==='function'?value.bind(target):value;
    }
  });
}
