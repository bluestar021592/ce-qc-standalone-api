import express from 'express';

export const V308_DASHBOARD_READ_BRIDGE_UI_ID='2026-08-26-v328-three-business-history-bridge-v1';
const MARKER='/v308-dashboard-read-bridge.js?v=20260826-v328-1';
const originalSend=express.response.send;

express.response.send=function v328DashboardReadBridgeSend(body){
  if(typeof body==='string'&&body.includes('</head>')&&body.includes('CE Express')){
    if(!body.includes(MARKER))body=body.replace('</head>',`  <script src="${MARKER}"></script>\n</head>`);
    this.setHeader?.('X-CE-QC-V308-UI',V308_DASHBOARD_READ_BRIDGE_UI_ID);
    this.setHeader?.('X-CE-QC-V320-UI','2026-08-26-v320-history-dispatch-signing-ui-v2');
    this.setHeader?.('X-CE-QC-V324-UI','2026-08-26-v324-auto-full-uploaded-history-ui-v2');
    this.setHeader?.('X-CE-QC-V327-UI','2026-08-26-v327-shared-history-single-read-ui-v1');
    this.setHeader?.('X-CE-QC-V328-UI','2026-08-26-v328-three-business-history-attempt-signing-ui-v1');
  }
  return originalSend.call(this,body);
};

console.info('[CE-QC][V328_UI_INJECTION]',V308_DASHBOARD_READ_BRIDGE_UI_ID,'TBKH + Shopee CN/VN share one history bridge and demand-triggered isolated evidence repair status refresh.');
