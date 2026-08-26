import express from 'express';
import { readV295FirstAttemptTrends, V295_FIRST_ATTEMPT_TRUTH_ID } from './v295FirstAttemptTruth.js';
import { V295_FIRST_ATTEMPT_METRIC_ID } from './v295FirstAttemptMetric.js';

export const V295_FIRST_ATTEMPT_ROUTE_ID = '2026-08-25-v299-first-attempt-direct-only-v3';
export const V326_FIRST_ATTEMPT_ROUTE_REGISTRATION_ID = '2026-08-26-v326-real-app-first-attempt-route-v1';
const DIRECT_PATH = '/api/v295/first-attempt-trends';
const previousGet = express.application.get;
const registeredApps = new WeakSet();

function dateKey(value=''){return String(value||'').slice(0,10);}
function directHandler(req,res){
  try {
    const type = String(req.query?.businessType || 'HOME').toUpperCase();
    const from = dateKey(req.query?.from || req.query?.to);
    const to = dateKey(req.query?.to || from);
    if (!from || !to || from > to) throw new Error('V295日期范围无效');
    const data = readV295FirstAttemptTrends(type, from, to);
    res.setHeader?.('Cache-Control','private,max-age=5');
    res.setHeader?.('X-CE-QC-V295-First-Attempt',V295_FIRST_ATTEMPT_ROUTE_ID);
    res.setHeader?.('X-CE-QC-V295-Truth',V295_FIRST_ATTEMPT_TRUTH_ID);
    res.setHeader?.('X-CE-QC-V295-Metric',V295_FIRST_ATTEMPT_METRIC_ID);
    res.setHeader?.('X-CE-QC-V326-Route',V326_FIRST_ATTEMPT_ROUTE_REGISTRATION_ID);
    return res.json(data);
  } catch (error) {
    return res.status(400).json({ok:false,id:V295_FIRST_ATTEMPT_ROUTE_ID,registrationId:V326_FIRST_ATTEMPT_ROUTE_REGISTRATION_ID,error:error?.message||String(error)});
  }
}
function isRealApp(app){
  return Boolean(app&&app!==express.application&&typeof app.use==='function'&&typeof app.route==='function'&&app.settings&&typeof app.settings==='object');
}
function ensureDirectRoute(app){
  if(!isRealApp(app)||registeredApps.has(app))return false;
  registeredApps.add(app);
  previousGet.call(app,DIRECT_PATH,directHandler);
  console.info('[CE-QC][V326_FIRST_ATTEMPT_ROUTE]',V326_FIRST_ATTEMPT_ROUTE_REGISTRATION_ID,'registered direct first-attempt route on concrete Express app; prototype/sub-app probes cannot consume the registration slot.');
  return true;
}

// V299 deliberately keeps first-attempt truth off /api/v253/trends and
// /api/v263/delivery-trends. Those routes are the primary paint path and must stay
// lightweight. V326 only fixes concrete-app route ownership so the visible
// first-attempt card/trend cannot receive a 404 after an earlier prototype probe.
express.application.get = function v326FirstAttemptDirectOnlyRegistration(pathValue,...handlers){
  const path=typeof pathValue==='string'?pathValue:'';
  if(path.startsWith('/')&&path!==DIRECT_PATH)ensureDirectRoute(this);
  return previousGet.call(this,pathValue,...handlers);
};

console.info('[CE-QC][V299_FIRST_ATTEMPT_ROUTE]',V295_FIRST_ATTEMPT_ROUTE_ID,'direct-only exact /api/v295/first-attempt-trends; V253/V263 primary trend responses are no longer synchronously overlaid, eliminating duplicate heavy SQLite truth reads during chart paint.');
