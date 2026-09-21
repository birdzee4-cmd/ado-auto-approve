const https = require('https');

let cachedToken = null;
let tokenExpiresAt = 0;
let cachedSiteId = null;
let cachedListId = null;
const incidentYearFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric'
});

function getConfig() {
  const config = {
    tenant: process.env.AAD_TENANT_ID,
    clientId: process.env.AAD_CLIENT_ID,
    clientSecret: process.env.AAD_CLIENT_SECRET,
    hostname: process.env.OPERATIONS_SHAREPOINT_HOSTNAME || process.env.SHAREPOINT_HOSTNAME,
    sitePath: process.env.OPERATIONS_SHAREPOINT_SITE_PATH || process.env.SHAREPOINT_SITE_PATH,
    listName: process.env.OPERATIONS_SHAREPOINT_LIST_NAME || 'Operations Hub Incidents'
  };
  const missing = Object.entries(config)
    .filter(([key, value]) => key !== 'listName' && !value)
    .map(([key]) => key);
  if (missing.length) throw new Error('Missing Operations SharePoint settings: ' + missing.join(', '));
  return config;
}

function httpRequest(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const request = https.request({
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      method,
      headers: Object.assign({ Accept: 'application/json' }, headers || {}),
      timeout: 15000
    }, response => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => {
        let parsed = null;
        try { parsed = responseBody ? JSON.parse(responseBody) : null; } catch (err) {}
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode || 500,
          body: parsed || responseBody
        });
      });
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Microsoft Graph request timed out')));
    if (data) request.write(data);
    request.end();
  });
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60000) return cachedToken;
  const config = getConfig();
  const body = `client_id=${encodeURIComponent(config.clientId)}` +
    `&client_secret=${encodeURIComponent(config.clientSecret)}` +
    `&scope=${encodeURIComponent('https://graph.microsoft.com/.default')}` +
    '&grant_type=client_credentials';
  const result = await httpRequest(
    'POST',
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`,
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  );
  if (!result.ok || !result.body || !result.body.access_token) {
    throw new Error('Unable to acquire Microsoft Graph token');
  }
  cachedToken = result.body.access_token;
  tokenExpiresAt = now + (Number(result.body.expires_in || 3600) * 1000);
  return cachedToken;
}

async function getSiteId() {
  if (cachedSiteId) return cachedSiteId;
  const config = getConfig();
  const token = await getAccessToken();
  const result = await httpRequest(
    'GET',
    `https://graph.microsoft.com/v1.0/sites/${config.hostname}:${config.sitePath}`,
    { Authorization: 'Bearer ' + token }
  );
  if (!result.ok || !result.body || !result.body.id) throw new Error('Operations SharePoint site was not found');
  cachedSiteId = result.body.id;
  return cachedSiteId;
}

async function getListId() {
  if (cachedListId) return cachedListId;
  const config = getConfig();
  const siteId = await getSiteId();
  const token = await getAccessToken();
  const result = await httpRequest(
    'GET',
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists?$select=id,displayName,name`,
    { Authorization: 'Bearer ' + token }
  );
  if (!result.ok) throw new Error('Unable to list SharePoint lists for Operations Hub');
  const list = (result.body && result.body.value || []).find(item =>
    item.displayName === config.listName || item.name === config.listName
  );
  if (!list) throw new Error('Operations SharePoint List was not found');
  cachedListId = list.id;
  return cachedListId;
}

async function listItems(maxItems) {
  const maximum = Math.max(1, Math.min(Number(maxItems) || 500, 1000));
  const siteId = await getSiteId();
  const listId = await getListId();
  const token = await getAccessToken();
  const headers = {
    Authorization: 'Bearer ' + token,
    Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly'
  };
  let url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items` +
    '?$expand=fields&$orderby=lastModifiedDateTime desc&$top=200';
  const items = [];

  while (url && items.length < maximum) {
    const result = await httpRequest('GET', url, headers);
    if (!result.ok) throw new Error('Unable to read Operations Hub incidents from SharePoint');
    const page = result.body && Array.isArray(result.body.value) ? result.body.value : [];
    items.push(...page.slice(0, maximum - items.length));
    url = result.body && result.body['@odata.nextLink'] || '';
  }
  return items;
}

async function listIncidents(maxItems) {
  return (await listItems(maxItems)).map(mapSharePointIncident).sort(compareNewest);
}

async function getIncident(incidentId) {
  const target = String(incidentId || '').trim().toLowerCase();
  if (!target) return null;
  const items = await listIncidents(1000);
  return items.find(item => item.incidentId.toLowerCase() === target) || null;
}

function mapSharePointIncident(item) {
  const fields = item && item.fields || {};
  const sharePointId = sharePointItemId(item);
  const createdAt = dateField(fields, ['Created']) || isoDate(item && item.createdDateTime);
  const incidentId = textField(fields, ['IncidentId', 'CorrelationId']) || `SP-${item && item.id || 'unknown'}`;
  const adoState = textField(fields, ['AdoState', 'ADOState', 'WorkItemState']);
  const alertStatus = normalizeAlertStatus(textField(fields, ['AlertStatus', 'Status']), adoState);
  const workflowStatus = textField(fields, ['WorkflowStatus', 'AutomationStatus']) || 'RECEIVED';
  const workItemIdValue = textField(fields, ['AdoWorkItemId', 'ADOWorkItemId', 'WorkItemId']);
  const workItemId = /^\d+$/.test(workItemIdValue) ? Number(workItemIdValue) : undefined;
  const resource = textField(fields, ['Resource', 'Service']) || '-';
  const receivedAt = dateField(fields, ['ReceivedAt']) || item.createdDateTime || '';
  const firstSeenAt = dateField(fields, ['FirstSeenAt', 'FirstSeen']) || receivedAt;
  const resolvedAt = dateField(fields, ['ResolvedAt']);
  const lastAlertAt = dateField(fields, ['LastAlertAt']);
  const lastSyncedAt = dateField(fields, ['LastSyncedAt', 'LastSeen']) || item.lastModifiedDateTime || receivedAt;
  const lastSeen = latestDate([resolvedAt, lastAlertAt, lastSyncedAt, firstSeenAt, receivedAt]);

  return {
    sharePointId,
    displayId: formatIncidentDisplayId(item),
    incidentId,
    alertName: textField(fields, ['AlertName', 'Title']) || 'Untitled alert',
    resource,
    service: textField(fields, ['Service', 'Resource']) || '-',
    environment: textField(fields, ['Environment']) || inferEnvironment(resource),
    metric: textField(fields, ['Metric']),
    severity: textField(fields, ['Severity']),
    priority: textField(fields, ['Priority']) || '-',
    status: alertStatus,
    workflowStatus,
    trackingStatus: trackingStatus(alertStatus, workflowStatus, adoState, workItemId),
    approvalOutcome: textField(fields, ['ApprovalOutcome']),
    approvalAttempt: numberField(fields, ['ApprovalAttempt']),
    approvalId: textField(fields, ['ApprovalId']),
    approvalBy: textField(fields, ['ApprovalBy']),
    approvalComment: textField(fields, ['ApprovalComment']),
    approvalRequestedAt: dateField(fields, ['ApprovalRequestedAt']),
    approvalCompletedAt: dateField(fields, ['ApprovalCompletedAt']),
    receivedAt,
    createdAt,
    firstSeen: firstSeenAt,
    resolvedAt,
    durationMinutes: durationMinutes(firstSeenAt, resolvedAt),
    lastAlertAt,
    lastSeen,
    lastSyncedAt,
    occurrenceCount: numberField(fields, ['OccurrenceCount']),
    workItemId,
    workItemUrl: safeAdoUrl(textField(fields, ['AdoWorkItemUrl', 'ADOWorkItemUrl', 'WorkItemUrl'])),
    adoState,
    assignedTo: textField(fields, ['AssignedTo']),
    adoCreatedAt: dateField(fields, ['AdoCreatedAt']),
    adoClosedAt: dateField(fields, ['AdoClosedAt']),
    errorDetail: textField(fields, ['ErrorDetail']),
    sourceMessageId: textField(fields, ['SourceMessageId']),
    lastSourceMessageId: textField(fields, ['LastSourceMessageId']),
    flowRunId: textField(fields, ['FlowRunId']),
    subscription: textField(fields, ['Subscription']),
    resourceGroup: textField(fields, ['ResourceGroup']),
    appServicePlan: textField(fields, ['AppServicePlan']),
    defaultHost: textField(fields, ['DefaultHost']),
    currentValue: textField(fields, ['CurrentValue']),
    thresholdDetail: textField(fields, ['ThresholdDetail']),
    alertSummary: textField(fields, ['AlertSummary']),
    source: 'Power Automate / SharePoint'
  };
}

function formatIncidentDisplayId(item, now = new Date()) {
  const fields = item && item.fields || {};
  const firstSeenAt = textField(fields, ['FirstSeenAt', 'FirstSeen']);
  const createdAt = textField(fields, ['Created']) || item && item.createdDateTime;
  const year = incidentYear(firstSeenAt) || incidentYear(createdAt) || incidentYear(now) || '0000';
  const sharePointId = sharePointItemId(item);
  const sequence = sharePointId == null ? 'UNKNOWN' : String(sharePointId).padStart(6, '0');
  return `INC-${year}-${sequence}`;
}

function sharePointItemId(item) {
  const fields = item && item.fields || {};
  const value = item && item.id != null ? item.id : fields.ID;
  const normalized = String(value == null ? '' : value).trim();
  if (!/^\d+$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function incidentYear(value) {
  const parsed = value instanceof Date ? value : new Date(value || '');
  if (!Number.isFinite(parsed.getTime())) return '';
  return incidentYearFormatter.format(parsed);
}

function textField(fields, names) {
  for (const name of names) {
    const value = fields && fields[name];
    if (value && typeof value === 'object') {
      const nested = value.Url || value.url || value.LookupValue || value.displayName || value.email;
      if (nested != null && String(nested).trim()) return String(nested).trim();
    }
    if (value != null && typeof value !== 'object' && String(value).trim()) return String(value).trim();
  }
  return '';
}

function dateField(fields, names) {
  const value = textField(fields, names);
  return isoDate(value);
}

function isoDate(value) {
  if (!value) return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function numberField(fields, names) {
  const value = textField(fields, names);
  if (value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function durationMinutes(firstSeenAt, resolvedAt) {
  const started = Date.parse(firstSeenAt || '');
  const resolved = Date.parse(resolvedAt || '');
  if (!Number.isFinite(started) || !Number.isFinite(resolved) || resolved <= started) return undefined;
  return Math.round((resolved - started) / 60000);
}

function inferEnvironment(resource) {
  const value = String(resource || '').trim().toLowerCase();
  if (value.startsWith('prd-')) return 'Production';
  if (value.startsWith('stg-')) return 'Staging';
  if (value.startsWith('uat-')) return 'UAT';
  if (value.startsWith('dev-')) return 'Development';
  return 'Unknown';
}

function latestDate(values) {
  return (values || []).filter(value => Number.isFinite(Date.parse(value || '')))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || '';
}

function normalizeAlertStatus(status, adoState) {
  const value = String(status || '').trim().toUpperCase();
  if (value === 'FIRING' || value === 'RESOLVED') return value;
  return isClosedAdoState(adoState) ? 'RESOLVED' : 'FIRING';
}

function trackingStatus(alertStatus, workflowStatus, adoState, workItemId) {
  const workflow = String(workflowStatus || '').toUpperCase();
  if (workflow === 'FAILED' || workflow === 'ACTION_REQUIRED') return 'FAILED';
  if (workflow === 'CANCELLED') return 'CANCELLED';
  if (workflow === 'AWAITING_APPROVAL' || workflow === 'RECEIVED') return 'PENDING';
  if (workItemId && isClosedAdoState(adoState)) return 'CLOSED';
  if (workItemId) return 'OPEN';
  if (alertStatus === 'RESOLVED') return 'CLOSED';
  return 'NOT_CREATED';
}

function isClosedAdoState(state) {
  return ['CLOSED', 'DONE', 'REMOVED', 'RESOLVED'].includes(String(state || '').trim().toUpperCase());
}

function safeAdoUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || (host !== 'dev.azure.com' && !host.endsWith('.visualstudio.com'))) return '';
    return url.toString();
  } catch (err) {
    return '';
  }
}

function compareNewest(left, right) {
  return (Date.parse(right.lastSeen || right.receivedAt) || 0) - (Date.parse(left.lastSeen || left.receivedAt) || 0);
}

module.exports = {
  formatIncidentDisplayId,
  getIncident,
  listIncidents,
  mapSharePointIncident,
  trackingStatus,
  safeAdoUrl,
  durationMinutes,
  inferEnvironment
};
