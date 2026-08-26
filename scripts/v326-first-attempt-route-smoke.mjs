import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';

await import('../src/v295FirstAttemptRoutePatch.js');

async function probe(appLabel){
  const app=express();
  app.get('/probe',(req,res)=>res.json({ok:true,label:appLabel}));
  app.get('/probe-two',(req,res)=>res.json({ok:true,label:appLabel}));
  const server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  try{
    const address=server.address();
    const base=`http://127.0.0.1:${address.port}`;
    const response=await fetch(`${base}/api/v295/first-attempt-trends?businessType=HOME&from=bad&to=bad`);
    const payload=await response.json();
    assert.equal(response.status,400,'V326 direct route must exist; invalid range should hit handler, never 404');
    assert.equal(payload.id,'2026-08-25-v299-first-attempt-direct-only-v3');
    assert.equal(payload.registrationId,'2026-08-26-v326-real-app-first-attempt-route-v1');
    const normal=await fetch(`${base}/probe`);
    assert.equal(normal.status,200);
  }finally{
    await new Promise(resolve=>server.close(resolve));
  }
}

await probe('A');
await probe('B');
console.log('[V326] first-attempt concrete-route smoke passed · two real Express apps both receive /api/v295/first-attempt-trends · prototype probes cannot consume registration');
