import express from 'express';

export const V153_RUNTIME_BUILD_ID='2026-08-15-v153-runtime-build-sync-v1';
let installed=false;
const previousListen=express.application.listen;

express.application.listen=function v153RuntimeBuildListen(...args){
  if(!installed){
    installed=true;
    this.get('/api/runtime-build',(req,res)=>{
      res.setHeader('Cache-Control','no-store, max-age=0');
      res.json({ok:true,buildId:process.env.CE_QC_UI_BUILD_ID||V153_RUNTIME_BUILD_ID});
    });
  }
  return previousListen.apply(this,args);
};
