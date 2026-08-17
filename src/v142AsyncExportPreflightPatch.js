import express from 'express';
import './v189ExportPrepareImmediateAckPatch.js';
import { auditSevenBusinessHistory } from './v142SevenBusinessHistoryAudit.js';

const PATCH_ID='2026-08-17-v142-v84-async-export-preflight-v3';
const PREPARE_PATH='/api/export-period/prepare';
const WRAPPED=Symbol.for('ce-qc.v142-async-export-preflight');
let preflightRouteInstalled=false;

function iso(v=''){const t=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(t)?t:'';}
function localIso(d){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function resolveRange(body={}){
  const type=String(body.periodType||'daily');
  if(type==='custom')return {from:iso(body.fromDate),to:iso(body.toDate)};
  const anchor=iso(body.date);if(!anchor)return {from:'',to:''};const d=new Date(`${anchor}T12:00:00+07:00`);
  if(type==='weekly'){const offset=(d.getDay()+6)%7;const s=new Date(d);s.setDate(s.getDate()-offset);const e=new Date(s);e.setDate(e.getDate()+6);return {from:localIso(s),to:localIso(e)};}
  if(type==='monthly'){const from=`${anchor.slice(0,7)}-01`;const e=new Date(d.getFullYear(),d.getMonth()+1,0,12);return {from,to:localIso(e)};}
  return {from:anchor,to:anchor};
}
function preflight(req,res,next){
  try{
    const businessType=String(req.body?.businessType||'ALL').trim().toUpperCase();
    if(businessType!=='ALL')return next();
    const range=resolveRange(req.body||{});if(!range.from||!range.to)return next();
    const audit=auditSevenBusinessHistory({fromDate:range.from,toDate:range.to});
    req.ceQcV142ExportAudit=audit;
    if(!audit.exportReady){
      const missing=audit.missingDates.join('、');
      const incomplete=audit.incompleteDates.slice(0,8).map(item=>`${item.reportDate}(${(item.issues||[]).join('/')})`).join('；');
      return res.status(409).json({ok:false,code:'SEVEN_BUSINESS_HISTORY_INCOMPLETE',patchId:PATCH_ID,error:`已阻止缺数据导出。${missing?`缺少日期：${missing}。`:''}${incomplete?`待修复：${incomplete}。`:''}`,audit:{fromDate:audit.fromDate,toDate:audit.toDate,expectedDays:audit.expectedDays,daysPresent:audit.daysPresent,totalImported:audit.totalImported,totalRetryPending:audit.totalRetryPending,missingDates:audit.missingDates,incompleteDates:audit.incompleteDates}});
    }
    next();
  }catch(error){res.status(409).json({ok:false,code:'SEVEN_BUSINESS_PREFLIGHT_FAILED',patchId:PATCH_ID,error:`七业务导出前完整性检查失败：${error.message||String(error)}`});}
}

const previousPost=express.application.post;
if(typeof previousPost==='function'&&!previousPost[WRAPPED]){
  const wrapped=function v142AsyncExportPreflightPost(pathValue,...handlers){
    if(String(pathValue||'')===PREPARE_PATH&&!preflightRouteInstalled){
      preflightRouteInstalled=true;
      this.route(PREPARE_PATH).post(preflight);
    }
    return previousPost.call(this,pathValue,...handlers);
  };
  Object.defineProperty(wrapped,WRAPPED,{value:true});express.application.post=wrapped;
}

export const V142_ASYNC_EXPORT_PREFLIGHT_ID=PATCH_ID;
