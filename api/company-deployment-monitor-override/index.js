const auth = require('../shared/auth');
const archive = require('../shared/company-monitor-archive');
const overrides = require('../shared/company-monitor-overrides');
module.exports = async function(context, req) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const access = auth.requireAnyRole(context, req, ['it_support_approve', 'admin']);
  if (!access.ok) { context.res = { status: access.status, headers, body: access.body }; return; }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const day = String(body.date || '').trim(), buildId = String(body.buildId || '').trim();
  if (!archive.validDay(day) || !buildId) { context.res = { status: 400, headers, body: { ok: false, error: 'Invalid date or buildId' } }; return; }
  try { const override = await overrides.set(day, buildId, access.principal); context.res = { status: 200, headers, body: { ok: true, override } }; }
  catch (error) { context.log.error('Monitor override unavailable:', error.message); context.res = { status: 503, headers, body: { ok: false, error: 'บันทึกการยืนยันไม่สำเร็จ' } }; }
};
