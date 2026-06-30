module.exports = async function (context, req) {
  function jsonResponse(status, payload, extraHeaders) {
    context.res = {
      status,
      headers: Object.assign({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }, extraHeaders || {}),
      body: JSON.stringify(payload)
    };
  }

  const auth = require('../shared/auth');
  const requiredRole = process.env.APP_SERVICE_PORTAL_ROLE || 'tester_appservice_manager';
  const roleCheck = auth.requireAnyRole(context, req, [requiredRole, 'admin']);
  if (!roleCheck.ok) {
    jsonResponse(roleCheck.status, roleCheck.body);
    return;
  }

  const user = auth.getUserEmail(roleCheck.principal);
  const roles = roleCheck.userRoles || [];
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const name = String(body && body.name || '').trim();

  try {
    const client = require('../shared/appservice-client');
    const audit = require('../shared/appservice-audit-client');
    const result = await client.restartAppService(name, user);
    await audit.safeAudit(context, {
      action: 'RestartAppService',
      user,
      roles,
      appServiceName: result.app.name,
      resourceGroup: result.app.resourceGroup,
      result: 'Success',
      reason: 'Restart request submitted',
      eventKey: 'restart:' + result.app.name + ':' + Date.now()
    });

    jsonResponse(200, {
      ok: true,
      message: 'Restart request submitted successfully',
      name: result.app.name,
      resourceGroup: result.app.resourceGroup,
      cooldownSeconds: result.cooldownSeconds,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    const client = require('../shared/appservice-client');
    const audit = require('../shared/appservice-audit-client');
    const detail = getPublicErrorDetail(err);
    await audit.safeAudit(context, {
      action: 'RestartAppService',
      user,
      roles,
      appServiceName: name,
      resourceGroup: client.getScope().resourceGroup,
      result: 'Failed',
      reason: detail,
      eventKey: 'restart-failed:' + (name || 'unknown') + ':' + Date.now()
    });
    context.log.warn('App Service restart failed:', sanitizeError(err));
    const headers = err.retryAfterSeconds ? { 'Retry-After': String(err.retryAfterSeconds) } : {};
    jsonResponse(err.statusCode || 500, {
      ok: false,
      error: 'Failed to restart App Service',
      detail,
      retryAfterSeconds: err.retryAfterSeconds || 0
    }, headers);
  }
};

function getPublicErrorDetail(err) {
  if (err && err.expose) return err.message;
  return 'Azure App Service request failed. Check Managed Identity, RBAC, and environment variables.';
}

function sanitizeError(err) {
  return {
    statusCode: err && err.statusCode,
    code: err && err.code,
    name: err && err.name
  };
}
