import express from 'express';

const PATCH_ID = '2026-08-14-v105-static-asset-browser-cache-v2';
const originalUse = express.application.use;
let installed = false;

function cacheableAsset(req, res, next) {
  const pathname = String(req.path || req.url || '').split('?')[0];
  const originalUrl = String(req.originalUrl || req.url || '');
  if (/\.(?:js|css|svg|png|jpe?g|webp|ico|woff2?)$/i.test(pathname) && !/\.html$/i.test(pathname)) {
    const versioned = /[?&]v=[^&]+/i.test(originalUrl);
    // Versioned assets are content-addressed by the URL used in index/v44 injection.
    // They can be served from the browser cache without revalidating dozens of JS/CSS
    // files on every app open. A code update bumps ?v= and therefore gets a new URL.
    res.setHeader('Cache-Control', versioned
      ? 'private, max-age=86400, stale-while-revalidate=604800'
      : 'private, max-age=300, stale-while-revalidate=3600');
  }
  next();
}

express.application.use = function v105StaticAssetCacheUse(...args) {
  const candidates = args.flat().filter(value => typeof value === 'function');
  if (!installed && candidates.some(fn => fn.name === 'serveStatic')) {
    installed = true;
    originalUse.call(this, cacheableAsset);
  }
  return originalUse.apply(this, args);
};

export const V89_STATIC_ASSET_CACHE_PATCH_ID = PATCH_ID;
