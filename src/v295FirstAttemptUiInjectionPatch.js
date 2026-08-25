import express from 'express';
export const V295_FIRST_ATTEMPT_UI_INJECTION_ID='2026-08-25-v301-runtime-stability-injection-v6';
const originalSend=express.response.send;
const MARKER='/v295-first-attempt-ui.js?v=20260825-v299-1';
const STABILITY_MARKER='/v301-runtime-stability.js?v=20260825-v301-1';
const V300_COMPAT_MARKER='/v300-runtime-rescue.js?v=20260825-v300-1';
const V298_COMPAT_MARKER='/v295-first-attempt-ui.js?v=20260825-v298-1';
void V300_COMPAT_MARKER;void V298_COMPAT_MARKER;
express.response.send=function v295FirstAttemptUiSend(body){
  if(typeof body==='string'&&body.includes('</body>')&&body.includes('CE Express')){
    const tags=[];
    if(!body.includes(MARKER))tags.push(`  <script src="${MARKER}"></script>`);
    if(!body.includes(STABILITY_MARKER))tags.push(`  <script src="${STABILITY_MARKER}"></script>`);
    if(tags.length)body=body.replace('</body>',`${tags.join('\n')}\n</body>`);
    this.setHeader?.('X-CE-QC-V295-UI',V295_FIRST_ATTEMPT_UI_INJECTION_ID);
    this.setHeader?.('X-CE-QC-V300-UI','2026-08-25-v300-single-sidebar-exact-shopee-owner-v1');
    this.setHeader?.('X-CE-QC-V301-UI','2026-08-25-v301-nonrecursive-runtime-stability-v1');
  }
  return originalSend.call(this,body);
};
console.info('[CE-QC][V301_FIRST_ATTEMPT_UI_INJECTION]',V295_FIRST_ATTEMPT_UI_INJECTION_ID,'final HTML receives V299 exact first-attempt owner followed by V301 non-recursive runtime stability owner; V300 recursive observer is no longer delivered.');
