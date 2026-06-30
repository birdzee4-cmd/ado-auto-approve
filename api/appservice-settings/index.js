module.exports = async function (context, req) {
  function jsonResponse(status, payload) {
    context.res = {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      },
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
  const name = String(req.query && req.query.name || '').trim();

  try {
    const client = require('../shared/appservice-client');
    const audit = require('../shared/appservice-audit-client');
    const result = await client.getAppSettings(name);
    await audit.safeAudit(context, {
      action: 'ViewAppSettings',
      user,
      roles,
      appServiceName: result.app.name,
      resourceGroup: result.app.resourceGroup,
      result: 'Success',
      reason: 'Viewed setting keys only',
      settingKeys: result.settingKeys,
      eventKey: 'appsettings:' + result.app.name + ':' + Date.now()
    });

    jsonResponse(200, {
      ok: true,
      name: result.app.name,
      resourceGroup: result.app.resourceGroup,
      settings: result.settings,
      settingKeys: result.settingKeys,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    const appservice = require('../shared/appservice-client');
    const audit = require('../shared/appservice-audit-client');
    const detail = getPublicErrorDetail(err);
    await audit.safeAudit(context, {
      action: 'ViewAppSettings',
      user,
      roles,
      appServiceName: name,
      resourceGroup: appservice.getScope().resourceGroup,
      result: 'Failed',
      reason: detail,
      eventKey: 'appsettings-failed:' + (name || 'unknown') + ':' + Date.now()
    });
    context.log.warn('App settings read failed:', sanitizeError(err));
    jsonResponse(err.statusCode || 500, {
      ok: false,
      error: 'Failed to read App Service settings',
      detail
    });
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
