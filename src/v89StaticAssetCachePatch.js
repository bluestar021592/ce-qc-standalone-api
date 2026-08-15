import express from 'express';
import './v108PerformanceIndexPatch.js';

const PATCH_ID = '2026-08-15-v153-import-assets-no-store-v3';
const originalUse = express.application.use;
let installed = false;

function cacheableAsset(req, res, next) {
  const pathname = String(req.path || req.url || '').split('?')[0];
  const originalUrl = String(req.originalUrl || req.url || '');
  if (/\.(?:js|css|svg|png|jpe?g|webp|ico|woff2?)$/i.test(pathname) && !/\.html$/i.test(pathname)) {
    const criticalRuntime = /\/(?:v150-import-fast-path|v153-build-sync)\.js$/i.test(pathname);
    const versioned = /[?&]v=[^&]+/i.test(originalUrl);
    if (criticalRuntime) {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.setHeader('Pragma', 'no-cache');
    } else {
      res.setHeader('Cache-Control', versioned
        ? 'public, max-age=31536000, immutable'
        : 'private, max-age=300, stale-while-revalidate=3600');
    }
  }
  next();
}

express.application.use = function v153StaticAssetCacheUse(...args) {
  const candidates = args.flat().filter(value => typeof value === 'function');
  if (!installed && candidates.some(fn => fn.name === 'serveStatic')) {
    installed = true;
    originalUse.call(this, cacheableAsset);
  }
  return originalUse.apply(this, args);
};

export const V89_STATIC_ASSET_CACHE_PATCH_ID = PATCH_ID;
