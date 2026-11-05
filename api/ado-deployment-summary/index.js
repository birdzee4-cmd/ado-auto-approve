const store = require('../shared/ado-deployment-event-store');
const auth = require('../shared/auth');

module.exports = async function (context, req) {
  const authorized = auth.requireAnyRole(context, req, ['it_support_approve', 'admin']);
  if (!authorized.ok) { context.res = { status: authorized.status, body: authorized.body }; return; }
  try {
    const summary = await store.summarize({
      environmentGroup: req.query && req.query.environmentGroup,
      sourceType: req.query && req.query.sourceType,
      result: req.query && req.query.result,
      from: req.query && req.query.from,
      to: req.query && req.query.to
    });
    context.res = { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' }, body: { ok: true, summary } };
  } catch (error) {
    context.log.error('ado-deployment-summary failed:', error.message);
    context.res = { status: 503, body: { ok: false, error: 'Deployment summary storage is unavailable.' } };
  }
};
