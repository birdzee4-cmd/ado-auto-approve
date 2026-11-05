const store = require('../shared/ado-deployment-event-store');
const auth = require('../shared/auth');

module.exports = async function (context, req) {
  const authorized = auth.requireAnyRole(context, req, ['it_support_approve', 'admin']);
  if (!authorized.ok) { context.res = { status: authorized.status, body: authorized.body }; return; }
  try {
    const csv = await store.exportCsv({ environmentGroup: req.query && req.query.environmentGroup, sourceType: req.query && req.query.sourceType, result: req.query && req.query.result, from: req.query && req.query.from, to: req.query && req.query.to });
    context.res = { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="deployment-events.csv"', 'Cache-Control': 'private, no-store' }, body: csv };
  } catch (error) {
    context.log.error('ado-deployment-export failed:', error.message);
    context.res = { status: 503, body: { ok: false, error: 'Deployment export storage is unavailable.' } };
  }
};
