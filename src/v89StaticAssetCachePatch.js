import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import './v108PerformanceIndexPatch.js';

const PATCH_ID = '2026-08-24-v276-sendfile-ui-owner-delivery-v1';
const originalUse = express.application.use;
const originalSendFile = express.response.sendFile;
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

express.application.use = function v276StaticAssetCacheUse(...args) {
  const candidates = args.flat().filter(value => typeof value === 'function');
  if (!installed && candidates.some(fn => fn.name === 'serveStatic')) {
    installed = true;
    originalUse.call(this, cacheableAsset);
  }
  return originalUse.apply(this, args);
};

// SPA routes such as /import are served with res.sendFile(index.html). The
// canonical dashboard/import owner injector patches res.send(), so a raw
// sendFile stream can bypass every late UI owner even though the backend patch
// is installed. Route index.html through res.send() so V273/V274/V275 scripts
// are actually delivered to the browser. Non-SPA files keep native sendFile.
express.response.sendFile = function v276OwnerAwareSendFile(filePath, options, callback) {
  const target = String(filePath || '');
  if (path.basename(target).toLowerCase() !== 'index.html') {
    return originalSendFile.call(this, filePath, options, callback);
  }

  const done = typeof callback === 'function' ? callback : null;
  fs.promises.readFile(target, 'utf8').then(html => {
    if (this.headersSent) return;
    this.type('html');
    // Use the current response.send implementation at request time. V231
    // installs its canonical owner injector there, so this deliberately does
    // not capture an earlier send() reference.
    this.send(html);
    done?.();
  }).catch(error => {
    if (done) return done(error);
    if (!this.headersSent) this.status(500).send(`CE QC 页面读取失败：${error.message}`);
    else this.destroy?.(error);
  });
  return this;
};

export const V89_STATIC_ASSET_CACHE_PATCH_ID = PATCH_ID;
