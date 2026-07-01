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

  try {
    const client = require('../shared/appservice-client');
    const forceRefresh = String(req.query && req.query.refresh || '').toLowerCase() === 'true';
    const apps = await client.listAllowedAppServices(forceRefresh);
    jsonResponse(200, {
      ok: true,
      apps,
      count: apps.length,
      scope: client.getScope(),
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    context.log.error('App Service list failed:', sanitizeError(err));
    const detail = getPublicErrorDetail(err);
    jsonResponse(err.statusCode || 500, {
      ok: false,
      error: 'Failed to list App Services',
      detail,
      scopeHint: 'Managed Identity must have Reader on the configured App Service resource group.',
      diagnostics: getSafeDiagnostics(err)
    });
  }
};

function getPublicErrorDetail(err) {
  if (err && err.expose) return err.message;
  return 'Azure App Service request failed. Check Managed Identity, RBAC, and environment variables.';
}

function sanitizeError(err) {
  return getSafeDiagnostics(err);
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
