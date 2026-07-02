const https = require('https');

let cachedToken = null;
let tokenExpiresAt = 0;
let cachedSiteId = null;
let cachedListId = null;
let cachedColumns = null;
let optionalColumnsEnsured = false;

const OPTIONAL_COLUMNS = [
  'Action',
  'User',
  'User_Roles',
  'App_Service_Name',
  'Resource_Group',
  'Result',
  'Reason',
  'Log_Source',
  'Event_Key',
  'Viewed_Setting_Keys'
];

function getConfig() {
  const required = {
    tenant: process.env.AAD_TENANT_ID,
    clientId: process.env.AAD_CLIENT_ID,
    clientSecret: process.env.AAD_CLIENT_SECRET,
    hostname: process.env.APP_SERVICE_SHAREPOINT_HOSTNAME || process.env.SHAREPOINT_HOSTNAME,
    sitePath: process.env.APP_SERVICE_SHAREPOINT_SITE_PATH || process.env.SHAREPOINT_SITE_PATH,
    listName: process.env.APP_SERVICE_SHAREPOINT_LIST_NAME || 'App Service Portal Log'
  };
  const missing = Object.keys(required).filter(key => key !== 'listName' && !required[key]);
  if (missing.length) throw new Error('Missing App Service audit env vars: ' + missing.join(', '));
  return required;
}

function httpRequest(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const options = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method,
      headers: Object.assign({ Accept: 'application/json' }, headers || {}),
      timeout: 15000
    };
    if (data) {
      if (!options.headers['Content-Type']) options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request(options, (res) => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = resBody ? JSON.parse(resBody) : null; } catch (e) {}
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: parsed || resBody
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Graph API timeout (15s)'));
    });
    if (data) req.write(data);
    req.end();
  });
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60000) return cachedToken;
  const cfg = getConfig();
  const tokenUrl = `https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/token`;
  const body = `client_id=${encodeURIComponent(cfg.clientId)}` +
    `&client_secret=${encodeURIComponent(cfg.clientSecret)}` +
    `&scope=${encodeURIComponent('https://graph.microsoft.com/.default')}` +
    `&grant_type=client_credentials`;
  const result = await httpRequest('POST', tokenUrl, { 'Content-Type': 'application/x-www-form-urlencoded' }, body);
  if (!result.ok) throw new Error('Failed to get Graph token: HTTP ' + result.status);
  cachedToken = result.body.access_token;
  tokenExpiresAt = now + (result.body.expires_in * 1000);
  return cachedToken;
}

async function getSiteId() {
  if (cachedSiteId) return cachedSiteId;
  const cfg = getConfig();
  const token = await getAccessToken();
  const result = await httpRequest('GET', `https://graph.microsoft.com/v1.0/sites/${cfg.hostname}:${cfg.sitePath}`, {
    Authorization: 'Bearer ' + token
  });
  if (!result.ok) throw new Error('Failed to find SharePoint site for App Service audit: HTTP ' + result.status);
  cachedSiteId = result.body.id;
  return cachedSiteId;
}

async function getListId() {
  if (cachedListId) return cachedListId;
  const cfg = getConfig();
  const siteId = await getSiteId();
  const token = await getAccessToken();
  const result = await httpRequest('GET', `https://graph.microsoft.com/v1.0/sites/${siteId}/lists?$select=id,displayName,name`, {
    Authorization: 'Bearer ' + token
  });
  if (!result.ok) throw new Error('Failed to list SharePoint lists for App Service audit: HTTP ' + result.status);
  const list = (result.body.value || []).find(item => item.displayName === cfg.listName || item.name === cfg.listName);
  if (!list) throw new Error('App Service audit SharePoint List not found: ' + cfg.listName);
  cachedListId = list.id;
  return cachedListId;
}

async function getColumns(forceRefresh) {
  if (cachedColumns && !forceRefresh) return cachedColumns;
  const siteId = await getSiteId();
  const listId = await getListId();
  const token = await getAccessToken();
  const result = await httpRequest('GET', `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/columns?$select=name,displayName`, {
    Authorization: 'Bearer ' + token
  });
  if (!result.ok) throw new Error('Failed to list App Service audit columns: HTTP ' + result.status);
  cachedColumns = new Set((result.body.value || []).map(column => column.name));
  return cachedColumns;
}

async function ensureOptionalColumns() {
  if (optionalColumnsEnsured || process.env.APP_SERVICE_SHAREPOINT_AUTO_CREATE_COLUMNS === 'false') return;
  const columns = await getColumns(false);
  const missing = OPTIONAL_COLUMNS.filter(name => !columns.has(name));
  if (!missing.length) {
    optionalColumnsEnsured = true;
    return;
  }

  const siteId = await getSiteId();
  const listId = await getListId();
  const token = await getAccessToken();
  const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/columns`;
  let createdAny = false;
  for (const name of missing) {
    const result = await httpRequest('POST', url, {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    }, {
      name,
      displayName: name.replace(/_/g, ' '),
      text: {}
    });
    if (result.ok) createdAny = true;
  }
  if (createdAny) {
    cachedColumns = null;
    await getColumns(true);
  }
  optionalColumnsEnsured = true;
}

async function filterFields(fields) {
  try {
    await ensureOptionalColumns();
    const columns = await getColumns(false);
    const filtered = {};
    for (const [key, value] of Object.entries(fields || {})) {
      if (key === 'Title' || columns.has(key)) filtered[key] = value;
    }
    return filtered;
  } catch (e) {
    return fields;
  }
}

async function addAuditItem(fields) {
  const siteId = await getSiteId();
  const listId = await getListId();
  const token = await getAccessToken();
  const listFields = await filterFields(fields);
  return httpRequest('POST', `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items`, {
    Authorization: 'Bearer ' + token
  }, {
    fields: listFields
  });
}

async function getRecentAuditItems(top) {
  const limit = Math.max(1, Math.min(parseInt(top, 10) || 100, 200));
  const siteId = await getSiteId();
  const listId = await getListId();
  const token = await getAccessToken();
  const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items` +
    `?$expand=fields&$orderby=createdDateTime desc&$top=${limit}`;
  return httpRequest('GET', url, {
    Authorization: 'Bearer ' + token
  });
}

function buildAuditFields(opts) {
  const action = opts.action || 'AppServiceAction';
  const appName = opts.appServiceName || '';
  return {
    Title: action + (appName ? ' - ' + appName : ''),
    Action: action,
    User: opts.user || 'Unknown User',
    User_Roles: Array.isArray(opts.roles) ? opts.roles.join(', ') : String(opts.roles || ''),
    App_Service_Name: appName,
    Resource_Group: opts.resourceGroup || '',
    Result: opts.result || '',
    Reason: opts.reason || '',
    Log_Source: 'App Service Portal',
    Event_Key: opts.eventKey || '',
    Viewed_Setting_Keys: Array.isArray(opts.settingKeys) ? opts.settingKeys.join(', ') : ''
  };
}

async function safeAudit(context, opts) {
  try {
    return await addAuditItem(buildAuditFields(opts || {}));
  } catch (err) {
    if (context && context.log && context.log.warn) {
      context.log.warn('App Service audit log failed:', sanitizeError(err));
    }
    return { ok: false, status: 0, body: 'App Service audit log failed' };
  }
}

function sanitizeError(err) {
  return {
    statusCode: err && err.statusCode,
    code: err && err.code,
    name: err && err.name
  };
}

module.exports = {
  getConfig,
  addAuditItem,
  getRecentAuditItems,
  buildAuditFields,
  safeAudit
};
