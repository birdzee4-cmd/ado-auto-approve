/**
 * POST /api/activity-reconcile
 *
 * Admin-only wrapper around the background approval-log reconciliation.
 * Azure Static Web Apps enforces the admin route and this function verifies
 * the principal again before running any write operation.
 */

const auth = require('../shared/auth');
const hourlySync = require('../hourly-log-sync');

module.exports = async function (context, req) {
  const principal = auth.parseClientPrincipal(req && req.headers);
  if (!principal) {
    context.res = jsonResponse(401, { ok: false, error: 'Authentication required' });
    return;
  }
  if (!auth.hasAnyRole(principal, ['admin'])) {
    context.res = jsonResponse(403, { ok: false, error: 'Admin role required' });
    return;
  }

  try {
    const options = hourlySync.parseOptions(req && req.body);
    options.dryRun = false;
    const result = await hourlySync.runHourlyLogSync(context, options);
    context.res = jsonResponse(result.ok ? 200 : 502, result);
  } catch (err) {
    context.log.error('Activity reconciliation failed:', err);
    context.res = jsonResponse(500, {
      ok: false,
      error: 'Activity reconciliation failed',
      detail: err && err.message ? err.message : String(err)
    });
  }
};

function jsonResponse(status, body) {
  return {
    status: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  };
}
