const crypto = require('crypto');

function requireProxySecret(context, req) {
  const expected = process.env.APP_SERVICE_PROXY_SECRET;
  const actual = getHeader(req.headers, 'x-appservice-portal-proxy-secret');

  if (!expected || !actual || !safeEqual(expected, actual)) {
    context.res = {
      status: 401,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      },
      body: JSON.stringify({
        ok: false,
        error: 'Unauthorized'
      })
    };
    return false;
  }

  return true;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getHeader(headers, name) {
  const target = String(name || '').toLowerCase();
  const source = headers || {};
  const key = Object.keys(source).find(item => item.toLowerCase() === target);
  return key ? source[key] : '';
}

module.exports = {
  requireProxySecret
};
