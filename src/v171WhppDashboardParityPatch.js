import express from 'express';
import { getDb } from './db.js';

const PATCH_ID='2026-08-17-v171-whpp-dashboard-parity-v1';
const ROUTE='/api/v171/whpp-trends';

function dateOnly(value=''){
  const text=String(value||'').trim().slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}
function safeJson(value,fallback={}){try{return value&&typeof value==='object'?value:(JSON.parse(String(value||''))||fallback);}catch{return fallback;}}
function num(value){const n=Number(value||0);return Number.isFinite(n)?n:0;}
function rate(value,total){return total?Number((num(value)*100/num(total)).toFixed(2)):0;}

function build(reportDate=''){
  const db=getDb();
  const requested=dateOnly(reportDate);
  const anchor=requested||String(db.prepare("SELECT reportDate FROM business_daily_reports WHERE businessType='WHPP' ORDER BY reportDate DESC LIMIT 1").get()?.reportDate||'');
  if(!anchor)return {ok:true,patchId:PATCH_ID,reportDate:'',dates:[],ticket:[],podRate:[],ocRate:[],returnRate:[]};
  const rows=db.prepare(`
    SELECT d.reportDate,d.totalCount,h.summaryJson
    FROM business_daily_reports d
    LEFT JOIN business_history_summary h ON h.businessType=d.businessType AND h.reportDate=d.reportDate
    WHERE d.businessType='WHPP' AND d.reportDate<=?
    ORDER BY d.reportDate DESC
    LIMIT 7
  `).all(anchor).reverse();
  const dates=[];const ticket=[];const podRate=[];const ocRate=[];const returnRate=[];
  for(const row of rows){
    const total=num(row.totalCount);
    const summary=safeJson(row.summaryJson,{});
    dates.push(String(row.reportDate||''));
    ticket.push(total);
    podRate.push(row.summaryJson?num(summary.podRate):0);
    const ocCount=num(summary.oc1??summary.oc2??summary.oc3);
    ocRate.push(row.summaryJson?rate(ocCount,total):0);
    returnRate.push(row.summaryJson?num(summary.returnRate):0);
  }
  return {ok:true,patchId:PATCH_ID,reportDate:anchor,dates,ticket,podRate,ocRate,returnRate};
}

const previousListen=express.application.listen;
let installed=false;
express.application.listen=function v171WhppDashboardParityListen(...args){
  if(!installed){
    installed=true;
    this.get(ROUTE,(req,res)=>{
      try{
        res.setHeader('Cache-Control','private, max-age=10');
        res.json(build(req.query.reportDate||req.query.date||''));
      }catch(error){
        res.status(500).json({ok:false,patchId:PATCH_ID,error:error?.message||String(error)});
      }
    });
  }
  return previousListen.apply(this,args);
};

export function inspectV171WhppDashboardParity(reportDate=''){return build(reportDate);}
export const V171_WHPP_DASHBOARD_PARITY_PATCH_ID=PATCH_ID;
