import express from 'express';

export const V229_HISTORY_UI_CACHE_BUST_ID = '2026-08-22-v229-history-ui-cache-bust-v1';

const OLD_SRC = '/v183-history-refresh.js?v=20260822-v226-1';
const NEW_SRC = '/v183-history-refresh.js?v=20260822-v229-1';
const previousSend = express.response.send;

express.response.send = function v229HistoryUiCacheBustSend(body) {
  let nextBody = body;
  if (typeof nextBody === 'string' && nextBody.includes(OLD_SRC)) {
    nextBody = nextBody.split(OLD_SRC).join(NEW_SRC);
    try {
      this.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      this.setHeader('Pragma', 'no-cache');
      this.setHeader('Expires', '0');
      this.setHeader('X-CE-QC-History-UI', V229_HISTORY_UI_CACHE_BUST_ID);
    } catch {}
  }
  return previousSend.call(this, nextBody);
};

console.info('[CE-QC][V229_HISTORY_UI_CACHE_BUST]', V229_HISTORY_UI_CACHE_BUST_ID, NEW_SRC);
