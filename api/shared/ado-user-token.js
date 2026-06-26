const crypto = require('crypto');
const https = require('https');
const querystring = require('querystring');

const TOKEN_COOKIE = 'ado_user_token';
const STATE_COOKIE = 'ado_oauth_state';
const ADO_SCOPE = process.env.ADO_AUTH_SCOPE ||
  '499b84ac-1321-427f-aa17-267ca6975798/.default offline_access openid profile email';

function getConfig() {
  const tenant = process.env.AAD_TENANT_ID;
  const clientId = process.env.AAD_CLIENT_ID;
  const clientSecret = process.env.AAD_CLIENT_SECRET;
  if (!tenant || !clientId || !clientSecret) {
    throw new Error('Missing AAD_TENANT_ID / AAD_CLIENT_ID / AAD_CLIENT_SECRET');
  }
  return { tenant, clientId, clientSecret };
}

function getRedirectUri(req) {
  if (process.env.ADO_AUTH_REDIRECT_URI) return process.env.ADO_AUTH_REDIRECT_URI;
  const headers = req.headers || {};
  const proto = headers['x-forwarded-proto'] || 'https';
  const host = headers['x-forwarded-host'] || headers.host;
  if (!host) throw new Error('Cannot resolve request host for OAuth redirect URI');
  return proto + '://' + host + '/api/ado-auth-callback';
}

function getCookie(req, name) {
  const cookieHeader = req.headers && req.headers.cookie || '';
  const parts = cookieHeader.split(';').map(part => part.trim()).filter(Boolean);
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq) === name) {
      return decodeURIComponent(part.slice(eq + 1));
    }
  }
  return '';
}

function deriveKey() {
  const secret = process.env.ADO_TOKEN_COOKIE_SECRET || process.env.AAD_CLIENT_SECRET || 'ado-auto-approve';
  return crypto.createHash('sha256').update(secret).digest();
}

function base64Url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(input.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

function seal(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [base64Url(iv), base64Url(tag), base64Url(encrypted)].join('.');
}

function unseal(value) {
  if (!value) return null;
  const parts = String(value).split('.');
  if (parts.length !== 3) return null;
  const iv = fromBase64Url(parts[0]);
  const tag = fromBase64Url(parts[1]);
  const encrypted = fromBase64Url(parts[2]);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

function makeCookie(name, value, maxAgeSeconds) {
  return name + '=' + encodeURIComponent(value) +
    '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + String(maxAgeSeconds);
}

function clearCookie(name) {
  return name + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

function buildStartRedirect(req, principal) {
  const cfg = getConfig();
  const state = crypto.randomBytes(24).toString('hex');
  const returnTo = sanitizeReturnTo(req.query && req.query.returnTo);
  const statePayload = {
    state,
    userId: principal && principal.userId || '',
    userDetails: principal && principal.userDetails || '',
    returnTo,
    createdAt: Date.now()
  };
  const redirectUri = getRedirectUri(req);
  const authUrl = 'https://login.microsoftonline.com/' + encodeURIComponent(cfg.tenant) +
    '/oauth2/v2.0/authorize?' + querystring.stringify({
      client_id: cfg.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: ADO_SCOPE,
      state: state
    });

  return {
    location: authUrl,
    setCookie: makeCookie(STATE_COOKIE, seal(statePayload), 10 * 60)
  };
}

function sanitizeReturnTo(value) {
  const raw = String(value || '/dashboard.html');
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\r') || raw.includes('\n')) {
    return '/dashboard.html';
  }
  return raw;
}

function readState(req, state) {
  const payload = unseal(getCookie(req, STATE_COOKIE));
  if (!payload || payload.state !== state) return null;
  if (Date.now() - Number(payload.createdAt || 0) > 10 * 60 * 1000) return null;
  return payload;
}

async function exchangeCode(req, code) {
  const cfg = getConfig();
  return postToken(cfg, {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: getRedirectUri(req),
    scope: ADO_SCOPE
  });
}

async function refreshToken(refreshTokenValue) {
  const cfg = getConfig();
  return postToken(cfg, {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshTokenValue,
    scope: ADO_SCOPE
  });
}

function postToken(cfg, form) {
  const data = querystring.stringify(form);
  const path = '/' + encodeURIComponent(cfg.tenant) + '/oauth2/v2.0/token';
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'login.microsoftonline.com',
      port: 443,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 15000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = body ? JSON.parse(body) : null; } catch (e) {}
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: parsed || body
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Token endpoint timeout')); });
    req.write(data);
    req.end();
  });
}

function buildTokenRecord(tokenBody, principal) {
  const now = Date.now();
  const expiresIn = Number(tokenBody.expires_in || 3600);
  return {
    v: 1,
    accessToken: tokenBody.access_token,
    refreshToken: tokenBody.refresh_token || '',
    expiresAt: now + expiresIn * 1000,
    userId: principal && principal.userId || '',
    userDetails: principal && principal.userDetails || '',
    connectedAt: new Date(now).toISOString()
  };
}

function legacyTokenCookie(record) {
  return makeCookie(TOKEN_COOKIE, seal(record), 30 * 24 * 60 * 60);
}

async function createTokenCookie(record, principal) {
  const store = require('./ado-token-store');
  if (!store.isEnabled()) {
    return legacyTokenCookie(record);
  }

  const tokenRef = store.makeTokenRef(principal || record);
  await store.saveTokenRecord(tokenRef, record);
  return makeReferenceCookie({
    tokenRef,
    userId: record.userId || '',
    userDetails: record.userDetails || '',
    connectedAt: record.connectedAt || ''
  });
}

function makeReferenceCookie(reference) {
  return makeCookie(TOKEN_COOKIE, seal({
    v: 2,
    tokenRef: reference.tokenRef,
    userId: reference.userId || '',
    userDetails: reference.userDetails || '',
    connectedAt: reference.connectedAt || ''
  }), 30 * 24 * 60 * 60);
}

function readTokenRecord(req) {
  try {
    return unseal(getCookie(req, TOKEN_COOKIE));
  } catch (e) {
    return null;
  }
}

async function getValidAccessToken(req, principal) {
  const cookieRecord = readTokenRecord(req);
  const store = require('./ado-token-store');
  let record = cookieRecord;

  if (cookieRecord && cookieRecord.tokenRef) {
    if (!store.isEnabled()) {
      return { ok: false, status: 428, error: 'Azure DevOps token store is not configured' };
    }
    record = await store.getTokenRecord(cookieRecord.tokenRef);
    if (!record) {
      return { ok: false, status: 428, error: 'Azure DevOps connection expired or was removed' };
    }
  }

  if (!record || !record.accessToken) {
    return { ok: false, status: 428, error: 'Azure DevOps connection required' };
  }
  if (principal && record.userId && principal.userId && record.userId !== principal.userId) {
    return { ok: false, status: 428, error: 'Azure DevOps connection belongs to another user' };
  }
  if (Date.now() < Number(record.expiresAt || 0) - 5 * 60 * 1000) {
    const migrationCookie = await maybeMigrateLegacyCookie(cookieRecord, record, principal);
    return {
      ok: true,
      accessToken: record.accessToken,
      record,
      tokenSource: cookieRecord && cookieRecord.tokenRef ? 'server-store' : 'encrypted-cookie',
      setCookie: migrationCookie || undefined
    };
  }
  if (!record.refreshToken) {
    return { ok: false, status: 428, error: 'Azure DevOps connection expired' };
  }

  const refreshed = await refreshToken(record.refreshToken);
  if (!refreshed.ok || !refreshed.body || !refreshed.body.access_token) {
    return {
      ok: false,
      status: 428,
      error: 'Azure DevOps connection refresh failed',
      detail: 'HTTP ' + refreshed.status
    };
  }

  const next = buildTokenRecord({
    ...refreshed.body,
    refresh_token: refreshed.body.refresh_token || record.refreshToken
  }, principal);
  next.connectedAt = record.connectedAt || next.connectedAt;
  const setCookie = cookieRecord && cookieRecord.tokenRef && store.isEnabled()
    ? await saveRefreshedServerRecord(cookieRecord.tokenRef, next)
    : await createTokenCookie(next, principal);
  return {
    ok: true,
    accessToken: next.accessToken,
    record: next,
    tokenSource: store.isEnabled() ? 'server-store' : 'encrypted-cookie',
    setCookie: setCookie
  };
}

async function maybeMigrateLegacyCookie(cookieRecord, record, principal) {
  if (!cookieRecord || cookieRecord.tokenRef) return null;
  const store = require('./ado-token-store');
  if (!store.isEnabled()) return null;
  return createTokenCookie(record, principal);
}

async function saveRefreshedServerRecord(tokenRef, record) {
  const store = require('./ado-token-store');
  await store.saveTokenRecord(tokenRef, record);
  return makeReferenceCookie({
    tokenRef,
    userId: record.userId || '',
    userDetails: record.userDetails || '',
    connectedAt: record.connectedAt || ''
  });
}

async function disconnect(req, principal) {
  const store = require('./ado-token-store');
  const cookieRecord = readTokenRecord(req);
  const tokenRef = cookieRecord && cookieRecord.tokenRef
    ? cookieRecord.tokenRef
    : store.isEnabled()
      ? store.makeTokenRef(principal || cookieRecord || {})
      : '';
  if (tokenRef && store.isEnabled()) {
    await store.deleteTokenRecord(tokenRef);
  }
  return clearCookie(TOKEN_COOKIE);
}

module.exports = {
  TOKEN_COOKIE,
  STATE_COOKIE,
  buildStartRedirect,
  readState,
  exchangeCode,
  buildTokenRecord,
  tokenCookie: legacyTokenCookie,
  createTokenCookie,
  clearCookie,
  readTokenRecord,
  getValidAccessToken,
  disconnect
};
