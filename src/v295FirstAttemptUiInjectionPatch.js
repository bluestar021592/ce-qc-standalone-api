import express from 'express';
export const V295_FIRST_ATTEMPT_UI_INJECTION_ID='2026-08-25-v302-one-shot-exact-daily-injection-v1';
const originalSend=express.response.send;
const EXACT_DAILY_MARKER='/v302-one-shot-owner.js?v=20260825-v302-1';
const MARKER='/v295-first-attempt-ui.js?v=20260825-v299-1';
const STABILITY_MARKER='/v301-runtime-stability.js?v=20260825-v301-1';
const V300_COMPAT_MARKER='/v300-runtime-rescue.js?v=20260825-v300-1';
const V298_COMPAT_MARKER='/v295-first-attempt-ui.js?v=20260825-v298-1';
void V300_COMPAT_MARKER;void V298_COMPAT_MARKER;
express.response.send=function v295FirstAttemptUiSend(body){
  if(typeof body==='string'&&body.includes('</body>')&&body.includes('CE Express')){
    const tags=[];
    // app.js is already loaded when these end-of-body owners execute. Install the
    // exact single-day function owner before the metric/trend refiners so they can
    // never inherit a late custom-period state from a one-day query.
    if(!body.includes(EXACT_DAILY_MARKER))tags.push(`  <script src="${EXACT_DAILY_MARKER}"></script>`);
    if(!body.includes(MARKER))tags.push(`  <script src="${MARKER}"></script>`);
    if(!body.includes(STABILITY_MARKER))tags.push(`  <script src="${STABILITY_MARKER}"></script>`);
    if(tags.length)body=body.replace('</body>',`${tags.join('\n')}\n</body>`);
    this.setHeader?.('X-CE-QC-V295-UI',V295_FIRST_ATTEMPT_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V300-UI','2026-08-25-v300-single-sidebar-exact-shopee-owner-v1');
    this.setHeader?.('X-CE-QC-V301-UI','2026-08-25-v301-nonrecursive-runtime-stability-v1');
    this.setHeader?.('X-CE-QC-V302-UI','2026-08-25-v302-one-shot-exact-daily-owner-v1');
  }
  return originalSend.call(this,body);
};
console.info('[CE-QC][V302_UI_INJECTION]',V295_FIRST_ATTEMPT_UI_INJECTION_ID,'final HTML receives V302 exact single-day owner before V299 first-attempt and V301 non-recursive stability owners.');
