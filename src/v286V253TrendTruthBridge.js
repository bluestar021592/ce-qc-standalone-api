import express from 'express';
import { V284_DAILY_MEMBERSHIP_TRUTH_ID } from './v284DailyMembershipTruth.js';
import { V284_EVIDENCE_COVERAGE_ID, readV284ProvenDashboardTrends } from './v284MembershipEvidenceCoverage.js';

export const V286_V253_TREND_BRIDGE_ID='2026-08-24-v286-v253-visible-trend-proven-truth-bridge-v1';
const V253_COMPAT_ID='2026-08-23-v259-scoped-dashboard-fastpath-v4';
const previousGet=express.application.get;
let routeInstalled=false;

function handler(req,res){
  try{
    const data=readV284ProvenDashboardTrends(req.query.businessType,req.query.from,req.query.to);
    res.setHeader('Cache-Control','private,max-age=15');
    res.setHeader('X-CE-QC-V253',V253_COMPAT_ID);
    res.setHeader('X-CE-QC-V284',V284_DAILY_MEMBERSHIP_TRUTH_ID);
    res.setHeader('X-CE-QC-V286',V286_V253_TREND_BRIDGE_ID);
    return res.json({...data,readId:V253_COMPAT_ID,visibleTruthBridge:V286_V253_TREND_BRIDGE_ID,evidenceCoverageId:V284_EVIDENCE_COVERAGE_ID,source:'V286_VISIBLE_V253_TO_V284_PROVEN_SEVEN_BUSINESS_TRUTH'});
  }catch(error){
    return res.status(500).json({ok:false,error:error?.message||String(error),readId:V253_COMPAT_ID,visibleTruthBridge:V286_V253_TREND_BRIDGE_ID});
  }
}

// V253 registers its route later, after auth, by calling the express.get function
// that existed when V253 was imported. Because this bridge is installed before
// server/V253 import, V253's previousGet points here. Only /api/v253/trends is
// substituted; instant-summary and exact Shopee region endpoints stay untouched.
express.application.get=function v286V253TrendTruthBridge(pathValue,...handlers){
  const path=String(pathValue||'');
  if(path==='/api/v253/trends'){
    if(!routeInstalled){
      routeInstalled=true;
      previousGet.call(this,pathValue,handler);
      console.info('[CE-QC][V286_VISIBLE_TRENDS]',V286_V253_TREND_BRIDGE_ID,'/api/v253/trends is now served by V284 proven seven-business membership truth; legacy V253 trend SQL is not registered.');
    }
    return this;
  }
  return previousGet.call(this,pathValue,...handlers);
};

console.info('[CE-QC][V286_VISIBLE_TRENDS]',V286_V253_TREND_BRIDGE_ID,'armed before server import; waits for authenticated V253 route registration and substitutes only the visible trend endpoint.');
