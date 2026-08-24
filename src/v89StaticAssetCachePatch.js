import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import './v108PerformanceIndexPatch.js';

const PATCH_ID = '2026-08-24-v277-safe-direct-v275-delivery-v1';
const originalUse = express.application.use;
const originalSendFile = express.response.sendFile;
const originalSend = express.response.send;
let installed = false;

const V275_DIRECT_MARKER = '/v274-trend-speed-guard.js?v=20260824-v277-1';
const CORE_LIVE_ASSET_RE = /\/(?:app|dashboard-v18|dashboard-chart-v18|dashboard-data-adapter-v18)\.js$|\/dashboard-v18\.css$|\/(?:v271-canonical-integrity-owner|v272-layout-trend-finalizer|v274-trend-speed-guard)\.js$/i;

function cacheableAsset(req, res, next) {
  const pathname = String(req.path || req.url || '').split('?')[0];
  const originalUrl = String(req.originalUrl || req.url || '');
  const accept = String(req.headers?.accept || '');
  const htmlNavigation = pathname === '/' || /\.html$/i.test(pathname) || accept.includes('text/html');

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

express.application.use = function v277StaticAssetCacheUse(...args) {
  const candidates = args.flat().filter(value => typeof value === 'function');
  if (!installed && candidates.some(fn => fn.name === 'serveStatic')) {
    installed = true;
    originalUse.call(this, cacheableAsset);
  }
  return originalUse.apply(this, args);
};

// V276 routed index.html through the later patched res.send() owner chain. On the
// real desktop SPA that could stall navigation before app.js finished. V277 keeps
// the native page shape and only adds the already-tested V275 import confirmation
// script at the end of index.html. It deliberately calls the original send()
// captured before late UI-owner patching, so /import cannot inherit unrelated
// dashboard injectors while loading.
express.response.sendFile = function v277SafeDirectV275SendFile(filePath, options, callback) {
  const target = String(filePath || '');
  if (path.basename(target).toLowerCase() !== 'index.html') {
    return originalSendFile.call(this, filePath, options, callback);
  }

  const done = typeof callback === 'function' ? callback : null;
  fs.promises.readFile(target, 'utf8').then(source => {
    if (this.headersSent) return;
    let html = String(source || '');
    if (!html.includes(V275_DIRECT_MARKER)) {
      html = html.replace('</body>', `  <script src="${V275_DIRECT_MARKER}"></script>\n</body>`);
    }
    this.type('html');
    originalSend.call(this, html);
    done?.();
  }).catch(error => {
    if (done) return done(error);
    if (!this.headersSent) this.status(500).send(`CE QC 页面读取失败：${error.message}`);
    else this.destroy?.(error);
  });
  return this;
};

export const V89_STATIC_ASSET_CACHE_PATCH_ID = PATCH_ID;
