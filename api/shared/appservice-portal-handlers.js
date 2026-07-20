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

  const roles = roleCheck.userRoles || [];
  const name = String(req.query && req.query.name || '').trim();

  try {
    const client = require('./appservice-client');
    const result = await client.getAppSettings(name);
    const maskedSettings = maskSettingsForRoles(result.settings, roles);

    jsonResponse(context, 200, {
      ok: true,
      name: result.app.name,
      resourceGroup: result.app.resourceGroup,
      settings: maskedSettings,
      settingKeys: result.settingKeys,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    const detail = getPublicErrorDetail(err);
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

async function handleLogs(context, req) {
  const roleCheck = requirePortalRole(context, req);
  if (!roleCheck.ok) {
    jsonResponse(context, roleCheck.status, roleCheck.body);
    return;
  }

  try {
    const audit = require('./appservice-audit-client');
    const query = req.query || {};
    const top = Math.max(1, Math.min(parseInt(query.top, 10) || 100, 200));
    const action = normalizeFilter(query.action);
    const resultFilter = normalizeFilter(query.result);
    const app = normalizeFilter(query.app);
    const user = normalizeFilter(query.user);
    const q = normalizeFilter(query.q);

    const response = await audit.getRecentAuditItems(top);
    if (!response.ok) {
      jsonResponse(context, 502, {
        ok: false,
        error: 'Failed to read App Service Portal Log',
        detail: 'SharePoint returned HTTP ' + response.status
      });
      return;
    }

    const allItems = (response.body.value || [])
      .map(normalizeAppServiceLogItem)
      .filter(item => String(item.action || '').toLowerCase().includes('restart'));
    const items = allItems
      .filter(item => {
        if (action && !String(item.action || '').toLowerCase().includes(action)) return false;
        if (resultFilter && !String(item.result || '').toLowerCase().includes(resultFilter)) return false;
        if (app && !String(item.appServiceName || '').toLowerCase().includes(app)) return false;
        if (user && !String(item.user || '').toLowerCase().includes(user)) return false;
        if (q && !matchesAppServiceLogKeyword(item, q)) return false;
        return true;
      })
      .sort(sortLogNewestFirst);

    jsonResponse(context, 200, {
      ok: true,
      count: items.length,
      totalFetched: allItems.length,
      top,
      fetchedAt: new Date().toISOString(),
      stats: buildAppServiceLogStats(items),
      items
    });
  } catch (err) {
    context.log.error('App Service portal log read failed:', getSafeDiagnostics(err));
    jsonResponse(context, err.statusCode || 500, {
      ok: false,
      error: 'Failed to read App Service Portal Log',
      detail: getAppServiceLogErrorDetail(err),
      diagnostics: getSafeDiagnostics(err)
    });
  }
}

function getPublicErrorDetail(err) {
  if (err && err.expose) return err.message;
  return 'Azure App Service request failed. Check Managed Identity, RBAC, and environment variables.';
}

function maskSettingsForRoles(settings, roles) {
  const rows = Array.isArray(settings) ? settings : [];
  if (hasUnrestrictedAdminRole(roles)) return rows;

  return rows.map(item => {
    if (!isAdminOnlySetting(item && item.name)) return item;
    return Object.assign({}, item, {
      value: '[Hidden: admin only]',
      masked: true
    });
  });
}

function hasUnrestrictedAdminRole(roles) {
  const normalizedRoles = (Array.isArray(roles) ? roles : [])
    .map(role => String(role || '').trim().toLowerCase());
  return normalizedRoles.includes('admin');
}

function isAdminOnlySetting(name) {
  const normalizedName = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/_+/g, '');
  return normalizedName === 'backofficeurlsettingsstatmiscpassword' ||
    normalizedName === 'keyvaultclientsecret' ||
    normalizedName === 'dockerregistryserverpassword';
}

function getAppServiceLogErrorDetail(err) {
  const message = String(err && err.message || '').trim();
  if (!message) return 'Unable to read App Service Portal Log';
  return message
    .replace(/client_secret=[^&\s]+/gi, 'client_secret=REDACTED')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer REDACTED');
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

function normalizeAppServiceLogItem(item) {
  const fields = item && item.fields || {};
  return {
    id: item.id,
    createdAt: item.createdDateTime,
    lastModifiedAt: item.lastModifiedDateTime,
    title: fields.Title || '',
    action: fields.Action || '',
    user: fields.User || '',
    userRoles: fields.User_Roles || '',
    appServiceName: fields.App_Service_Name || '',
    resourceGroup: fields.Resource_Group || '',
    result: fields.Result || '',
    reason: fields.Reason || '',
    source: fields.Log_Source || 'App Service Portal',
    eventKey: fields.Event_Key || '',
    viewedSettingKeys: fields.Viewed_Setting_Keys || ''
  };
}

function sortLogNewestFirst(a, b) {
  const timeB = Date.parse(b && b.createdAt);
  const timeA = Date.parse(a && a.createdAt);
  if (Number.isFinite(timeB) && Number.isFinite(timeA) && timeB !== timeA) return timeB - timeA;
  return (parseInt(b && b.id, 10) || 0) - (parseInt(a && a.id, 10) || 0);
}

function buildAppServiceLogStats(items) {
  const rows = Array.isArray(items) ? items : [];
  return {
    total: rows.length,
    restarts: rows.filter(item => String(item.action || '').toLowerCase().includes('restart')).length,
    success: rows.filter(item => String(item.result || '').toLowerCase() === 'success').length,
    failed: rows.filter(item => {
      const text = [item.result, item.reason, item.action].join(' ').toLowerCase();
      return text.includes('fail') || text.includes('error');
    }).length
  };
}

function normalizeFilter(value) {
  const text = String(value || '').trim().toLowerCase();
  return text === 'all' ? '' : text;
}

function matchesAppServiceLogKeyword(item, keyword) {
  const haystack = [
    item.title,
    item.action,
    item.user,
    item.userRoles,
    item.appServiceName,
    item.resourceGroup,
    item.result,
    item.reason,
    item.source,
    item.eventKey,
    item.viewedSettingKeys
  ].join(' ').toLowerCase();
  return haystack.includes(keyword);
}

module.exports = {
  jsonResponse,
  requirePortalRole,
  handleList,
  handleSettings,
  handleRestart,
  handleLogs,
  getPublicErrorDetail,
  getAppServiceLogErrorDetail,
  getSafeDiagnostics
};
