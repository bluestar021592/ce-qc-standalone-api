export const V505_PURGE_HTTP_ACTIVITY_ID='2026-09-11-v505-main-api-drain-v3-sse-auth-drain';
const PURGE_CONTROL=/^\/api\/admin\/data-purge\/(?:prepare|execute)$/;
const active=new Map();
let sequence=0;

function pathnameOf(req){return String(req.originalUrl||req.url||req.path||'').split('?')[0];}
function shouldTrack(req){
  const pathname=pathnameOf(req);
  if(!pathname.startsWith('/api/'))return false;
  if(PURGE_CONTROL.test(pathname))return false;
  return true;
}
function snapshot(){
  const now=Date.now();
  return [...active.values()].map(item=>({...item,ageMs:Math.max(0,now-item.startedAt)}));
}

export function v505TrackMainApiActivity(req,res,next){
  if(!shouldTrack(req))return next();
  const id=`${process.pid}:${++sequence}`;
  const item={id,method:String(req.method||'GET').toUpperCase(),pathname:pathnameOf(req),startedAt:Date.now()};
  active.set(id,item);
  let released=false;
  const release=()=>{
    if(released)return;
    released=true;
    active.delete(id);
    if(req.v505PurgeHttpActivityRelease===release)delete req.v505PurgeHttpActivityRelease;
  };
  req.v505PurgeHttpActivityRelease=release;
  res.once?.('finish',release);
  res.once?.('close',release);
  try{return next();}catch(error){release();throw error;}
}

export function inspectMainApiActivity(){
  const requests=snapshot();
  return {active:requests.length>0,count:requests.length,requests,gate:V505_PURGE_HTTP_ACTIVITY_ID};
}

export async function waitForMainApiDrain({timeoutMs=3000,pollMs=25}={}){
  const deadline=Date.now()+Math.max(0,Number(timeoutMs)||0);
  while(true){
    const state=inspectMainApiActivity();
    if(!state.active)return {...state,drained:true};
    if(Date.now()>=deadline)return {...state,drained:false};
    await new Promise(resolve=>setTimeout(resolve,Math.max(10,Number(pollMs)||25)));
  }
}
