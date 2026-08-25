import express from 'express';
export const V295_FIRST_ATTEMPT_UI_INJECTION_ID='2026-08-25-v299-first-attempt-ui-injection-v4';
const originalSend=express.response.send;
const MARKER='/v295-first-attempt-ui.js?v=20260825-v299-1';
const V298_COMPAT_MARKER='/v295-first-attempt-ui.js?v=20260825-v298-1';
void V298_COMPAT_MARKER;
express.response.send=function v295FirstAttemptUiSend(body){
  if(typeof body==='string'&&body.includes('</body>')&&body.includes('CE Express')&&!body.includes(MARKER)){
    body=body.replace('</body>',`  <script src="${MARKER}"></script>\n</body>`);
    this.setHeader?.('X-CE-QC-V295-UI',V295_FIRST_ATTEMPT_UI_INJECTION_ID);
  }
  return originalSend.call(this,body);
};
console.info('[CE-QC][V299_FIRST_ATTEMPT_UI_INJECTION]',V295_FIRST_ATTEMPT_UI_INJECTION_ID,'final HTML receives V299 exact first-attempt owner after the fast all-board trend owner; old V298 cache key retained only as a compatibility marker.');
