import assert from 'node:assert/strict';
import express from 'express';

process.env.NODE_ENV='test';
process.env.CI='1';

const originalGet=express.application.get;
const registrations=[];
express.application.get=function captureGet(pathValue,...handlers){
  registrations.push({path:String(pathValue||''),handlers});
  return this;
};

try{
  await import(`../src/v286V253TrendTruthBridge.js?smoke=${Date.now()}`);
  await import(`../src/v253DashboardFastPath.js?smoke=${Date.now()}`);
  const currentGet=express.application.get;
  const dummyApp={};
  currentGet.call(dummyApp,'/api/v234/trends',()=>{});
  const visible=registrations.filter(row=>row.path==='/api/v253/trends');
  assert.equal(visible.length,1,'V253 visible trend route must be registered exactly once through the V286 bridge');
  const handlerSource=String(visible[0].handlers?.[0]||'');
  assert.match(handlerSource,/readV284ProvenDashboardTrends/,'visible /api/v253/trends handler must call V284 proven daily-membership truth');
  assert.match(handlerSource,/visibleTruthBridge/,'visible handler must expose V286 bridge observability');
  assert.doesNotMatch(handlerSource,/readV253DashboardTrends/,'legacy V253 trend SQL handler must not become the visible route');
  const trigger=registrations.filter(row=>row.path==='/api/v234/trends');
  assert.equal(trigger.length,1,'original V234 registration must still pass through after V253 installs its routes');
  console.log('[V286] visible V253 route smoke passed · authenticated V253 URL is substituted with V284 proven seven-business truth');
} finally {
  express.application.get=originalGet;
}
