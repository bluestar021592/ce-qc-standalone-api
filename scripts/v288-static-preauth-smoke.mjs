import assert from 'node:assert/strict';
import express from 'express';

const originalUse=express.application.use;
await import(`../src/v288StaticAssetPreAuthPatch.js?smoke=${Date.now()}`);

const app=express();
app.use(express.json());
function accessIdentity(req,res,next){
  if(req.path==='/allow-after-auth')return next();
  return res.status(401).json({ok:false,auth:'required'});
}
app.use(accessIdentity);
app.get('/allow-after-auth',(req,res)=>res.json({ok:true}));

assert.equal(express.application.use,originalUse,'V288 must restore express.application.use immediately after accessIdentity registration');

const server=await new Promise((resolve,reject)=>{
  const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));
  instance.once('error',reject);
});
const address=server.address();
const base=`http://127.0.0.1:${address.port}`;
try{
  const asset=await fetch(`${base}/dashboard-v18.js?smoke=1`);
  assert.equal(asset.status,200,'known JS asset must bypass DB-backed auth');
  assert.equal(asset.headers.get('x-ce-qc-v288-static'),'2026-08-24-v288-static-assets-before-db-auth-v1');
  const body=await asset.text();
  assert.match(body,/DashboardV18|dashboard/i,'served asset must be the real JS file');

  const css=await fetch(`${base}/dashboard-v18.css?smoke=1`);
  assert.equal(css.status,200,'known CSS asset must bypass DB-backed auth');
  assert.equal(css.headers.get('x-ce-qc-v288-static'),'2026-08-24-v288-static-assets-before-db-auth-v1');

  const html=await fetch(`${base}/index.html`);
  assert.equal(html.status,401,'HTML must remain behind accessIdentity');
  const root=await fetch(`${base}/`);
  assert.equal(root.status,401,'root navigation must remain behind accessIdentity');
  const api=await fetch(`${base}/api/health`);
  assert.equal(api.status,401,'API must remain behind accessIdentity');
  const missing=await fetch(`${base}/missing-v288-probe.js`);
  assert.equal(missing.status,404,'missing static assets must return 404 without falling into auth HTML');
}finally{
  await new Promise(resolve=>server.close(resolve));
}

console.log('[V288] static pre-auth smoke passed · JS/CSS bypass SQLite auth · HTML/root/API stay 401 · express.use hook self-restores');
