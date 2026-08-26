import express from 'express';
export const V295_FIRST_ATTEMPT_UI_INJECTION_ID='2026-08-26-v312-direct-http-shopee-recovery-injection-v1';
const originalSend=express.response.send;
const CLEAN_START_MARKER='/v303-authorized-clean-start.js?v=20260825-v303-1';
const EXACT_DAILY_MARKER='/v302-one-shot-owner.js?v=20260825-v302-1';
const MARKER='/v295-first-attempt-ui.js?v=20260825-v299-1';
const STABILITY_MARKER='/v301-runtime-stability.js?v=20260825-v301-1';
const V307_HOME_MARKER='/v307-exact-daily-home-owner.js?v=20260825-v307-1';
const V309_UI_MARKER='/v309-ui-integrity.js?v=20260826-v309-1';
const V310_RESUME_MARKER='/v310-unified-resume-owner.js?v=20260826-v310-1';
const V311_RECOVERY_MARKER='/v311-shopee-recovery-owner.js?v=20260826-v312-1';
const V300_COMPAT_MARKER='/v300-runtime-rescue.js?v=20260825-v300-1';
const V298_COMPAT_MARKER='/v295-first-attempt-ui.js?v=20260825-v298-1';
void V300_COMPAT_MARKER;void V298_COMPAT_MARKER;
// V300 recursive observer is no longer delivered. V301 remains the only DOM-stability owner.
express.response.send=function v295FirstAttemptUiSend(body){
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
    if(tags.length)body=body.replace('</body>',`${tags.join('\n')}\n</body>`);
    this.setHeader?.('X-CE-QC-V295-UI',V295_FIRST_ATTEMPT_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V300-UI','2026-08-25-v300-single-sidebar-exact-shopee-owner-v1');
    this.setHeader?.('X-CE-QC-V301-UI','2026-08-25-v301-nonrecursive-runtime-stability-v1');
    this.setHeader?.('X-CE-QC-V302-UI','2026-08-25-v302-one-shot-exact-daily-owner-v1');
    this.setHeader?.('X-CE-QC-V303-UI','2026-08-25-v303-authorized-clean-start-ui-v1');
    this.setHeader?.('X-CE-QC-V307-UI','2026-08-25-v307-exact-daily-seven-business-home-v1');
    this.setHeader?.('X-CE-QC-V309-UI','2026-08-26-v309-single-nav-auto-resume-shopee-total-v1');
    this.setHeader?.('X-CE-QC-V310-UI','2026-08-26-v310-persistent-shopee-resume-owner-v1');
    this.setHeader?.('X-CE-QC-V311-UI','2026-08-26-v311-backend-aware-shopee-recovery-v1');
    this.setHeader?.('X-CE-QC-V312-UI','2026-08-26-v312-direct-http-shopee-resume-v1');
  }
  return originalSend.call(this,body);
};
console.info('[CE-QC][V312_UI_INJECTION]',V295_FIRST_ATTEMPT_UI_INJECTION_ID,'V312 keeps backend-aware V311 lock repair but bypasses stale browser runInFlight/app-state wrappers and POSTs the real SHOPEE resume endpoint directly; prior exact-truth owners remain intact.');
