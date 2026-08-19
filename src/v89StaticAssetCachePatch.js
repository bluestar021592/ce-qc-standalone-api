import express from 'express';
import './v108PerformanceIndexPatch.js';

const PATCH_ID = '2026-08-19-v221-static-runtime-guard-no-store-v1';
const originalUse = express.application.use;
let installed = false;

function cacheableAsset(req, res, next) {
  const pathname = String(req.path || req.url || '').split('?')[0];
  const originalUrl = String(req.originalUrl || req.url || '');
  if (/\.(?:js|css|svg|png|jpe?g|webp|ico|woff2?)$/i.test(pathname) && !/\.html$/i.test(pathname)) {
    // These small runtime guards are the emergency/stability layer. During a
    // verified code update the browser must never keep a one-day-old copy merely
    // because the query-string version stayed compatible with older smoke gates.
    if (/\/(?:v203-dashboard-integrity|v208-dashboard-final-guard|v217-runtime-truth)\.js$/i.test(pathname)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return next();
    }
    const versioned = /[?&]v=[^&]+/i.test(originalUrl);
    res.setHeader('Cache-Control', versioned
      ? 'private, max-age=86400, stale-while-revalidate=604800'
      : 'private, max-age=300, stale-while-revalidate=3600');
  }
  next();
}

express.application.use = function v108StaticAssetCacheUse(...args) {
  const candidates = args.flat().filter(value => typeof value === 'function');
  if (!installed && candidates.some(fn =>fn.name === 'serveStatic')) {
    installed = true;
    originalUse.call(this, cacheableAsset);
  }
  return originalUse.apply(this, args);
};

export const V89_STATIC_ASSET_CACHE_PATCH_ID = PATCH_ID;