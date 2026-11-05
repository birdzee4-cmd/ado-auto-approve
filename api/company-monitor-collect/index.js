const { timingSafeEqual } = require('node:crypto');
const archive = require('../shared/company-monitor-archive');
const monitor = require('../shared/company-deployment-monitor');
module.exports = async function(context, req) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const expected = process.env.COMPANY_MONITOR_COLLECT_KEY;
  const supplied = req.headers?.['x-company-monitor-key'];
  const valid = typeof expected === 'string' && expected.length >= 32 && typeof supplied === 'string' && Buffer.byteLength(expected) === Buffer.byteLength(supplied) && timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
  if (!valid) { context.res = { status: 401, headers, body: { ok: false, error: 'Unauthorized collector' } }; return; }
  try {
    const result = await archive.store().collect(() => monitor.loadRaw());
    context.res = { status: 200, headers, body: { ok: true, ...result } };
  } catch (error) {
    context.log.error('Company monitor collection failed:', error.message);
    context.res = { status: 503, headers, body: { ok: false, error: 'Monitor collection failed' } };
  }
};
