import express from 'express';
import { readV295FirstAttemptTrends, V295_FIRST_ATTEMPT_TRUTH_ID } from './v295FirstAttemptTruth.js';
import { V295_FIRST_ATTEMPT_METRIC_ID } from './v295FirstAttemptMetric.js';

export const V295_FIRST_ATTEMPT_ROUTE_ID = '2026-08-25-v299-first-attempt-direct-only-v3';
const DIRECT_PATH = '/api/v295/first-attempt-trends';
const previousGet = express.application.get;
let directRegistered = false;

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
    return res.json(data);
  } catch (error) {
    return res.status(400).json({ok:false,id:V295_FIRST_ATTEMPT_ROUTE_ID,error:error?.message||String(error)});
  }
}
function ensureDirectRoute(app){
  if(directRegistered)return;
  directRegistered=true;
  previousGet.call(app,DIRECT_PATH,directHandler);
}

// V299 deliberately keeps first-attempt truth off /api/v253/trends and
// /api/v263/delivery-trends. Those routes are the primary paint path and must stay
// lightweight. The visible first-attempt card/trend owns one separate exact request.
express.application.get = function v295FirstAttemptDirectOnlyRegistration(pathValue,...handlers){
  ensureDirectRoute(this);
  return previousGet.call(this,pathValue,...handlers);
};

console.info('[CE-QC][V299_FIRST_ATTEMPT_ROUTE]',V295_FIRST_ATTEMPT_ROUTE_ID,'direct-only exact /api/v295/first-attempt-trends; V253/V263 primary trend responses are no longer synchronously overlaid, eliminating duplicate heavy SQLite truth reads during chart paint.');
