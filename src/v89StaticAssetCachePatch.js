import express from 'express';
import './v108PerformanceIndexPatch.js';

const PATCH_ID = '2026-08-15-v139-immutable-versioned-static-assets-v2';
const originalUse = express.application.use;
let installed = false;

function cacheableAsset(req, res, next) {
  const pathname = String(req.path || req.url || '').split('?')[0];
  const originalUrl = String(req.originalUrl || req.url || '');
  if (/\.(?:js|css|svg|png|jpe?g|webp|ico|woff2?)$/i.test(pathname) && !/\.html$/i.test(pathname)) {
    const versioned = /[?&]v=[^&]+/i.test(originalUrl);
    // The HTML shell is always no-store. Versioned immutable assets are safe to
    // cache for a year because every deployment bumps the query version when the
    // file changes. This removes needless local disk/network/parser work.
    res.setHeader('Cache-Control', versioned
      ? 'public, max-age=31536000, immutable'
      : 'private, max-age=300, stale-while-revalidate=3600');
  }
  next();
}

express.application.use = function v139StaticAssetCacheUse(...args) {
  const candidates = args.flat().filter(value => typeof value === 'function');
  if (!installed && candidates.some(fn => fn.name === 'serveStatic')) {
    installed = true;
    originalUse.call(this, cacheableAsset);
  }
  return originalUse.apply(this, args);
};

export const V89_STATIC_ASSET_CACHE_PATCH_ID = PATCH_ID;
