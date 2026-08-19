import express from 'express';

export const V220_LOCAL_OWNER_ACCESS_VERSION = '2026-08-19-v220-local-owner-ce-auth-v1';
const INSTALLED = Symbol.for('ce-qc.v220-local-owner-access-installed');

function localOwner(req) {
  return String(req?.accessMode || '').toUpperCase() === 'LOCAL' && Boolean(req?.user?.devMode);
}

function localCeAuthPath(req) {
  return /^\/(?:ce-login|ce-logout|auth\/login|auth\/logout)$/.test(String(req?.path || ''));
}

function wrapLocalBypass(handler) {
  if (typeof handler !== 'function') return handler;
  return function v220LocalOwnerCeAuthBypass(req, res, next) {
    if (localOwner(req) && localCeAuthPath(req)) return next();
    return handler.call(this, req, res, next);
  };
}

if (!express.application[INSTALLED]) {
  Object.defineProperty(express.application, INSTALLED, { value: true });

  // server.js mounts one global /api write-role middleware. Keep it intact for
  // every endpoint except CE credential connect/disconnect on the physical
  // localhost. LAN/public users still obey normal role checks.
  const previousUse = express.application.use;
  express.application.use = function v220LocalOwnerUse(...args) {
    if (args[0] === '/api' && typeof args[1] === 'function') {
      let source = '';
      try { source = Function.prototype.toString.call(args[1]); } catch {}
      if (source.includes('adminOnly') && source.includes('requireRole')) {
        return previousUse.call(this, args[0], wrapLocalBypass(args[1]), ...args.slice(2));
      }
    }
    return previousUse.apply(this, args);
  };

  // /api/ce-login and /api/ce-logout also carry route-level ADMIN middleware.
  // Bypass only those middleware functions for an authenticated LOCAL devMode
  // session; the real route handler is left untouched.
  const previousPost = express.application.post;
  express.application.post = function v220LocalOwnerPost(pathValue, ...handlers) {
    if ((pathValue === '/api/ce-login' || pathValue === '/api/ce-logout') && handlers.length > 1) {
      const finalIndex = handlers.length - 1;
      const mapped = handlers.map((handler, index) => index < finalIndex ? wrapLocalBypass(handler) : handler);
      return previousPost.call(this, pathValue, ...mapped);
    }
    return previousPost.call(this, pathValue, ...handlers);
  };
}

export const __test = { localOwner, localCeAuthPath };
