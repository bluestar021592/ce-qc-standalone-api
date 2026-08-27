import express from 'express';
export const V295_FIRST_ATTEMPT_UI_INJECTION_ID='2026-08-27-v330-three-business-cache-injection-v1';
const originalSend=express.response.send;
const CLEAN_START_MARKER='/v303-authorized-clean-start.js?v=20260825-v303-1';
const EXACT_DAILY_MARKER='/v302-one-shot-owner.js?v=20260825-v302-1';
const MARKER='/v295-first-attempt-ui.js?v=20260825-v299-1';
const STABILITY_MARKER='/v301-runtime-stability.js?v=20260825-v301-1';
const V307_HOME_MARKER='/v307-exact-daily-home-owner.js?v=20260826-v325-1';
const V309_UI_MARKER='/v309-ui-integrity.js?v=20260826-v309-1';
const V310_RESUME_MARKER='/v310-unified-resume-owner.js?v=20260826-v310-1';
const V311_RECOVERY_MARKER='/v311-shopee-recovery-owner.js?v=20260826-v313-1';
const V317_CCSL_RECOVERY_MARKER='/v317-ccsl-recovery-owner.js?v=20260826-v317-2';
const V318_SINGLE_SIDEBAR_MARKER='/v318-single-sidebar-owner.js?v=20260826-v318-1';
const V319_TREND_CACHE_MARKER='/v319-trend-cache-first.js?v=20260826-v319-1';
const V320_HISTORY_TREND_MARKER='/v320-history-trend-owner.js?v=20260827-v329-1';
const V328_ATTEMPT_MARKER='/v328-three-business-attempt-owner.js?v=20260827-v329-1';
const V300_COMPAT_MARKER='/v300-runtime-rescue.js?v=20260825-v300-1';
const V298_COMPAT_MARKER='/v295-first-attempt-ui.js?v=20260825-v298-1';
void V300_COMPAT_MARKER;void V298_COMPAT_MARKER;
// V300 recursive observer is no longer delivered. V301 remains the nonrecursive runtime-stability owner.
express.response.send=function v330FirstAttemptUiSend(body){
  if(typeof body==='string'&&body.includes('</body>')&&body.includes('CE Express')){
    const tags=[];
    if(!body.includes(CLEAN_START_MARKER))tags.push(`  <script src="${CLEAN_START_MARKER}"></script>`);
    if(!body.includes(EXACT_DAILY_MARKER))tags.push(`  <script src="${EXACT_DAILY_MARKER}"></script>`);
    if(!body.includes(MARKER))tags.push(`  <script src="${MARKER}"></script>`);
    if(!body.includes(STABILITY_MARKER))tags.push(`  <script src="${STABILITY_MARKER}"></script>`);
    if(!body.includes(V307_HOME_MARKER))tags.push(`  <script src="${V307_HOME_MARKER}"></script>`);
    if(!body.includes(V309_UI_MARKER))tags.push(`  <script src="${V309_UI_MARKER}"></script>`);
    if(!body.includes(V310_RESUME_MARKER))tags.push(`  <script src="${V310_RESUME_MARKER}"></script>`);
    if(!body.includes(V311_RECOVERY_MARKER))tags.push(`  <script src="${V311_RECOVERY_MARKER}"></script>`);
    if(!body.includes(V317_CCSL_RECOVERY_MARKER))tags.push(`  <script src="${V317_CCSL_RECOVERY_MARKER}"></script>`);
    if(!body.includes(V318_SINGLE_SIDEBAR_MARKER))tags.push(`  <script src="${V318_SINGLE_SIDEBAR_MARKER}"></script>`);
    if(!body.includes(V319_TREND_CACHE_MARKER))tags.push(`  <script src="${V319_TREND_CACHE_MARKER}"></script>`);
    if(!body.includes(V320_HISTORY_TREND_MARKER))tags.push(`  <script src="${V320_HISTORY_TREND_MARKER}"></script>`);
    if(!body.includes(V328_ATTEMPT_MARKER))tags.push(`  <script src="${V328_ATTEMPT_MARKER}"></script>`);
    if(tags.length)body=body.replace('</body>',`${tags.join('\n')}\n</body>`);
    this.setHeader?.('X-CE-QC-V295-UI',V295_FIRST_ATTEMPT_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V301-UI','2026-08-25-v301-nonrecursive-runtime-stability-v1');
    this.setHeader?.('X-CE-QC-V329-UI','2026-08-27-v329-three-business-cache-ui-v1');
  }
  return originalSend.call(this,body);
};
console.info('[CE-QC][V330_UI_INJECTION]',V295_FIRST_ATTEMPT_UI_INJECTION_ID,'V301 nonrecursive stability + TBKH/CN/VN history table, trend and 1/2/3 attempt chart reuse one nonblocking cache payload.');