function jsonResponse(context, status, payload, extraHeaders) {
  context.res = {
    status,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }, extraHeaders || {}),
    body: JSON.stringify(payload)
  };
}

function requirePortalRole(context, req) {
  const auth = require('./auth');
  const requiredRole = process.env.APP_SERVICE_PORTAL_ROLE || 'tester_appservice_manager';
  return auth.requireAnyRole(context, req, [requiredRole, 'admin']);
}

async function handleList(context, req) {
  const roleCheck = requirePortalRole(context, req);
  if (!roleCheck.ok) {
    jsonResponse(context, roleCheck.status, roleCheck.body);
    return;
  }

  try {
    const client = require('./appservice-client');
    const forceRefresh = String(req.query && req.query.refresh || '').toLowerCase() === 'true';
    const apps = await client.listAllowedAppServices(forceRefresh);
    jsonResponse(context, 200, {
      ok: true,
      apps,
      count: apps.length,
      scope: client.getScope(),
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    context.log.error('App Service list failed:', getSafeDiagnostics(err));
    const detail = getPublicErrorDetail(err);
    jsonResponse(context, err.statusCode || 500, {
      ok: false,
      error: 'Failed to list App Services',
      detail,
      scopeHint: 'Managed Identity must have Reader on the configured App Service resource group.',
      diagnostics: getSafeDiagnostics(err)
    });
  }
}

async function handleSettings(context, req) {
  const roleCheck = requirePortalRole(context, req);
  if (!roleCheck.ok) {
    jsonResponse(context, roleCheck.status, roleCheck.body);
    return;
  }

  const auth = require('./auth');
  const user = auth.getUserEmail(roleCheck.principal);
  const roles = roleCheck.userRoles || [];
  const name = String(req.query && req.query.name || '').trim();

  try {
    const client = require('./appservice-client');
    const audit = require('./appservice-audit-client');
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

    jsonResponse(context, 200, {
      ok: true,
      name: result.app.name,
      resourceGroup: result.app.resourceGroup,
      settings: result.settings,
      settingKeys: result.settingKeys,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    const client = require('./appservice-client');
    const audit = require('./appservice-audit-client');
    const detail = getPublicErrorDetail(err);
    await audit.safeAudit(context, {
      action: 'ViewAppSettings',
      user,
      roles,
      appServiceName: name,
      resourceGroup: client.getScope().resourceGroup,
      result: 'Failed',
      reason: detail,
      eventKey: 'appsettings-failed:' + (name || 'unknown') + ':' + Date.now()
    });
    context.log.warn('App settings read failed:', getSafeDiagnostics(err));
    jsonResponse(context, err.statusCode || 500, {
      ok: false,
      error: 'Failed to read App Service settings',
      detail
    });
  }
}

async function handleRestart(context, req) {
  const roleCheck = requirePortalRole(context, req);
  if (!roleCheck.ok) {
    jsonResponse(context, roleCheck.status, roleCheck.body);
    return;
  }

  const auth = require('./auth');
  const user = auth.getUserEmail(roleCheck.principal);
  const roles = roleCheck.userRoles || [];
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const name = String(body && body.name || '').trim();

  try {
    const client = require('./appservice-client');
    const audit = require('./appservice-audit-client');
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

    jsonResponse(context, 200, {
      ok: true,
      message: 'Restart request submitted successfully',
      name: result.app.name,
      resourceGroup: result.app.resourceGroup,
      cooldownSeconds: result.cooldownSeconds,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    const client = require('./appservice-client');
    const audit = require('./appservice-audit-client');
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
    context.log.warn('App Service restart failed:', getSafeDiagnostics(err));
    const headers = err.retryAfterSeconds ? { 'Retry-After': String(err.retryAfterSeconds) } : {};
    jsonResponse(context, err.statusCode || 500, {
      ok: false,
      error: 'Failed to restart App Service',
      detail,
      retryAfterSeconds: err.retryAfterSeconds || 0
    }, headers);
  }
}

function getPublicErrorDetail(err) {
  if (err && err.expose) return err.message;
  return 'Azure App Service request failed. Check Managed Identity, RBAC, and environment variables.';
}

function getSafeDiagnostics(err) {
  return {
    statusCode: err && err.statusCode,
    code: err && err.code,
    name: err && err.name,
    hasIdentityEndpoint: !!process.env.IDENTITY_ENDPOINT,
    hasIdentityHeader: !!process.env.IDENTITY_HEADER,
    hasMsiEndpoint: !!process.env.MSI_ENDPOINT,
    hasMsiSecret: !!process.env.MSI_SECRET,
    hasAzureTenantId: !!process.env.AZURE_TENANT_ID,
    hasAppServiceSubscriptionId: !!process.env.APP_SERVICE_SUBSCRIPTION_ID,
    hasAppServiceResourceGroup: !!process.env.APP_SERVICE_RESOURCE_GROUP
  };
}

module.exports = {
  jsonResponse,
  requirePortalRole,
  handleList,
  handleSettings,
  handleRestart,
  getPublicErrorDetail,
  getSafeDiagnostics
};
