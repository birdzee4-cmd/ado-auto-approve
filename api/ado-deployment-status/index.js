const store = require('../shared/ado-deployment-event-store');
const auth = require('../shared/auth');

module.exports = async function (context, req) {
  try {
    const authorized = auth.requireAnyRole(context, req, ['it_support_approve', 'admin']);
    if (!authorized.ok) {
      context.res = { status: authorized.status, body: authorized.body };
      return;
    }
    const items = await store.list({
      projectId: req.query && req.query.projectId,
      limit: req.query && req.query.limit
    });
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: { ok: true, count: items.length, items }
    };
  } catch (error) {
    context.log.error('ado-deployment-status failed:', error.message);
    context.res = { status: 503, body: { ok: false, error: 'Deployment status storage is unavailable.' } };
  }
};

