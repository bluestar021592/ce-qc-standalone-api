import express from 'express';
import './v108PerformanceIndexPatch.js';

const PATCH_ID = '2026-08-24-v274-core-dashboard-cache-reset-v3';
const originalUse = express.application.use;
let installed = false;

const CORE_LIVE_ASSET_RE = /\/(?:app|dashboard-v18|dashboard-chart-v18|dashboard-data-adapter-v18)\.js$|\/dashboard-v18\.css$|\/(?:v271-canonical-integrity-owner|v272-layout-trend-finalizer|v274-trend-speed-guard)\.js$/i;

function cacheableAsset(req, res, next) {
  const pathname = String(req.path || req.url || '').split('?')[0];
  const originalUrl = String(req.originalUrl || req.url || '');
  const accept = String(req.headers?.accept || '');
  const htmlNavigation = pathname === '/' || /\.html$/i.test(pathname) || accept.includes('text/html');

  // Dashboard logic and layout must never remain stuck behind a previous 24-hour
  // versioned asset cache. Clearing only HTTP cache does not touch cookies,
  // login state, localStorage or the SQLite database.
  if (htmlNavigation) {
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Clear-Site-Data', '"cache"');
  } else if (CORE_LIVE_ASSET_RE.test(pathname)) {
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else if (/\.(?:js|css|svg|png|jpe?g|webp|ico|woff2?)$/i.test(pathname)) {
    const versioned = /[?&]v=[^&]+/i.test(originalUrl);
    res.setHeader('Cache-Control', versioned
      ? 'private, max-age=86400, stale-while-revalidate=604800'
      : 'private, max-age=300, stale-while-revalidate=3600');
  }
  next();
}

express.application.use = function v274StaticAssetCacheUse(...args) {
  const candidates = args.flat().filter(value => typeof value === 'function');
  if (!installed && candidates.some(fn => fn.name === 'serveStatic')) {
    installed = true;
    originalUse.call(this, cacheableAsset);
  }
  return originalUse.apply(this, args);
};

export const V89_STATIC_ASSET_CACHE_PATCH_ID = PATCH_ID;
