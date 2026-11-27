const https = require('https');

let tokenCache;
let tokenExpiresAt = 0;
let siteIdCache;
let listIdCache;

function getConfig() {
  return {
    tenant: process.env.PROJECT_PLANNING_NOTIFICATION_SP_TENANT_ID,
    clientId: process.env.PROJECT_PLANNING_NOTIFICATION_SP_CLIENT_ID,
    clientSecret: process.env.PROJECT_PLANNING_NOTIFICATION_SP_CLIENT_SECRET,
    hostname: process.env.PROJECT_PLANNING_NOTIFICATION_SP_HOSTNAME,
    sitePath: process.env.PROJECT_PLANNING_NOTIFICATION_SP_SITE_PATH,
    listName: process.env.PROJECT_PLANNING_NOTIFICATION_SP_LIST_NAME || 'Project Planning Deployment Notifications'
  };
}

function isConfigured() {
  const cfg = getConfig();
  return Boolean(cfg.tenant && cfg.clientId && cfg.clientSecret && cfg.hostname && cfg.sitePath);
}

function validateConfig(cfg) {
  if (!isConfigured()) throw new Error('Project Planning notification SharePoint settings are incomplete');
  if (!/^[a-z0-9.-]+\.sharepoint\.com$/i.test(cfg.hostname)) throw new Error('Invalid SharePoint hostname configuration');
  if (!/^\/(sites|teams)\/[A-Za-z0-9._-]+\/?$/i.test(cfg.sitePath)) throw new Error('Invalid SharePoint site path configuration');
}

function request(method, url, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = https.request({
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      method,
      headers: { Accept: 'application/json', ...headers, ...(payload ? { 'Content-Type': headers['Content-Type'] || 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) },
      timeout: 15000
    }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
        resolve({ status: res.statusCode || 0, ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300, body: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('SharePoint request timed out')));
    if (payload) req.write(payload);
    req.end();
  });
}

async function getToken() {
  const now = Date.now();
  if (tokenCache && now < tokenExpiresAt - 60000) return tokenCache;
  const cfg = getConfig();
  validateConfig(cfg);
  const url = `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/token`;
  const form = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  }).toString();
  const result = await request('POST', url, { 'Content-Type': 'application/x-www-form-urlencoded' }, form);
  if (!result.ok) throw new Error(`SharePoint authentication failed: HTTP ${result.status}`);
  tokenCache = result.body?.access_token;
  tokenExpiresAt = now + (Number(result.body?.expires_in) || 0) * 1000;
  if (!tokenCache) throw new Error('SharePoint authentication response did not contain a token');
  return tokenCache;
}

async function getSiteId() {
  if (siteIdCache) return siteIdCache;
  const cfg = getConfig();
  validateConfig(cfg);
  const token = await getToken();
  const result = await request('GET', `https://graph.microsoft.com/v1.0/sites/${cfg.hostname}:${cfg.sitePath}`, { Authorization: `Bearer ${token}` });
  if (!result.ok || !result.body?.id) throw new Error(`SharePoint site lookup failed: HTTP ${result.status}`);
  siteIdCache = result.body.id;
  return siteIdCache;
}

async function getListId() {
  if (listIdCache) return listIdCache;
  const siteId = await getSiteId();
  const token = await getToken();
  let url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/lists?$select=id,displayName,name&$top=200`;
  while (url) {
    const result = await request('GET', url, { Authorization: `Bearer ${token}` });
    if (!result.ok) throw new Error(`SharePoint list lookup failed: HTTP ${result.status}`);
    const match = (result.body?.value || []).find(list => list.displayName === getConfig().listName || list.name === getConfig().listName);
    if (match) {
      listIdCache = match.id;
      return listIdCache;
    }
    url = result.body?.['@odata.nextLink'] || '';
    if (url && !url.startsWith('https://graph.microsoft.com/')) throw new Error('Unexpected SharePoint pagination URL');
  }
  throw new Error('Project Planning notification SharePoint list was not found');
}

async function listRecent(top = 200) {
  const limit = Math.max(1, Math.min(Number.parseInt(top, 10) || 200, 500));
  const siteId = await getSiteId();
  const listId = await getListId();
  const token = await getToken();
  let url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(listId)}/items?$expand=fields&$orderby=lastModifiedDateTime%20desc&$top=${Math.min(limit, 200)}`;
  const items = [];
  while (url && items.length < limit) {
    const result = await request('GET', url, { Authorization: `Bearer ${token}` });
    if (!result.ok) throw new Error(`SharePoint notification log read failed: HTTP ${result.status}`);
    for (const item of result.body?.value || []) {
      const fields = item.fields || {};
      items.push({
        NotificationKey: fields.NotificationKey || '',
        TaskPlanningID: fields.TaskPlanningID ?? null,
        ProjectName: fields.ProjectName || '',
        SourceStatus: fields.SourceStatus ?? null,
        TeamsStatus: fields.TeamsStatus || '',
        TeamsSentAt: fields.TeamsSentAt || null,
        LineStatus: fields.LineStatus || '',
        LineSentAt: fields.LineSentAt || null,
        ErrorMessage: fields.ErrorMessage || '',
        LastAttemptAt: fields.LastAttemptAt || null,
        FlowRunId: fields.FlowRunId || '',
        Created: fields.Created || item.createdDateTime || null,
        Modified: fields.Modified || item.lastModifiedDateTime || null
      });
      if (items.length >= limit) break;
    }
    url = result.body?.['@odata.nextLink'] || '';
    if (url && !url.startsWith('https://graph.microsoft.com/')) throw new Error('Unexpected SharePoint pagination URL');
  }
  return items;
}

module.exports = { isConfigured, listRecent };
