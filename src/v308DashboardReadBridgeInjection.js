import express from 'express';

export const V308_DASHBOARD_READ_BRIDGE_UI_ID='2026-08-26-v321-exact-range-no-poll-bridge-v1';
const MARKER='/v308-dashboard-read-bridge.js?v=20260826-v321-1';
const originalSend=express.response.send;

express.response.send=function v321DashboardReadBridgeSend(body){
  if(typeof body==='string'&&body.includes('</head>')&&body.includes('CE Express')){
    if(!body.includes(MARKER))body=body.replace('</head>',`  <script src="${MARKER}"></script>\n</head>`);
    this.setHeader?.('X-CE-QC-V308-UI',V308_DASHBOARD_READ_BRIDGE_UI_ID);
    this.setHeader?.('X-CE-QC-V320-UI','2026-08-26-v320-history-dispatch-signing-ui-v2');
    this.setHeader?.('X-CE-QC-V321-UI','2026-08-26-v321-exact-range-no-poll-ui-v1');
  }
  return originalSend.call(this,body);
};

console.info('[CE-QC][V321_UI_INJECTION]',V308_DASHBOARD_READ_BRIDGE_UI_ID,'exact-range no-poll dashboard bridge is delivered before legacy owners so page entry stays responsive.');
