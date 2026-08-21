import express from 'express';
import './qc11CeLoginBoundPatch.js';
import { clearTokenSync } from './authStore.js';
import { getCurrentReportDate, updateRunLock } from './store.js';
import { SHOPEE, getBusinessCurrentReportDate, updateBusinessRunLock } from './businessStore.js';

const AUTH_MESSAGE = 'CE系统登录已失效，请在系统设置重新登录后点击继续处理。';
const GUARDED_ROUTES = new Set([
  '/api/run',
  '/api/run/start',
  '/api/resume',
  '/api/run/resume',
  '/api/shopee/run/start',
  '/api/shopee/run/resume'
]);
const installedRoutes = new Set();

export function isCeAuthRequired(value = {}) {
  const code = String(value?.code || value?.ceCode || value?.diagnostic?.ceCode || '').trim().toUpperCase();
  const status = Number(value?.ceStatus || value?.diagnostic?.httpStatus || 0);
  const message = [
    value?.error,
    value?.message,
    value?.ceMsg,
    value?.diagnostic?.ceMsg,
    value?.diagnostic?.message
  ].filter(Boolean).join(' ');

  return code === 'AUTH_REQUIRED'
    || code === '401'
    || status === 401
    || status === 403
    || /请求未授权|未授权|unauthorized|登录已失效|登录过期|token\s*(?:expired|invalid)|expired\s*token|invalid\s*token/i.test(message);
}

function markRunPaused(route) {
  const shopee = route.startsWith('/api/shopee/');
  try { clearTokenSync(); } catch {}

  try {
    if (shopee) {
      const reportDate = getBusinessCurrentReportDate(SHOPEE);
      if (reportDate) updateBusinessRunLock(SHOPEE, reportDate, 'paused', AUTH_MESSAGE);
    } else {
      const reportDate = getCurrentReportDate();
      if (reportDate) updateRunLock(reportDate, 'paused', AUTH_MESSAGE);
    }
  } catch (error) {
    console.error('[V41][AUTH_PAUSE] failed to mark run paused:', error);
  }
}

function authPauseMiddleware(route) {
  return function ceQcAuthPauseMiddleware(req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = function ceQcAuthAwareJson(payload) {
      if (!isCeAuthRequired(payload)) return originalJson(payload);

      markRunPaused(route);
      if (!res.headersSent) res.statusCode = 409;
      return originalJson({
        ...(payload && typeof payload === 'object' ? payload : {}),
        ok: false,
        code: 'AUTH_REQUIRED',
        error: AUTH_MESSAGE,
        pausedForAuth: true
      });
    };
    next();
  };
}

const previousPost = express.application.post;
express.application.post = function v41AuthPausePost(...args) {
  const route = String(args[0] || '');
  if (GUARDED_ROUTES.has(route) && !installedRoutes.has(route)) {
    installedRoutes.add(route);
    return previousPost.apply(this, [args[0], authPauseMiddleware(route), ...args.slice(1)]);
  }
  return previousPost.apply(this, args);
};

export { AUTH_MESSAGE };
