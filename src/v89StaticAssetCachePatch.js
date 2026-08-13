import express from 'express';

const PATCH_ID = '2026-08-13-v89-static-revalidation-cache-v1';
const originalUse = express.application.use;
let installed = false;

function cacheableAsset(req, res, next) {
  const pathname = String(req.path || req.url || '').split('?')[0];
  if (/\.(?:js|css|svg|png|jpe?g|webp|ico|woff2?)$/i.test(pathname) && !/\.html$/i.test(pathname)) {
    // server.js deliberately keeps HTML uncached. For static assets, "no-cache"
    // still requires revalidation after a code update but lets Chrome reuse the
    // local body/ETag instead of downloading every JS/CSS file on every open.
    res.setHeader('Cache-Control', 'private, no-cache');
  }
  next();
}

express.application.use = function v89StaticAssetCacheUse(...args) {
  const candidates = args.flat().filter(value => typeof value === 'function');
  if (!installed && candidates.some(fn => fn.name === 'serveStatic')) {
    installed = true;
    // Insert after the legacy no-store header middleware and immediately before
    // express.static, so this is a response-header correction only.
    originalUse.call(this, cacheableAsset);
  }
  return originalUse.apply(this, args);
};

export const V89_STATIC_ASSET_CACHE_PATCH_ID = PATCH_ID;
