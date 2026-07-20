const https = require('https');

function isConfigured() {
  return !!getBaseUrl() && !!process.env.APP_SERVICE_PROXY_SECRET;
}

async function forward(context, req, routeName) {
  const baseUrl = getBaseUrl();
  const secret = process.env.APP_SERVICE_PROXY_SECRET;
  if (!baseUrl || !secret) return false;

  const url = buildUrl(baseUrl, routeName, req.query || {});
  const headers = {
    'Accept': 'application/json',
    'x-appservice-portal-proxy-secret': secret
  };

  const principal = getHeader(req.headers, 'x-ms-client-principal');
  if (principal) headers['x-ms-client-principal'] = principal;

  let body = null;
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && req.body != null) {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }

  try {
    const result = await request(method, url, headers, body);
    const responseBody = transformProxyResponse(routeName, result.body, principal);
    context.res = {
      status: result.status,
      headers: {
        'Content-Type': result.contentType || 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      },
      body: responseBody
    };
  } catch (err) {
    context.log.error('App Service portal proxy failed:', sanitizeError(err));
    context.res = {
      status: err.statusCode || 502,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      },
      body: JSON.stringify({
        ok: false,
        error: 'App Service Portal backend unavailable',
        detail: 'Unable to reach the App Service Portal Function backend.'
      })
    };
  }

  return true;
}

function getBaseUrl() {
  return String(process.env.APP_SERVICE_FUNCTION_BASE_URL || '').trim().replace(/\/+$/, '');
}

function buildUrl(baseUrl, routeName, query) {
  const url = new URL(baseUrl + '/api/' + routeName);
  Object.keys(query || {}).forEach(key => {
    const value = query[key];
    if (value != null) url.searchParams.set(key, String(value));
  });
  return url;
}

function request(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, timeout: getProxyTimeoutMs() }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode || 500,
          contentType: res.headers['content-type'],
          body: responseBody
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      const err = new Error('App Service Portal proxy timeout');
      err.statusCode = 504;
      req.destroy(err);
    });
    if (body) req.write(body);
    req.end();
  });
}

function getProxyTimeoutMs() {
  const seconds = Number(process.env.APP_SERVICE_PROXY_TIMEOUT_SECONDS || 180);
  return Math.max(45, seconds) * 1000;
}

function transformProxyResponse(routeName, body, principalHeader) {
  if (String(routeName || '').toLowerCase() !== 'appservice-settings') return body;

  let payload = null;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch (e) {
    return body;
  }

  if (!payload || !Array.isArray(payload.settings) || hasUnrestrictedAdminRole(principalHeader)) {
    return body;
  }

  payload.settings = payload.settings.map(item => {
    if (!isAdminOnlySetting(item && item.name)) return item;
    return Object.assign({}, item, {
      value: '[Hidden: admin only]',
      masked: true
    });
  });
  return JSON.stringify(payload);
}

function hasUnrestrictedAdminRole(principalHeader) {
  if (!principalHeader) return false;
  try {
    const principal = JSON.parse(Buffer.from(principalHeader, 'base64').toString('utf-8'));
    const roles = (principal && Array.isArray(principal.userRoles) ? principal.userRoles : [])
      .map(role => String(role || '').trim().toLowerCase());
    return roles.includes('admin');
  } catch (e) {
    return false;
  }
}

function isAdminOnlySetting(name) {
  const normalizedName = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/_+/g, '');
  return normalizedName === 'backofficeurlsettingsstatmiscpassword' ||
    normalizedName === 'keyvaultclientsecret' ||
    normalizedName === 'dockerregistryserverpassword';
}

function getHeader(headers, name) {
  const target = String(name || '').toLowerCase();
  const source = headers || {};
  const key = Object.keys(source).find(item => item.toLowerCase() === target);
  return key ? source[key] : '';
}

function sanitizeError(err) {
  return {
    statusCode: err && err.statusCode,
    code: err && err.code,
    name: err && err.name
  };
}

module.exports = {
  isConfigured,
  forward
};
