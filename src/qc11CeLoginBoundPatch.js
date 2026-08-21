import { CEClient } from './ceClient.js';

export const QC11_CE_LOGIN_BOUND_VERSION='2026-08-21-qc11-ce-login-10s-v1';
const PATCHED=Symbol.for('ce-qc.qc11-ce-login-bounded');
const TIMEOUT_MS=Math.max(3_000,Math.min(15_000,Number(process.env.CE_LOGIN_TIMEOUT_MS||10_000)));

if(!CEClient.prototype[PATCHED]){
  const original=CEClient.prototype.login;
  Object.defineProperty(CEClient.prototype,PATCHED,{value:true});
  CEClient.prototype.login=async function qc11BoundedCeLogin(...args){
    let timer;
    const timeout=new Promise((_,reject)=>{
      timer=setTimeout(()=>{
        const error=new Error(`CE API登录${Math.round(TIMEOUT_MS/1000)}秒内未响应，请检查CE网络或账号后重试。`);
        error.code='CE_LOGIN_TIMEOUT';
        reject(error);
      },TIMEOUT_MS);
      timer.unref?.();
    });
    try{return await Promise.race([original.apply(this,args),timeout]);}
    finally{clearTimeout(timer);}
  };
}

console.log(`[CE-QC][QC11] CE API login bounded to ${TIMEOUT_MS}ms; login clicks cannot hang indefinitely.`);
