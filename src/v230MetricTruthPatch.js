import express from 'express';
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const V230_METRIC_TRUTH_ROUTE_ID = '2026-08-22-v230-daily-metric-truth-route-v1';
const ROUTE = '/api/v230/metric-truth';
const TYPES = new Set(['ALL','CE','CEAF','TBKH','ALI1688','WHPP','SHOPEECN','SHOPEEVN']);
const CACHE_MS = 120_000;
const TIMEOUT_MS = 180_000;
const cache = new Map();
const inflight = new Map();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(__dirname, 'v230MetricTruthWorker.js');

function dateKey(value = '') {
  const v = String(value || '').trim().slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}
function keyOf(type, from, to) { return `${type}|${from}|${to}`; }
function runWorker(payload) {
  const key = keyOf(payload.businessType, payload.from, payload.to);
  if (inflight.has(key)) return inflight.get(key);
  const promise = new Promise((resolve, reject) => {
    const child = fork(workerPath, [], {
      env: { ...process.env, CE_QC_EXPORT_WORKER_MODE: 'SINGLE_BUSINESS_DIRECT' },
      stdio: ['ignore','ignore','ignore','ipc']
    });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch {}
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('V230指标真值计算超过180秒，已停止本次读取。')), TIMEOUT_MS);
    child.once('error', error => finish(reject, error));
    child.once('exit', code => {
      if (!settled && code !== 0) finish(reject, new Error(`V230指标真值Worker异常退出：${code}`));
    });
    child.on('message', message => {
      if (message?.ok) finish(resolve, message.payload);
      else finish(reject, new Error(message?.error || 'V230指标真值Worker失败'));
    });
    child.send(payload);
  }).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

async function handler(req, res) {
  try {
    const businessType = String(req.query.businessType || 'ALL').trim().toUpperCase();
    const from = dateKey(req.query.from);
    const to = dateKey(req.query.to) || from;
    if (!TYPES.has(businessType)) return res.status(400).json({ ok:false, error:'业务板块无效' });
    if (!from || !to || from > to) return res.status(400).json({ ok:false, error:'日期范围无效' });
    const key = keyOf(businessType, from, to);
    const force = String(req.query.refresh || '') === '1';
    const hit = cache.get(key);
    if (!force && hit && Date.now() - hit.at < CACHE_MS) {
      res.setHeader('Cache-Control','private, max-age=30');
      res.setHeader('X-CE-QC-Metric-Truth','V230-HIT');
      return res.json({ ...hit.payload, cacheHit:true, routeId:V230_METRIC_TRUTH_ROUTE_ID });
    }
    const started = Date.now();
    const payload = await runWorker({ businessType, from, to });
    cache.set(key, { at:Date.now(), payload });
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-CE-QC-Metric-Truth','V230-MISS');
    res.setHeader('Server-Timing', `metricTruth;dur=${Date.now()-started}`);
    return res.json({ ...payload, cacheHit:false, routeId:V230_METRIC_TRUTH_ROUTE_ID });
  } catch (error) {
    console.error('[CE-QC][V230_METRIC_TRUTH]', error?.stack || error);
    return res.status(500).json({ ok:false, routeId:V230_METRIC_TRUTH_ROUTE_ID, error:error?.message || String(error) });
  }
}

const previousUse = express.application.use;
let installed = false;
express.application.use = function v230MetricTruthUse(...args) {
  if (!installed) {
    installed = true;
    this.get(ROUTE, handler);
    console.info('[CE-QC][V230_METRIC_TRUTH]', V230_METRIC_TRUTH_ROUTE_ID, 'isolated daily percentage/attempt/signing-day truth enabled');
  }
  return previousUse.apply(this, args);
};
