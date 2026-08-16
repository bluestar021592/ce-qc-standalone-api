import dns from 'node:dns';
import https from 'node:https';
import { purgeCorrupted20260813Once } from './v158OneTimePurge20260813.js';

const PATCH_ID = '2026-08-16-v157-ce-doh-dns-fallback-v1';
const SYSTEM_DNS_BUDGET_MS = Math.max(500, Number(process.env.CE_SYSTEM_DNS_BUDGET_MS || 1500));
const DOH_TIMEOUT_MS = Math.max(1000, Number(process.env.CE_DOH_TIMEOUT_MS || 3500));
const CACHE_TTL_MS = Math.max(60_000, Number(process.env.CE_DOH_CACHE_TTL_MS || 5 * 60 * 1000));
const CE_HOSTNAME = (() => {
  try { return new URL(process.env.CE_BASE_URL || 'https://otwms.cambodianexpress.com').hostname.toLowerCase(); }
  catch { return 'otwms.cambodianexpress.com'; }
})();
const cache = new Map();
const nativeLookup = dns.lookup.bind(dns);
let installed = false;

function ipv4(value = '') {
  const text = String(value || '').trim();
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(text) ? text : '';
}

function cachedAddress(hostname) {
  const entry = cache.get(hostname);
  if (!entry || entry.expiresAt <= Date.now()) {
    if (entry) cache.delete(hostname);
    return '';
  }
  return entry.address;
}

function remember(hostname, address) {
  if (!address) return;
  cache.set(hostname, { address, expiresAt: Date.now() + CACHE_TTL_MS });
}

function requestDoh(provider, hostname) {
  return new Promise((resolve, reject) => {
    const path = provider.kind === 'cloudflare'
      ? `/dns-query?name=${encodeURIComponent(hostname)}&type=A`
      : `/resolve?name=${encodeURIComponent(hostname)}&type=A`;
    const req = https.request({
      host: provider.ip,
      port: 443,
      servername: provider.servername,
      method: 'GET',
      path,
      headers: {
        Host: provider.servername,
        Accept: 'application/dns-json',
        'User-Agent': 'CE-QC-DNS/1.0'
      },
      timeout: DOH_TIMEOUT_MS,
      family: 4,
      rejectUnauthorized: true
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`DOH_HTTP_${res.statusCode}`));
          return;
        }
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const answers = Array.isArray(body.Answer) ? body.Answer : [];
          const address = answers.map(item => ipv4(item?.data)).find(Boolean) || '';
          if (!address) throw new Error('DOH_NO_A_RECORD');
          resolve(address);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('DOH_TIMEOUT'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

async function resolveViaDoh(hostname) {
  const cached = cachedAddress(hostname);
  if (cached) return cached;
  const providers = [
    { kind: 'cloudflare', ip: '1.1.1.1', servername: 'cloudflare-dns.com' },
    { kind: 'google', ip: '8.8.8.8', servername: 'dns.google' }
  ];
  let lastError = null;
  for (const provider of providers) {
    try {
      const address = await requestDoh(provider, hostname);
      remember(hostname, address);
      console.warn(`[CE-QC][V157][DNS] ${hostname} resolved by ${provider.kind} DoH -> ${address}`);
      return address;
    } catch (error) {
      lastError = error;
      console.warn(`[CE-QC][V157][DNS] ${provider.kind} DoH failed for ${hostname}: ${error?.code || error?.message || error}`);
    }
  }
  throw lastError || new Error('CE_DOH_RESOLUTION_FAILED');
}

function normalizeLookupArgs(options, callback) {
  if (typeof options === 'function') return { options: {}, callback: options };
  if (typeof options === 'number') return { options: { family: options }, callback };
  return { options: options && typeof options === 'object' ? options : {}, callback };
}

function install() {
  if (installed) return;
  installed = true;
  try { dns.setDefaultResultOrder?.('ipv4first'); } catch {}

  dns.lookup = function ceQcDnsLookup(hostname, options, callback) {
    const args = normalizeLookupArgs(options, callback);
    const cb = args.callback;
    const opts = args.options;
    if (typeof cb !== 'function') return nativeLookup(hostname, options, callback);
    const normalizedHost = String(hostname || '').trim().toLowerCase();
    if (normalizedHost !== CE_HOSTNAME) return nativeLookup(hostname, options, callback);

    let settled = false;
    let fallbackStarted = false;
    const finish = (error, address, family = 4) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cb(error, address, family);
    };
    const startFallback = originalError => {
      if (settled || fallbackStarted) return;
      fallbackStarted = true;
      resolveViaDoh(normalizedHost).then(address => {
        if (opts.all) finish(null, [{ address, family: 4 }], 4);
        else finish(null, address, 4);
      }).catch(error => {
        const finalError = originalError || error;
        if (finalError && !finalError.code) finalError.code = 'ENOTFOUND';
        finish(finalError || error);
      });
    };

    const timer = setTimeout(() => {
      console.warn(`[CE-QC][V157][DNS] system DNS exceeded ${SYSTEM_DNS_BUDGET_MS}ms for ${normalizedHost}; switching to DoH.`);
      startFallback(Object.assign(new Error(`System DNS timed out for ${normalizedHost}`), { code: 'EAI_AGAIN', hostname: normalizedHost }));
    }, SYSTEM_DNS_BUDGET_MS);
    timer.unref?.();

    const nativeOptions = { ...opts, family: opts.family === 6 ? 6 : 4, all: Boolean(opts.all) };
    nativeLookup(hostname, nativeOptions, (error, address, family) => {
      if (settled) return;
      if (!error) {
        if (opts.all) {
          const rows = Array.isArray(address) ? address : [{ address: String(address), family: Number(family || 4) }];
          const first = rows.find(item => Number(item.family || 0) === 4 && ipv4(item.address));
          if (first) remember(normalizedHost, first.address);
          finish(null, rows, 4);
        } else {
          const resolved = ipv4(address);
          if (resolved) remember(normalizedHost, resolved);
          finish(null, address, family);
        }
        return;
      }
      const code = String(error?.code || '').toUpperCase();
      if (['ENOTFOUND', 'EAI_AGAIN', 'ETIMEOUT', 'ETIMEDOUT'].includes(code)) {
        clearTimeout(timer);
        startFallback(error);
        return;
      }
      finish(error);
    });
  };
  console.log(`[CE-QC][V157] CE network DNS fallback installed for ${CE_HOSTNAME}; system budget=${SYSTEM_DNS_BUDGET_MS}ms, DoH timeout=${DOH_TIMEOUT_MS}ms.`);
}

purgeCorrupted20260813Once();
install();

export const V157_CE_NETWORK_DNS_PATCH_ID = PATCH_ID;
