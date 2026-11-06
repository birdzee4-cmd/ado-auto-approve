const store = require('../shared/ado-deployment-event-store');
const auth = require('../shared/auth');
const { buildAnalytics } = require('../shared/deployment-analytics');

module.exports = async function (context, req) {
  const authorized = auth.requireAnyRole(context, req, ['it_support_approve', 'admin']);
  if (!authorized.ok) { context.res = { status: authorized.status, body: authorized.body }; return; }
  try {
    const options = { from: req.query?.from, to: req.query?.to, environmentGroup: req.query?.environmentGroup, sourceType: req.query?.sourceType, result: req.query?.result };
    const items = await store.listAll(options);
    context.res = { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: { ok: true, source: 'AdoDeploymentEvents', readOnly: true, fetchedAt: new Date().toISOString(), analytics: buildAnalytics(items) } };
  } catch (error) {
    context.log.error('ado-deployment-analytics failed:', error.message);
    context.res = { status: 503, body: { ok: false, error: 'Deployment analytics storage is unavailable.' } };
  }
};
