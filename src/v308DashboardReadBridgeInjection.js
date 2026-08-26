import express from 'express';

export const V308_DASHBOARD_READ_BRIDGE_UI_ID='2026-08-26-v320-history-dispatch-signing-bridge-v1';
const MARKER='/v308-dashboard-read-bridge.js?v=20260826-v320-1';
const originalSend=express.response.send;

express.response.send=function v320DashboardReadBridgeSend(body){
  if(typeof body==='string'&&body.includes('</head>')&&body.includes('CE Express')){
    if(!body.includes(MARKER))body=body.replace('</head>',`  <script src="${MARKER}"></script>\n</head>`);
    this.setHeader?.('X-CE-QC-V308-UI',V308_DASHBOARD_READ_BRIDGE_UI_ID);
    this.setHeader?.('X-CE-QC-V320-UI','2026-08-26-v320-history-dispatch-signing-ui-v1');
  }
  return originalSend.call(this,body);
};

console.info('[CE-QC][V320_UI_INJECTION]',V308_DASHBOARD_READ_BRIDGE_UI_ID,'corrected historical daily bridge is delivered before legacy dashboard owners; average days now means real dispatch START→POD sample average.');
