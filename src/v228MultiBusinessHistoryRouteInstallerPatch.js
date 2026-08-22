import express from 'express';

export const V228_MULTI_BUSINESS_HISTORY_ROUTE_INSTALLER_ID = '2026-08-22-v228-multi-business-history-route-installer-v1';

let installed = false;
const previousUse = express.application.use;

function placeholder(_req, res) {
  // V227 intercepts registration of these paths and replaces this placeholder
  // with its authoritative handler before any request can reach it.
  res.status(500).json({ ok: false, error: 'V227 history route installer fallback reached unexpectedly.' });
}

express.application.use = function v228InstallMultiBusinessHistoryRoutes(...args) {
  if (!installed) {
    installed = true;
    this.get('/api/v227/history-refresh/summary', placeholder);
    this.post('/api/v227/history-refresh/start', placeholder);
    this.get('/api/v227/history-refresh/job/:jobId', placeholder);
    console.info('[CE-QC][V228_MULTI_BUSINESS_HISTORY_ROUTE_INSTALLER]', V228_MULTI_BUSINESS_HISTORY_ROUTE_INSTALLER_ID, 'V227 routes registered before middleware startup');
  }
  return previousUse.apply(this, args);
};
