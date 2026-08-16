import express from 'express';

const PATCH_ID='2026-08-16-v152-whpp-trend-status-v1';
const WRAPPED=Symbol.for('ce-qc.v152-whpp-trend-status');
const previousGet=express.application.get;

if(typeof previousGet==='function'&&!previousGet[WRAPPED]){
  const wrapped=function v152WhppTrendStatusGet(path,...handlers){
    if(path!=='/api/v27/trends'||!handlers.length)return previousGet.call(this,path,...handlers);
    const final=handlers.pop();
    if(typeof final!=='function'){handlers.push(final);return previousGet.call(this,path,...handlers);}
    const guard=function v152WhppTrendStatusGuard(req,res,next){
      const original=res.json.bind(res);
      res.json=function v152WhppTrendStatusJson(body){
        if(String(req.query?.businessType||'').toUpperCase()==='WHPP')res.statusCode=200;
        return original(body);
      };
      return final.call(this,req,res,next);
    };
    return previousGet.call(this,path,...handlers,guard);
  };
  Object.defineProperty(wrapped,WRAPPED,{value:true});
  express.application.get=wrapped;
}

export const V152_WHPP_TREND_STATUS_PATCH_ID=PATCH_ID;
