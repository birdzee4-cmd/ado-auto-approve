const crypto = require('crypto');
const defaultSharePoint = require('./operations-sharepoint-client');
const defaultAdo = require('./ado-client');
const defaultWorkItems = require('./operations-work-items');

function featureEnabled(name) {
  return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function requireFeature(name) {
  if (!featureEnabled(name)) {
    const error = new Error(`Operations feature is disabled: ${name}`);
    error.status = 503;
    error.code = 'FEATURE_DISABLED';
    throw error;
  }
}

function resolveMapping(mappings, incident, supportTeam) {
  const team = normalizeTeam(supportTeam);
  const candidates = (mappings || []).filter(mapping => {
    if (!mapping.enabled || normalizeTeam(mapping.supportTeam) !== team) return false;
    if (mapping.service && normalize(mapping.service) !== normalize(incident.service || incident.resource)) return false;
    if (mapping.environment && normalize(mapping.environment) !== normalize(incident.environment)) return false;
    if (mapping.alertNamePattern && !normalize(incident.alertName).includes(normalize(mapping.alertNamePattern))) return false;
    if (mapping.resourcePattern && !normalize(incident.resource).includes(normalize(mapping.resourcePattern))) return false;
    return true;
  }).sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
  const mapping = candidates[0];
  if (!mapping) throw operationalError(422, 'MAPPING_NOT_FOUND', `No enabled mapping was found for ${team}`);
  const required = ['adoProject', 'workItemType', 'areaPath'];
  if (team !== 'APP_SUPPORT') required.push('assignedTeam');
  const missing = required.filter(field => !mapping[field]);
  if (missing.length) throw operationalError(422, 'MAPPING_INCOMPLETE', 'Mapping is missing: ' + missing.join(', '));
  return mapping;
}

function buildCreatePatches(incident, mapping, input, primaryWorkItemId, organization, primaryWorkItem) {
  const title = String(input.title || `[${incident.displayId || incident.incidentId}] ${incident.alertName || incident.service}`).trim().slice(0, 255);
  const alertDetails = [
    ['Current Alert State', incident.status],
    ['Alert', incident.alertName],
    ['Severity / Priority', [incident.severity, incident.priority].filter(Boolean).join(' / ')],
    ['Service', incident.service || incident.resource],
    ['Resource', incident.resource],
    ['Environment', incident.environment],
    ['Subscription', incident.subscription],
    ['Resource Group', incident.resourceGroup],
    ['Plan', incident.appServicePlan],
    ['Default Host', incident.defaultHost],
    ['Metric', incident.metric],
    ['Current Value', incident.currentValue],
    ['Threshold', incident.thresholdDetail],
    ['Summary', incident.alertSummary],
    ['First Seen', formatBangkokTime(incident.firstSeen)],
    ['Resolved At', formatBangkokTime(incident.resolvedAt)]
  ].filter(([, value]) => value != null && String(value).trim() !== '');
  const generatedDescription = [
    `<p><strong>Operations Hub Incident:</strong> ${escapeHtml(incident.displayId || incident.incidentId)}</p>`,
    ...alertDetails.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`),
    input.detail ? `<p><strong>Tier 1 detail:</strong><br>${escapeHtml(input.detail).replace(/\r?\n/g, '<br>')}</p>` : ''
  ].filter(Boolean).join('');
  const description = String(primaryWorkItem?.fields?.['System.Description'] || generatedDescription);
  const tags = ['OperationsHub', incident.displayId || incident.incidentId, mapping.defaultTags]
    .filter(Boolean).join('; ');
  const patches = [
    patch('/fields/System.Title', title),
    patch('/fields/System.Description', description),
    patch('/fields/System.AreaPath', mapping.areaPath),
    patch('/fields/System.Tags', tags)
  ];
  if (mapping.assignedTeam) patches.push(patch('/fields/System.AssignedTo', mapping.assignedTeam));
  if (mapping.iterationPath) patches.push(patch('/fields/System.IterationPath', mapping.iterationPath));
  for (const [field, value] of Object.entries(profileFields(mapping.supportTeam, incident, primaryWorkItem))) {
    if (value != null && String(value).trim() !== '') patches.push(patch(`/fields/${field}`, value));
  }
  if (primaryWorkItemId) {
    patches.push({
      op: 'add',
      path: '/relations/-',
      value: {
        rel: 'System.LinkTypes.Related',
        url: `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/wit/workItems/${primaryWorkItemId}`,
        attributes: { comment: `Related to ${incident.displayId || incident.incidentId} through Operations Hub` }
      }
    });
  }
  return patches;
}

async function createRelated(input, context, dependencies = {}) {
  requireFeature('OPERATIONS_CREATE_ENABLED');
  const sp = dependencies.sharePoint || defaultSharePoint;
  const ado = dependencies.ado || defaultAdo;
  const incident = await requireIncident(sp, input.incidentId);
  if (!incident.workItemId) throw operationalError(409, 'PRIMARY_REQUIRED', 'The incident does not have a primary work item');
  const mappings = await sp.listMappings();
  const mapping = resolveMapping(mappings, incident, input.supportTeam);
  const idempotencyKey = makeIdempotencyKey(input.incidentId, mapping.supportTeam, input.idempotencyKey);
  const stored = await sp.listConfiguredWorkItems(1000);
  const existingForTeam = stored.find(item =>
    normalize(item.incidentId) === normalize(input.incidentId) &&
    normalizeOptionalTeam(item.supportTeam) === normalizeTeam(mapping.supportTeam)
  );
  if (existingForTeam) {
    await audit(sp, context, {
      incidentId: incident.incidentId,
      workItemId: existingForTeam.workItemId,
      action: 'CREATE_RELATED_WORK_ITEM',
      result: 'EXISTING_TEAM_WORK_ITEM',
      detail: `${normalizeTeam(mapping.supportTeam)} already has a related Work Item`,
      eventKey: `create-existing-team:${incident.incidentId}:${normalizeTeam(mapping.supportTeam)}:${existingForTeam.workItemId}`
    });
    return { incident, workItem: existingForTeam, mapping, duplicate: true };
  }
  const duplicate = stored.find(item => item.idempotencyKey === idempotencyKey);
  if (duplicate) {
    await audit(sp, context, {
      incidentId: incident.incidentId,
      workItemId: duplicate.workItemId,
      action: 'CREATE_RELATED_WORK_ITEM',
      result: 'IDEMPOTENT_REPLAY',
      detail: `${normalizeTeam(mapping.supportTeam)} request reused the existing Work Item`,
      eventKey: `create-replay:${idempotencyKey}:${context.correlationId || ''}`
    });
    return { incident, workItem: duplicate, mapping, duplicate: true };
  }

  const adoConfig = ado.getConfig();
  let credentialMode = 'DELEGATED';
  let primaryResponse = await ado.getWorkItem(incident.workItemId, { accessToken: context.accessToken });
  if (primaryResponse.status === 401 && featureEnabled('OPERATIONS_ADO_PAT_FALLBACK_ENABLED')) {
    primaryResponse = await ado.getWorkItem(incident.workItemId);
    credentialMode = 'PAT_FALLBACK';
  }
  if (!primaryResponse.ok || !primaryResponse.body) {
    const adoMessage = primaryResponse.body && typeof primaryResponse.body === 'object'
      ? String(primaryResponse.body.message || primaryResponse.body.error_description || '').trim()
      : '';
    const diagnostic = [`HTTP ${primaryResponse.status || 502}`, adoMessage].filter(Boolean).join(': ');
    throw operationalError(primaryResponse.status || 502, 'PRIMARY_READ_FAILED', `Primary Work Item could not be read before creating a related ticket (${diagnostic})`);
  }
  const patches = buildCreatePatches(incident, mapping, input, incident.workItemId, adoConfig.org, primaryResponse.body);
  let created = await ado.createWorkItem(mapping.adoProject, mapping.workItemType, patches, credentialMode === 'DELEGATED' ? { accessToken: context.accessToken } : undefined);
  if (created.status === 401 && credentialMode === 'DELEGATED' && featureEnabled('OPERATIONS_ADO_PAT_FALLBACK_ENABLED')) {
    created = await ado.createWorkItem(mapping.adoProject, mapping.workItemType, patches);
    credentialMode = 'PAT_FALLBACK';
  }
  if (!created.ok || !created.body || !created.body.id) {
    const adoMessage = created.body && typeof created.body === 'object'
      ? String(created.body.message || created.body.error_description || '').trim()
      : '';
    const diagnostic = [`HTTP ${created.status || 502}`, adoMessage].filter(Boolean).join(': ');
    throw operationalError(created.status || 502, 'ADO_CREATE_FAILED', `Azure DevOps create failed (${diagnostic})`);
  }
  const normalized = normalizeAdoWorkItem(created.body);
  await sp.createWorkItemRecord({
    Title: normalized.title || `Work item #${normalized.workItemId}`,
    IncidentId: incident.incidentId,
    WorkItemId: normalized.workItemId,
    Role: 'RELATED',
    SupportTeam: normalizeTeam(mapping.supportTeam),
    State: normalized.state,
    IdempotencyKey: idempotencyKey
  });
  await audit(sp, context, {
    incidentId: incident.incidentId,
    workItemId: normalized.workItemId,
    action: 'CREATE_RELATED_WORK_ITEM',
    result: 'SUCCEEDED',
    detail: `${normalizeTeam(mapping.supportTeam)} via mapping ${mapping.mappingId}; credential ${credentialMode}`,
    eventKey: `create:${idempotencyKey}`
  });
  return { incident, workItem: { ...normalized, role: 'RELATED', supportTeam: normalizeTeam(mapping.supportTeam) }, mapping, duplicate: false, credentialMode };
}

async function createRelatedBatch(input, context, dependencies = {}) {
  requireFeature('OPERATIONS_CREATE_ENABLED');
  const teams = [...new Set((input.supportTeams || []).map(normalizeTeam))];
  if (!teams.length) throw operationalError(400, 'SUPPORT_TEAMS_REQUIRED', 'Select at least one support team');
  const requestKey = String(input.idempotencyKey || '').trim();
  if (!requestKey) throw operationalError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'idempotencyKey is required');
  const results = [];
  for (const supportTeam of teams) {
    try {
      const result = await createRelated({
        incidentId: input.incidentId,
        supportTeam,
        title: input.title,
        detail: input.detail,
        idempotencyKey: requestKey
      }, context, dependencies);
      results.push({ supportTeam, ok: true, duplicate: result.duplicate, workItem: result.workItem, mapping: result.mapping });
    } catch (error) {
      results.push({
        supportTeam,
        ok: false,
        error: error.code || 'CREATE_RELATED_FAILED',
        detail: error.message || 'Related Work Item creation failed'
      });
    }
  }
  return {
    incidentId: input.incidentId,
    succeeded: results.filter(item => item.ok).length,
    failed: results.filter(item => !item.ok).length,
    results
  };
}

function profileFields(supportTeam, incident, primaryWorkItem) {
  const team = normalizeTeam(supportTeam);
  if (team === 'APP_SUPPORT') {
    return {
      // Verified against Production Service Form #881049 on 2026-09-25.
      'Custom.RequestType': 'Incident/Issue',
      'Custom.SeverityIncidentIssue': serviceFormSeverity(incident),
      'Custom.Deadline': serviceFormDeadline(incident.firstSeen),
      'Custom.ServicePriority': serviceFormPriority(incident),
      'Custom.Country': 'Thai',
      'Custom.GroupsofSubject': 'อื่น ๆ (Other)',
      'Custom.MonitoringSourceTracker': 'Not Applicable (N/A)',
      'Custom.ActualIncidentTime': incident.firstSeen || null
    };
  }
  const primary = primaryWorkItem?.fields || {};
  const fields = {};
  const cloneFields = [
    'Custom.Environment',
    'Custom.ApprovalStatus',
    'Custom.Permission',
    'Custom.Owner',
    'Custom.ImpactCase',
    'Custom.PriorityCase',
    'Custom.TYPE_ALL',
    'Custom.SUBTYPE',
    // Production's SystemProgram field uses this generated reference name.
    'Custom.41f3ce19-9c22-4dda-95b0-f8d89964dfda',
    'Custom.TypeVSTS'
  ];
  for (const field of cloneFields) if (primary[field] != null) fields[field] = primary[field];
  if (!fields['Custom.Environment'] && incident.environment) fields['Custom.Environment'] = incident.environment;
  return fields;
}

function serviceFormSeverity(incident) {
  const severity = `${incident?.severity || ''} ${incident?.priority || ''}`.toUpperCase();
  if (severity.includes('CRITICAL') || severity.includes('P1')) return 'Severity-2';
  return 'Severity-2';
}

function serviceFormPriority(incident) {
  const severity = `${incident?.severity || ''} ${incident?.priority || ''}`.toUpperCase();
  if (severity.includes('CRITICAL') || severity.includes('P1')) return '2-High';
  return '2-High';
}

function serviceFormDeadline(firstSeen) {
  const source = new Date(firstSeen || Date.now());
  const valid = Number.isFinite(source.getTime()) ? source : new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(valid).map(part => [part.type, part.value]));
  const midnightBangkok = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00+07:00`);
  midnightBangkok.setUTCDate(midnightBangkok.getUTCDate() + 3);
  return midnightBangkok.toISOString();
}

async function linkExisting(input, context, dependencies = {}) {
  requireFeature('OPERATIONS_LINK_ENABLED');
  const sp = dependencies.sharePoint || defaultSharePoint;
  const ado = dependencies.ado || defaultAdo;
  const incident = await requireIncident(sp, input.incidentId);
  if (!incident.workItemId) throw operationalError(409, 'PRIMARY_REQUIRED', 'The incident does not have a primary work item');
  const workItemId = positiveInteger(input.workItemId, 'workItemId');
  if (workItemId === incident.workItemId) throw operationalError(409, 'PRIMARY_DUPLICATE', 'The primary work item is already linked');
  const existingRecords = await sp.listConfiguredWorkItems(1000);
  const duplicate = existingRecords.find(item => item.incidentId.toLowerCase() === incident.incidentId.toLowerCase() && item.workItemId === workItemId);
  if (duplicate) return { incident, workItem: duplicate, duplicate: true };
  const result = await ado.getWorkItem(workItemId, { accessToken: context.accessToken });
  if (!result.ok || !result.body || !result.body.id) throw operationalError(result.status || 404, 'WORK_ITEM_NOT_FOUND', 'Azure DevOps work item could not be read');
  const normalized = normalizeAdoWorkItem(result.body);
  const link = await ado.addRelatedWorkItemLink(workItemId, incident.workItemId, `Related to ${incident.displayId || incident.incidentId} through Operations Hub`, { accessToken: context.accessToken });
  if (!link.ok && link.status !== 409) throw operationalError(link.status || 502, 'ADO_LINK_FAILED', 'Azure DevOps related link could not be created');
  await sp.createWorkItemRecord({
    Title: normalized.title || `Work item #${workItemId}`,
    IncidentId: incident.incidentId,
    WorkItemId: workItemId,
    Role: 'RELATED',
    SupportTeam: normalizeTeam(input.supportTeam),
    State: normalized.state,
    WorkItemUrl: normalized.url,
    AssignedTo: normalized.assignedTo,
    CreatedAt: normalized.createdAt,
    ClosedAt: normalized.closedAt,
    LastSyncedAt: new Date().toISOString(),
    IdempotencyKey: makeIdempotencyKey(incident.incidentId, input.supportTeam, `link-${workItemId}`)
  });
  await audit(sp, context, { incidentId: incident.incidentId, workItemId, action: 'LINK_EXISTING_WORK_ITEM', result: 'SUCCEEDED' });
  return { incident, workItem: { ...normalized, role: 'RELATED', supportTeam: normalizeTeam(input.supportTeam) }, duplicate: false };
}

async function synchronize(input, context, dependencies = {}) {
  requireFeature('OPERATIONS_SYNC_ENABLED');
  return synchronizeWorkItems(input, context, dependencies);
}

async function synchronizeWorkItems(input, context, dependencies = {}) {
  const sp = dependencies.sharePoint || defaultSharePoint;
  const ado = dependencies.ado || defaultAdo;
  const incident = await requireIncident(sp, input.incidentId);
  const results = [];
  for (const item of incident.workItems || []) {
    const response = await ado.getWorkItem(item.workItemId, { accessToken: context.accessToken });
    if (!response.ok || !response.body) {
      results.push({ workItemId: item.workItemId, ok: false, status: response.status });
      continue;
    }
    const current = normalizeAdoWorkItem(response.body);
    const now = new Date().toISOString();
    if (item.role === 'PRIMARY') {
      await sp.updateIncidentRecord(incident.sharePointId, {
        AdoState: current.state,
        AssignedTo: current.assignedTo,
        AdoClosedAt: current.closedAt || null,
        LastSyncedAt: now
      });
    } else if (item.sharePointId) {
      await sp.updateWorkItemRecord(item.sharePointId, {
        State: current.state,
        AssignedTo: current.assignedTo,
        ClosedAt: current.closedAt || null,
        LastSyncedAt: now
      });
    }
    results.push({ ...current, ok: true, role: item.role, supportTeam: item.supportTeam });
  }
  await audit(sp, context, { incidentId: incident.incidentId, action: 'SYNCHRONIZE_WORK_ITEMS', result: results.every(item => item.ok) ? 'SUCCEEDED' : 'PARTIAL', detail: `${results.filter(item => item.ok).length}/${results.length} synchronized` });
  return { incidentId: incident.incidentId, items: results };
}

async function closeIncident(input, context, dependencies = {}) {
  requireFeature('OPERATIONS_CLOSE_ENABLED');
  const sp = dependencies.sharePoint || defaultSharePoint;
  const synchronization = await synchronizeWorkItems(input, context, dependencies);
  const failedItems = synchronization.items.filter(item => !item.ok);
  if (failedItems.length > 0) {
    const detail = `Could not verify the latest state of Work Items: ${failedItems.map(item => `#${item.workItemId}`).join(', ')}`;
    await audit(sp, context, { incidentId: input.incidentId, action: 'INCIDENT_CLOSE_BLOCKED', result: 'BLOCKED', detail });
    throw operationalError(502, 'WORK_ITEM_SYNC_FAILED', detail);
  }
  const incident = await requireIncident(sp, input.incidentId);
  const eligibility = closeEligibility(incident);
  if (!eligibility.allowed) {
    await audit(sp, context, { incidentId: incident.incidentId, action: 'INCIDENT_CLOSE_BLOCKED', result: 'BLOCKED', detail: eligibility.reasons.join('; ') });
    const error = operationalError(409, 'INCIDENT_CLOSE_BLOCKED', 'Incident closure requirements are not complete');
    error.data = eligibility;
    throw error;
  }
  const now = new Date().toISOString();
  await sp.updateIncidentRecord(incident.sharePointId, {
    OperationsStatus: 'CLOSED',
    OperationsClosedBy: context.operationsIdentity.email || context.operationsIdentity.id,
    OperationsClosedAt: now
  });
  await audit(sp, context, { incidentId: incident.incidentId, action: 'INCIDENT_CLOSED', result: 'SUCCEEDED' });
  return { incidentId: incident.incidentId, closed: true, closedAt: now };
}

function closeEligibility(incident) {
  const items = incident && incident.workItems || [];
  const reasons = [];
  const primary = items.find(item => item.role === 'PRIMARY');
  if (!primary) reasons.push('Primary work item is missing');
  const blockingItems = items.filter(item => !defaultWorkItems.isClosedState(item.state));
  const blockingWorkItems = blockingItems.map(item => item.workItemId);
  for (const item of blockingItems) reasons.push(`${item.supportTeam || item.role || 'Work item'} #${item.workItemId} is ${item.state || 'not closed'}`);
  if (String(incident?.status || '').toUpperCase() !== 'RESOLVED') reasons.push('Monitoring alert is not RESOLVED');
  return {
    allowed: reasons.length === 0,
    readinessStatus: reasons.length === 0 ? 'READY_TO_CLOSE' : readinessStatus(items),
    blockingWorkItems,
    reasons
  };
}

function readinessStatus(items) {
  const openTeams = (items || []).filter(item => !defaultWorkItems.isClosedState(item.state)).map(item => normalizeReadinessTeam(item.supportTeam || item.role));
  if (openTeams.includes('APP_SUPPORT')) return 'WAITING_FOR_APP_SUPPORT';
  if (openTeams.includes('TIER2')) return 'WAITING_FOR_TIER2';
  if (openTeams.includes('TIER1') || openTeams.includes('PRIMARY')) return 'TIER1_INVESTIGATING';
  return 'WAITING_FOR_ALERT_RESOLUTION';
}

function normalizeReadinessTeam(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

async function requireIncident(sp, incidentId) {
  const incident = await sp.getIncident(String(incidentId || ''));
  if (!incident) throw operationalError(404, 'INCIDENT_NOT_FOUND', 'Incident not found');
  return incident;
}

async function audit(sp, context, event) {
  const now = new Date().toISOString();
  const operations = context.operationsIdentity || {};
  const ado = context.adoIdentity || {};
  return sp.appendAudit({
    Title: event.action,
    EventId: crypto.randomUUID(),
    EventKey: event.eventKey || `${event.action}:${event.incidentId}:${event.workItemId || ''}:${now}`,
    CorrelationId: context.correlationId || '',
    IncidentId: event.incidentId,
    WorkItemId: event.workItemId || null,
    Action: event.action,
    Result: event.result,
    OperationsUserId: operations.id || '',
    OperationsUserName: operations.name || '',
    OperationsUserEmail: operations.email || '',
    AdoIdentityId: ado.id || '',
    AdoIdentityName: ado.displayName || '',
    AdoIdentityEmail: ado.email || '',
    Detail: String(event.detail || '').slice(0, 4000),
    OccurredAt: now
  });
}

function normalizeAdoWorkItem(item) {
  const fields = item && item.fields || {};
  const assigned = fields['System.AssignedTo'];
  return {
    workItemId: Number(item.id),
    title: String(fields['System.Title'] || ''),
    state: String(fields['System.State'] || ''),
    assignedTo: typeof assigned === 'object' ? String(assigned.displayName || assigned.uniqueName || '') : String(assigned || ''),
    url: item._links && item._links.html && item._links.html.href || '',
    createdAt: String(fields['System.CreatedDate'] || ''),
    closedAt: String(fields['Microsoft.VSTS.Common.ClosedDate'] || fields['System.ClosedDate'] || '')
  };
}

function makeIdempotencyKey(incidentId, supportTeam, requestKey) {
  if (!requestKey) throw operationalError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'idempotencyKey is required');
  return crypto.createHash('sha256').update([incidentId, normalizeTeam(supportTeam), requestKey].join('|')).digest('hex');
}

function normalizeTeam(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!['APP_SUPPORT', 'TIER2'].includes(normalized)) throw operationalError(400, 'INVALID_SUPPORT_TEAM', 'supportTeam must be APP_SUPPORT or TIER2');
  return normalized;
}

function normalizeOptionalTeam(value) {
  const team = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return team === 'APP_SUPPORT' || team === 'TIER2' ? team : '';
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw operationalError(400, 'INVALID_INPUT', `${name} must be a positive integer`);
  return parsed;
}

function patch(path, value) { return { op: 'add', path, value }; }
function normalize(value) { return String(value || '').trim().toLowerCase(); }
function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
function formatBangkokTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute} น.`;
}
function operationalError(status, code, message) { const error = new Error(message); error.status = status; error.code = code; return error; }

module.exports = {
  audit,
  buildCreatePatches,
  closeEligibility,
  closeIncident,
  createRelated,
  createRelatedBatch,
  featureEnabled,
  linkExisting,
  makeIdempotencyKey,
  normalizeAdoWorkItem,
  resolveMapping,
  synchronize
};
