const https = require('https');
const workItems = require('./operations-work-items');

let cachedToken = null;
let tokenExpiresAt = 0;
let cachedSiteId = null;
const cachedListIds = new Map();
const incidentYearFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric'
});

function getConfig() {
  const config = {
    tenant: process.env.AAD_TENANT_ID,
    clientId: process.env.AAD_CLIENT_ID,
    clientSecret: process.env.AAD_CLIENT_SECRET,
    siteId: process.env.OPERATIONS_SHAREPOINT_SITE_ID || process.env.SHAREPOINT_SITE_ID,
    hostname: process.env.OPERATIONS_SHAREPOINT_HOSTNAME || process.env.SHAREPOINT_HOSTNAME,
    sitePath: process.env.OPERATIONS_SHAREPOINT_SITE_PATH || process.env.SHAREPOINT_SITE_PATH,
    listName: process.env.OPERATIONS_SHAREPOINT_LIST_NAME || 'Operations Hub Incidents',
    workItemsListName: process.env.OPERATIONS_WORK_ITEMS_LIST_NAME || '',
    mappingsListName: process.env.OPERATIONS_MAPPINGS_LIST_NAME || '',
    auditListName: process.env.OPERATIONS_AUDIT_LIST_NAME || '',
    alertEventsListName: process.env.OPERATIONS_ALERT_EVENTS_LIST_NAME || ''
  };
  const missing = ['tenant', 'clientId', 'clientSecret', 'hostname', 'sitePath']
    .filter(key => !config[key]);
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
      // Large Operations Hub lists are read through Graph pagination.  A
      // single page can occasionally take longer than the old 15s timeout
      // once the list grows, so let the retry policy handle transient slowness.
      timeout: 30000
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
          retryAfter: response.headers['retry-after'] || '',
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

async function httpRequestWithRetry(method, url, headers, body) {
  let result;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      result = await httpRequest(method, url, headers, body);
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(8000, 1000 * (attempt + 1))));
      continue;
    }
    if (result.ok || ![408, 425, 429, 500, 502, 503, 504].includes(result.status) || attempt === 3) return result;
    const retryAfter = Number(result.retryAfter || result.body?.error?.innerError?.retryAfter || result.body?.retryAfter || 0);
    const delay = Math.min(15000, Math.max(1000, retryAfter * 1000 || 1000 * (attempt + 1)));
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  return result;
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60000) return cachedToken;
  const config = getConfig();
  const body = `client_id=${encodeURIComponent(config.clientId)}` +
    `&client_secret=${encodeURIComponent(config.clientSecret)}` +
    `&scope=${encodeURIComponent('https://graph.microsoft.com/.default')}` +
    '&grant_type=client_credentials';
  const result = await httpRequestWithRetry(
    'POST',
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`,
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  );
  if (!result.ok || !result.body || !result.body.access_token) {
    const code = String(result.body?.error || '').trim();
    const description = String(result.body?.error_description || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 240);
    throw new Error(`Unable to acquire Microsoft Graph token: HTTP ${result.status}${code ? ` (${code})` : ''}${description ? ` ${description}` : ''}`);
  }
  cachedToken = result.body.access_token;
  tokenExpiresAt = now + (Number(result.body.expires_in || 3600) * 1000);
  return cachedToken;
}

async function getSiteId() {
  if (cachedSiteId) return cachedSiteId;
  const config = getConfig();
  if (config.siteId) {
    cachedSiteId = config.siteId;
    return cachedSiteId;
  }
  const token = await getAccessToken();
  const result = await httpRequestWithRetry(
    'GET',
    `https://graph.microsoft.com/v1.0/sites/${config.hostname}:${config.sitePath}`,
    { Authorization: 'Bearer ' + token }
  );
  if (!result.ok || !result.body || !result.body.id) {
    const graphError = result.body && result.body.error || {};
    const code = String(graphError.code || '').trim();
    const message = String(graphError.message || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 240);
    throw new Error(`Operations SharePoint site lookup failed: HTTP ${result.status}${code ? ` (${code})` : ''}${message ? ` ${message}` : ''}`);
  }
  cachedSiteId = result.body.id;
  return cachedSiteId;
}

async function getListId(listName) {
  if (cachedListIds.has(listName)) return cachedListIds.get(listName);
  const config = getConfig();
  const siteId = await getSiteId();
  const token = await getAccessToken();
  const result = await httpRequestWithRetry(
    'GET',
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists?$select=id,displayName,name`,
    { Authorization: 'Bearer ' + token }
  );
  if (!result.ok) {
    const graphError = result.body && result.body.error || {};
    const code = String(graphError.code || '').trim();
    const message = String(graphError.message || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 240);
    throw new Error(`Unable to list SharePoint lists for Operations Hub: HTTP ${result.status}${code ? ` (${code})` : ''}${message ? ` ${message}` : ''}`);
  }
  const list = (result.body && result.body.value || []).find(item =>
    item.displayName === listName || item.name === listName
  );
  if (!list) throw new Error('Operations SharePoint List was not found: ' + listName);
  cachedListIds.set(listName, list.id);
  return list.id;
}

async function listItems(maxItems, listName, filter) {
  const maximum = maxItems === Infinity ? Infinity : Math.max(1, Math.min(Number(maxItems) || 500, 5000));
  const siteId = await getSiteId();
  const listId = await getListId(listName);
  const token = await getAccessToken();
  const headers = {
    Authorization: 'Bearer ' + token,
    Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly'
  };
  const filterQuery = filter ? `&$filter=${encodeURIComponent(filter)}` : '';
  const pageSize = maximum === Infinity ? 500 : Math.max(1, Math.min(500, maximum));
  let url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items` +
    // Keep large history reads to a small number of Graph pages. The old
    // 200-row page size required six or more sequential requests once the
    // list passed 1,000 rows and intermittently hit SharePoint throttling.
    `?$expand=fields${filterQuery}&$orderby=lastModifiedDateTime desc&$top=${pageSize}`;
  const items = [];

  while (url && items.length < maximum) {
    let result;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        result = await httpRequest('GET', url, headers);
      } catch (error) {
        // Network resets and request timeouts are transient with Graph. Keep
        // the same bounded retry behavior as HTTP throttling responses.
        if (attempt === 3) throw error;
        const delay = Math.min(12000, 1000 * (attempt + 1) * (attempt + 1));
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      if (result.ok || ![408, 425, 429, 500, 502, 503, 504].includes(result.status) || attempt === 3) break;
      const retryAfter = Number(result.body?.error?.innerError?.retryAfter || result.body?.retryAfter || 0);
      const delay = Math.min(12000, Math.max(1000, retryAfter * 1000 || 1000 * (attempt + 1) * (attempt + 1)));
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    if (!result.ok) {
      const graphError = result.body && result.body.error || {};
      const code = String(graphError.code || '').trim();
      const message = String(graphError.message || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 240);
      throw new Error(`Unable to read Operations Hub incidents from SharePoint: HTTP ${result.status}${code ? ` (${code})` : ''}${message ? ` ${message}` : ''}`);
    }
    const page = result.body && Array.isArray(result.body.value) ? result.body.value : [];
    items.push(...page.slice(0, maximum - items.length));
    url = result.body && result.body['@odata.nextLink'] || '';
  }
  return items;
}

async function listIncidents(maxItems, options = {}) {
  const config = getConfig();
  // Keep the large reads sequential. Running three multi-page Graph reads in
  // parallel causes activityLimitReached throttling once the history grows.
  const incidentItems = await listItems(maxItems, config.listName);
  // Microsoft Graph rejects the field_6/field_7 filter for this list in some
  // tenants. Read the audit rows and filter after mapping instead of failing
  // the entire incident load with HTTP 400.
  // Supporting lists are intentionally bounded per request so the dashboard
  // remains responsive; the primary incident list can still page up to 5,000.
  // The incidents explorer can opt out of enrichment because it only needs
  // primary incident rows. Loading audit and work-item lists for every search
  // multiplied Graph traffic and made SharePoint throttling much more likely.
  if (options.enrich === false) return incidentItems.map(mapSharePointIncident).sort(compareNewest);
  let auditItems = [];
  let related = [];
  // Audit and handoff lists enrich the view, but should not make the primary
  // Incident list unavailable during a transient SharePoint failure.
  if (config.auditListName) {
    try { auditItems = await listItems(1000, config.auditListName); } catch (error) { auditItems = []; }
  }
  if (config.workItemsListName) {
    try { related = await listWorkItems(1000, config.workItemsListName); } catch (error) { related = []; }
  }
  let incidents = incidentItems.map(mapSharePointIncident).sort(compareNewest);
  if (config.auditListName) {
    const closureEvents = auditItems
      .map(mapAuditEvent)
      .filter(item => item.eventType === 'INCIDENT_CLOSED' && item.result === 'SUCCEEDED');
    incidents = attachIncidentClosureEvents(incidents, closureEvents);
  }
  return workItems.attachWorkItems(incidents, related);
}

async function listIncidentRows(maxItems = 5000) {
  return listIncidents(maxItems, { enrich: false });
}

// Cursor-based explorer read. The cursor is the opaque Graph nextLink; callers
// must store and return it without attempting to construct skip/offset values.
async function listIncidentPage(pageSize = 20, cursor = '') {
  const config = getConfig();
  const siteId = await getSiteId();
  const listId = await getListId(config.listName);
  const token = await getAccessToken();
  const size = Math.max(1, Math.min(Number(pageSize) || 20, 100));
  let url = cursor || `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$orderby=lastModifiedDateTime desc&$top=${size}`;
  const result = await httpRequestWithRetry('GET', url, {
    Authorization: 'Bearer ' + token,
    Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly'
  });
  if (!result.ok) {
    const graphError = result.body && result.body.error || {};
    throw new Error(`Unable to read Operations Hub incidents page: HTTP ${result.status} (${graphError.code || 'GraphError'}) ${graphError.message || ''}`.trim());
  }
  return {
    items: (result.body && Array.isArray(result.body.value) ? result.body.value : []).map(mapSharePointIncident),
    nextCursor: result.body && result.body['@odata.nextLink'] || ''
  };
}

// Used by administrative migrations that only need the primary incident
// records. Avoid enriching every row with supporting lists during a repair;
// those lists are independent and can be temporarily throttled by Graph.
async function listIncidentRecords(maxItems = 5000) {
  const config = getConfig();
  return (await listItems(maxItems, config.listName)).map(mapSharePointIncident).sort(compareNewest);
}

function attachIncidentClosureEvents(incidents, events) {
  const latestByIncident = new Map();
  for (const event of events || []) {
    const key = String(event.incidentId || '').trim().toLowerCase();
    if (!key) continue;
    const existing = latestByIncident.get(key);
    if (!existing || Date.parse(event.timestamp || '') > Date.parse(existing.timestamp || '')) {
      latestByIncident.set(key, event);
    }
  }
  return (incidents || []).map(incident => {
    const event = latestByIncident.get(String(incident.incidentId || '').trim().toLowerCase());
    if (!event) return incident;
    return {
      ...incident,
      operationsStatus: 'CLOSED',
      operationsClosedBy: event.operationsUserEmail || '',
      operationsClosedAt: event.timestamp || ''
    };
  });
}

async function listWorkItems(maxItems, listName) {
  const items = await listItems(maxItems, listName);
  return items.map(item => workItems.mapSharePointWorkItem(item, {
    textField,
    dateField,
    safeAdoUrl
  })).filter(Boolean);
}

async function listConfiguredWorkItems(maxItems) {
  const config = getConfig();
  if (!config.workItemsListName) return [];
  return listWorkItems(maxItems || 1000, config.workItemsListName);
}

async function graphListRequest(method, listName, suffix, body) {
  if (!listName) throw new Error('Operations supporting SharePoint List is not configured');
  const siteId = await getSiteId();
  const listId = await getListId(listName);
  const token = await getAccessToken();
  let result;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    result = await httpRequest(
      method,
      `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}${suffix || ''}`,
      {
        Authorization: 'Bearer ' + token,
        ...(body == null ? {} : { 'Content-Type': 'application/json' })
      },
      body
    );
    if (result.ok || ![408, 425, 429, 500, 502, 503, 504].includes(result.status) || attempt === 3) break;
    const retryAfter = Number(result.body?.error?.innerError?.retryAfter || result.body?.retryAfter || 0);
    const delay = Math.min(15000, Math.max(1000, retryAfter * 1000 || 1500 * (attempt + 1)));
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  if (!result.ok) {
    const graphError = result.body && result.body.error || {};
    const code = String(graphError.code || '').trim();
    const message = String(graphError.message || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 500);
    const detail = [code, message].filter(Boolean).join(': ');
    throw new Error(`Operations SharePoint write failed: HTTP ${result.status}${detail ? ` (${detail})` : ''}`);
  }
  return result.body;
}

async function createSupportingItem(listName, fields) {
  const cleanFields = Object.fromEntries(Object.entries(fields || {}).filter(([, value]) => value !== undefined && value !== null));
  return graphListRequest('POST', listName, '/items', { fields: cleanFields });
}

async function updateSupportingItem(listName, itemId, fields) {
  return graphListRequest('PATCH', listName, `/items/${encodeURIComponent(String(itemId))}/fields`, fields);
}

async function listMappings(options = {}) {
  const config = getConfig();
  if (!config.mappingsListName) return [];
  const mappings = (await listItems(1000, config.mappingsListName)).map(mapServiceMapping);
  return options.includeDisabled ? mappings : mappings.filter(item => item.enabled);
}

function mapServiceMapping(item) {
  const fields = item && item.fields || {};
  return {
    sharePointId: sharePointItemId(item),
    // Lists created through the modern SharePoint UI expose generated Graph
    // internal names (field_1, field_2, ...). Keep the semantic names first
    // so provisioned lists continue to work, then accept the observed aliases.
    mappingId: textField(fields, ['MappingId', 'field_1']) || String(item && item.id || ''),
    service: textField(fields, ['Service', 'field_2']),
    alertNamePattern: textField(fields, ['AlertNamePattern', 'field_3']),
    resourcePattern: textField(fields, ['ResourcePattern', 'field_4']),
    environment: textField(fields, ['Environment', 'field_5']),
    supportTeam: textField(fields, ['SupportTeam', 'field_6']).toUpperCase().replace(/[\s-]+/g, '_'),
    adoProject: textField(fields, ['AdoProject', 'field_7']),
    workItemType: textField(fields, ['WorkItemType', 'field_8']),
    areaPath: textField(fields, ['AreaPath', 'field_9']),
    iterationPath: textField(fields, ['IterationPath', 'field_10']),
    assignedTeam: textField(fields, ['AssignedTeam', 'field_11']),
    defaultTags: textField(fields, ['DefaultTags', 'field_12']),
    enabled: booleanField(fields, ['Enabled', 'field_13'], false),
    priority: numberField(fields, ['Priority', 'field_14']) || 0
  };
}

async function createWorkItemRecord(fields) {
  const config = getConfig();
  return createSupportingItem(config.workItemsListName, mapWorkItemWriteFields(fields));
}

async function updateWorkItemRecord(itemId, fields) {
  const config = getConfig();
  return updateSupportingItem(config.workItemsListName, itemId, mapWorkItemWriteFields(fields));
}

function mapWorkItemWriteFields(fields) {
  const aliases = {
    IncidentId: 'field_1',
    WorkItemId: 'field_2',
    Role: 'field_3',
    SupportTeam: 'field_4',
    State: 'field_5',
    WorkItemUrl: 'field_6',
    AssignedTo: 'field_7',
    CreatedAt: 'field_8',
    ClosedAt: 'field_9',
    LastSyncedAt: 'field_10',
    IdempotencyKey: 'field_11'
  };
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [aliases[key] || key, value]));
}

async function updateIncidentRecord(itemId, fields) {
  const config = getConfig();
  return updateSupportingItem(config.listName, itemId, mapIncidentWriteFields(fields));
}

function mapIncidentWriteFields(fields, fieldMap = {}) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [fieldMap[key] || key, value]));
}

async function appendAudit(fields) {
  const config = getConfig();
  return createSupportingItem(config.auditListName, mapAuditWriteFields(fields));
}

async function listAlertEvents(maxItems, status) {
  if (!String(process.env.OPERATIONS_ALERT_EVENTS_LIST_NAME || '').trim()) return [];
  const config = getConfig();
  if (!config.alertEventsListName) return [];
  const normalizedStatus = String(status || '').trim().toUpperCase();
  const filter = normalizedStatus ? `fields/ProcessingStatus eq '${normalizedStatus.replace(/'/g, "''")}'` : '';
  return (await listItems(maxItems || 200, config.alertEventsListName, filter))
    .map(mapAlertEvent)
    .sort((left, right) => Date.parse(left.receivedAt || left.createdAt || '') - Date.parse(right.receivedAt || right.createdAt || ''));
}

async function getAlertEvent(eventId) {
  const target = String(eventId || '').trim().toLowerCase();
  if (!target) return null;
  if (!String(process.env.OPERATIONS_ALERT_EVENTS_LIST_NAME || '').trim()) return null;
  const config = getConfig();
  const escaped = String(eventId).replace(/'/g, "''");
  return (await listItems(5, config.alertEventsListName, `fields/EventId eq '${escaped}'`)).map(mapAlertEvent).find(item => item.eventId.toLowerCase() === target) || null;
}

async function findAlertEventByMessageId(messageId) {
  const target = String(messageId || '').trim().toLowerCase();
  if (!target) return null;
  if (!String(process.env.OPERATIONS_ALERT_EVENTS_LIST_NAME || '').trim()) return null;
  const config = getConfig();
  const escaped = String(messageId).replace(/'/g, "''");
  return (await listItems(5, config.alertEventsListName, `fields/MessageId eq '${escaped}'`)).map(mapAlertEvent).find(item => item.messageId.toLowerCase() === target) || null;
}

async function createAlertEvent(fields) {
  if (!String(process.env.OPERATIONS_ALERT_EVENTS_LIST_NAME || '').trim()) throw new Error('Operations Alert Events SharePoint List is not configured');
  const config = getConfig();
  return createSupportingItem(config.alertEventsListName, mapAlertEventWriteFields(fields));
}

async function updateAlertEvent(itemId, fields) {
  if (!String(process.env.OPERATIONS_ALERT_EVENTS_LIST_NAME || '').trim()) throw new Error('Operations Alert Events SharePoint List is not configured');
  const config = getConfig();
  return updateSupportingItem(config.alertEventsListName, itemId, mapAlertEventWriteFields(fields));
}

function mapAlertEventWriteFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).filter(([, value]) => value !== undefined && value !== null));
}

function mapAlertEvent(item) {
  const fields = item && item.fields || {};
  return {
    sharePointId: sharePointItemId(item),
    eventId: textField(fields, ['EventId']) || String(item && item.id || ''),
    messageId: textField(fields, ['MessageId']),
    eventType: textField(fields, ['EventType']).toUpperCase(),
    incidentId: textField(fields, ['IncidentId']),
    alertName: textField(fields, ['AlertName']),
    resource: textField(fields, ['Resource']),
    firstSeenAt: dateField(fields, ['FirstSeenAt']),
    resolvedAt: dateField(fields, ['ResolvedAt']),
    receivedAt: dateField(fields, ['ReceivedAt']),
    rawSubject: textField(fields, ['RawSubject']),
    processingStatus: textField(fields, ['ProcessingStatus']).toUpperCase() || 'RECEIVED',
    matchedIncidentId: textField(fields, ['MatchedIncidentId']),
    matchMethod: textField(fields, ['MatchMethod']),
    errorCode: textField(fields, ['ErrorCode']),
    errorDetail: textField(fields, ['ErrorDetail']),
    attemptCount: numberField(fields, ['AttemptCount']) || 0,
    processedAt: dateField(fields, ['ProcessedAt']),
    createdAt: dateField(fields, ['Created']) || isoDate(item && item.createdDateTime)
  };
}

function mapAuditWriteFields(fields) {
  const aliases = {
    EventId: 'field_1', EventKey: 'field_2', CorrelationId: 'field_3', IncidentId: 'field_4',
    WorkItemId: 'field_5', Action: 'field_6', Result: 'field_7', OperationsUserId: 'field_8',
    OperationsUserName: 'field_9', OperationsUserEmail: 'field_10', AdoIdentityId: 'field_11',
    AdoIdentityName: 'field_12', AdoIdentityEmail: 'field_13', Detail: 'field_14', OccurredAt: 'field_15'
  };
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [aliases[key] || key, value]));
}

async function listAudit(incidentId) {
  const config = getConfig();
  if (!config.auditListName) return [];
  const target = String(incidentId || '').toLowerCase();
  const escapedIncidentId = String(incidentId || '').replace(/'/g, "''");
  return (await listItems(1000, config.auditListName, `fields/field_4 eq '${escapedIncidentId}'`))
    .map(mapAuditEvent)
    .filter(item => item.incidentId.toLowerCase() === target)
    .sort((left, right) => Date.parse(right.timestamp || '') - Date.parse(left.timestamp || ''));
}

async function listAllAudit(maxItems = 5000) {
  const config = getConfig();
  if (!config.auditListName) return [];
  return (await listItems(maxItems, config.auditListName)).map(mapAuditEvent);
}

function mapAuditEvent(item) {
  const fields = item && item.fields || {};
  return {
    eventId: textField(fields, ['EventId', 'field_1', 'EventKey', 'field_2']) || String(item && item.id || ''),
    eventKey: textField(fields, ['EventKey', 'field_2']),
    timestamp: dateField(fields, ['OccurredAt', 'field_15']) || isoDate(item && item.createdDateTime),
    eventType: textField(fields, ['Action', 'field_6']) || 'OPERATIONS_EVENT',
    incidentId: textField(fields, ['IncidentId', 'field_4']),
    workItemId: numberField(fields, ['WorkItemId', 'field_5']),
    result: textField(fields, ['Result', 'field_7']) || 'RECORDED',
    detail: plainText(textField(fields, ['Detail', 'field_14'])),
    operationsUserEmail: textField(fields, ['OperationsUserEmail', 'field_10']),
    adoIdentityEmail: textField(fields, ['AdoIdentityEmail', 'field_13'])
  };
}

function plainText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

async function getIncident(incidentId) {
  const target = String(incidentId || '').trim().toLowerCase();
  if (!target) return null;
  const config = getConfig();
  const escaped = String(incidentId).replace(/'/g, "''");
  // Detail reads should use indexed equality filters first. The previous
  // contains/or query is rejected by some Graph/SharePoint list indexes and
  // caused a fallback scan of up to 1,000 incidents before the drawer opened.
  const directResults = await Promise.allSettled([
    listItems(10, config.listName, `fields/IncidentId eq '${escaped}'`),
    listItems(10, config.listName, `fields/CorrelationId eq '${escaped}'`)
  ]);
  for (const result of directResults) {
    if (result.status !== 'fulfilled') continue;
    const direct = result.value.map(mapSharePointIncident).find(item => item.incidentId.toLowerCase() === target);
    if (direct) {
      // Detail responses must include related work items as well as the
      // primary item. This is especially important immediately after a
      // related ticket is created, when the UI reloads the incident detail.
      const related = await listConfiguredWorkItems(1000);
      return workItems.attachWorkItems([direct], related)[0];
    }
  }
  // Legacy records may not be indexed under either exact field. Keep a
  // bounded authoritative fallback for those records only.
  const items = await listIncidents(5000);
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
  const storedFirstSeenAt = dateField(fields, ['FirstSeenAt', 'FirstSeen']) || receivedAt;
  // Flow-generated incident IDs embed the canonical UTC First Seen instant.
  // Prefer it when available: this prevents a SharePoint/connector timezone
  // conversion from shifting the displayed Bangkok time for new incidents.
  const firstSeenAt = canonicalIncidentFirstSeen(incidentId) || storedFirstSeenAt;
  const resolvedAt = dateField(fields, ['ResolvedAt']);
  const lastAlertAt = dateField(fields, ['LastAlertAt']);
  const lastSyncedAt = dateField(fields, ['LastSyncedAt', 'LastSeen']) || item.lastModifiedDateTime || receivedAt;
  const lastSeen = latestDate([resolvedAt, lastAlertAt, lastSyncedAt, firstSeenAt, receivedAt]);
  const lifecycleIssues = incidentLifecycleIssues({ alertStatus, workflowStatus, adoState, workItemId, resolvedAt });

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
    lifecycleIssues,
    hasLifecycleConflict: lifecycleIssues.length > 0,
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
    operationsStatus: textField(fields, ['OperationsStatus']),
    operationsClosedBy: textField(fields, ['OperationsClosedBy']),
    operationsClosedAt: dateField(fields, ['OperationsClosedAt']),
    source: 'Power Automate / SharePoint',
    workItems: [],
    workItemSummary: { total: workItemId ? 1 : 0, open: workItemId && !isClosedAdoState(adoState) ? 1 : 0, closed: workItemId && isClosedAdoState(adoState) ? 1 : 0 }
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

function canonicalIncidentFirstSeen(incidentId) {
  const match = /^inc-(\d{14})-/i.exec(String(incidentId || ''));
  if (!match) return '';
  const raw = match[1];
  const value = Date.parse(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}Z`);
  return Number.isFinite(value) ? new Date(value).toISOString() : '';
}

function numberField(fields, names) {
  const value = textField(fields, names);
  if (value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanField(fields, names, fallback) {
  for (const name of names) {
    const value = fields && fields[name];
    if (typeof value === 'boolean') return value;
    if (String(value || '').toLowerCase() === 'true') return true;
    if (String(value || '').toLowerCase() === 'false') return false;
  }
  return fallback;
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
  return ['CLOSED', 'DONE', 'REMOVED', 'RESOLVED', 'REJECT', 'REJECTED'].includes(String(state || '').trim().toUpperCase());
}

function incidentLifecycleIssues({ alertStatus, workflowStatus, adoState, workItemId, resolvedAt }) {
  const issues = [];
  const workflow = String(workflowStatus || '').trim().toUpperCase();
  if (alertStatus === 'FIRING' && workItemId && isClosedAdoState(adoState)) issues.push('ALERT_FIRING_WORK_ITEM_CLOSED');
  if (alertStatus === 'RESOLVED' && !resolvedAt) issues.push('RESOLVED_TIMESTAMP_MISSING');
  if (alertStatus === 'RESOLVED' && ['RECEIVED', 'AWAITING_APPROVAL', 'PROCESSING'].includes(workflow)) issues.push('RESOLVED_WORKFLOW_STILL_ACTIVE');
  return issues;
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
  listReportIncidents: async () => {
    const config = getConfig();
    const incidents = (await listItems(Infinity, config.listName)).map(mapSharePointIncident);
    const related = config.workItemsListName ? await listWorkItems(Infinity, config.workItemsListName) : [];
    return workItems.attachWorkItems(incidents, related);
  },
  listIncidents,
  listIncidentRows,
  listIncidentPage,
  listIncidentRecords,
  listWorkItems,
  listConfiguredWorkItems,
  listMappings,
  mapServiceMapping,
  attachIncidentClosureEvents,
  mapAuditWriteFields,
  mapIncidentWriteFields,
  createWorkItemRecord,
  updateWorkItemRecord,
  updateIncidentRecord,
  listAlertEvents,
  getAlertEvent,
  findAlertEventByMessageId,
  createAlertEvent,
  updateAlertEvent,
  mapAlertEvent,
  mapAlertEventWriteFields,
  appendAudit,
  listAudit,
  listAllAudit,
  mapAuditEvent,
  mapSharePointIncident,
  trackingStatus,
  safeAdoUrl,
  durationMinutes,
  canonicalIncidentFirstSeen,
  inferEnvironment,
  incidentLifecycleIssues
};
