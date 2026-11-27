const auth = require('../shared/auth');
const notificationLog = require('../shared/project-planning-notification-client');

module.exports = async function (context, req) {
  const authorized = auth.requireAnyRole(context, req, ['it_support_approve', 'admin']);
  if (!authorized.ok) {
    context.res = { status: authorized.status, body: authorized.body };
    return;
  }

  try {
    if (!notificationLog.isConfigured()) {
      context.res = {
        status: 501,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        body: { ok: false, code: 'NOT_CONFIGURED', error: 'Project Planning notification log is not configured.' }
      };
      return;
    }

    const top = Math.max(1, Math.min(Number.parseInt(req.query?.top, 10) || 200, 500));
    const items = await notificationLog.listRecent(top);
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: { ok: true, source: 'SharePoint', readOnly: true, fetchedAt: new Date().toISOString(), items }
    };
  } catch (error) {
    context.log.error('project-planning-notification-log failed:', error.message);
    context.res = {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: { ok: false, error: 'Unable to read the Project Planning notification log.' }
    };
  }
};
