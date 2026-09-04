import * as legacyPipeline from './pipelineLegacy.js';
import { getExactValidUnifiedBatch, prepareUnifiedRunState } from './unifiedRunPreparation.js';

export * from './pipelineLegacy.js';

export const PIPELINE_CORE_REVISION='system-pipeline-core-v1';

export async function runQcPipeline(args={}){
  const state=args?.state;
  const reportDate=String(state?.reportDate||'').trim();
  const businessType=String(state?.businessType||'CCSL').trim().toUpperCase()==='SHOPEE'?'SHOPEE':'CCSL';
  if(state&&/^\d{4}-\d{2}-\d{2}$/.test(reportDate)){
    const batch=getExactValidUnifiedBatch(reportDate);
    if(batch){
      const prepared=prepareUnifiedRunState(state,businessType);
      Object.assign(state,prepared);
      console.log(`[CE-QC][PIPELINE_CORE] revision=${PIPELINE_CORE_REVISION} scope=${businessType} reportDate=${reportDate} batchId=${batch.batchId} current=${Number(prepared.__unifiedRunPreparation?.currentCount||0)} carry=${Number(prepared.__unifiedRunPreparation?.carryCount||0)}`);
    }
  }
  return legacyPipeline.runQcPipeline(args);
}
