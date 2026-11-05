const auth = require('../shared/auth');
const store = require('../shared/ado-deployment-event-store');
const { buildTracking } = require('../shared/pr-build-tracking');

module.exports = async function (context, req) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' };
  const authorized = auth.requireAnyRole(context, req, ['it_support_approve', 'admin']);
  if (!authorized.ok) { context.res = { status: authorized.status, headers, body: authorized.body }; return; }
  const query = req.query || {};
  if (['from', 'to'].some(field => query[field] && (!/^\d{4}-\d{2}-\d{2}T/.test(query[field]) || !Number.isFinite(Date.parse(query[field])))) ||
    (query.from && query.to && Date.parse(query.from) >= Date.parse(query.to)) ||
    (query.environmentGroup && !['Staging', 'Production', 'Development', 'Other'].includes(query.environmentGroup))) {
    context.res = { status: 400, headers, body: { ok: false, error: 'Invalid date range or environment.' } }; return;
  }
  try {
    // Do not filter by result: successful events are required to evaluate recovery.
    const items = await store.listAll({ from: req.query && req.query.from, to: req.query && req.query.to,
      environmentGroup: req.query && req.query.environmentGroup });
    context.res = { status: 200, headers,
      body: { ok: true, tracking: buildTracking(items) } };
  } catch (error) {
    context.log.error('ado-pr-build-tracking failed:', error.message);
    context.res = { status: 503, headers, body: { ok: false, error: 'PR / CI-CD tracking is unavailable.' } };
  }
};
