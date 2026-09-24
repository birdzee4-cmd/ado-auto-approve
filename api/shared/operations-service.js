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
  const missing = ['adoProject', 'workItemType', 'areaPath', 'assignedTeam'].filter(field => !mapping[field]);
  if (missing.length) throw operationalError(422, 'MAPPING_INCOMPLETE', 'Mapping is missing: ' + missing.join(', '));
  return mapping;
}

function buildCreatePatches(incident, mapping, input, primaryWorkItemId, organization) {
  const title = String(input.title || `[${incident.displayId || incident.incidentId}] ${incident.alertName || incident.service}`).trim().slice(0, 255);
  const description = [
    `<p><strong>Operations Hub Incident:</strong> ${escapeHtml(incident.displayId || incident.incidentId)}</p>`,
    `<p><strong>Service:</strong> ${escapeHtml(incident.service || incident.resource || '-')}</p>`,
    `<p><strong>Alert:</strong> ${escapeHtml(incident.alertName || '-')}</p>`,
    input.detail ? `<p><strong>Tier 1 detail:</strong><br>${escapeHtml(input.detail).replace(/\n/g, '<br>')}</p>` : ''
  ].filter(Boolean).join('');
  const tags = ['OperationsHub', incident.displayId || incident.incidentId, mapping.defaultTags]
    .filter(Boolean).join('; ');
  const patches = [
    patch('/fields/System.Title', title),
    patch('/fields/System.Description', description),
    patch('/fields/System.AreaPath', mapping.areaPath),
    patch('/fields/System.AssignedTo', mapping.assignedTeam),
    patch('/fields/System.Tags', tags)
  ];
  if (mapping.iterationPath) patches.push(patch('/fields/System.IterationPath', mapping.iterationPath));
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
  const patches = buildCreatePatches(incident, mapping, input, incident.workItemId, adoConfig.org);
  const created = await ado.createWorkItem(mapping.adoProject, mapping.workItemType, patches, { accessToken: context.accessToken });
  if (!created.ok || !created.body || !created.body.id) {
    throw operationalError(created.status || 502, 'ADO_CREATE_FAILED', `Azure DevOps create failed (HTTP ${created.status || 502})`);
  }
  const normalized = normalizeAdoWorkItem(created.body);
  await sp.createWorkItemRecord({
    Title: normalized.title || `Work item #${normalized.workItemId}`,
    IncidentId: incident.incidentId,
    WorkItemId: normalized.workItemId,
    Role: 'RELATED',
    SupportTeam: normalizeTeam(mapping.supportTeam),
    State: normalized.state,
    WorkItemUrl: normalized.url,
    AssignedTo: normalized.assignedTo,
    CreatedAt: normalized.createdAt || new Date().toISOString(),
    LastSyncedAt: new Date().toISOString(),
    IdempotencyKey: idempotencyKey
  });
  await audit(sp, context, {
    incidentId: incident.incidentId,
    workItemId: normalized.workItemId,
    action: 'CREATE_RELATED_WORK_ITEM',
    result: 'SUCCEEDED',
    detail: `${normalizeTeam(mapping.supportTeam)} via mapping ${mapping.mappingId}`,
    eventKey: `create:${idempotencyKey}`
  });
  return { incident, workItem: { ...normalized, role: 'RELATED', supportTeam: normalizeTeam(mapping.supportTeam) }, mapping, duplicate: false };
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

async function confirmRecovery(input, context, dependencies = {}) {
  requireFeature('OPERATIONS_CLOSE_ENABLED');
  const sp = dependencies.sharePoint || defaultSharePoint;
  const incident = await requireIncident(sp, input.incidentId);
  const now = new Date().toISOString();
  await sp.updateIncidentRecord(incident.sharePointId, {
    RecoveryConfirmed: true,
    RecoveryConfirmedBy: context.operationsIdentity.email || context.operationsIdentity.id,
    RecoveryConfirmedAt: now,
    OperationsStatus: 'RECOVERED'
  });
  await audit(sp, context, { incidentId: incident.incidentId, action: 'RECOVERY_CONFIRMED', result: 'SUCCEEDED', detail: String(input.comment || '').slice(0, 2000) });
  return { incidentId: incident.incidentId, recoveryConfirmed: true, recoveryConfirmedAt: now };
}

async function closeIncident(input, context, dependencies = {}) {
  requireFeature('OPERATIONS_CLOSE_ENABLED');
  const sp = dependencies.sharePoint || defaultSharePoint;
  await synchronize(input, context, dependencies);
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
  const blockingWorkItems = items.filter(item => !defaultWorkItems.isClosedState(item.state)).map(item => item.workItemId);
  if (blockingWorkItems.length) reasons.push('All work items must be closed');
  if (!incident || !incident.recoveryConfirmed) reasons.push('Tier 1 recovery confirmation is required');
  return { allowed: reasons.length === 0, blockingWorkItems, reasons };
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

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw operationalError(400, 'INVALID_INPUT', `${name} must be a positive integer`);
  return parsed;
}

function patch(path, value) { return { op: 'add', path, value }; }
function normalize(value) { return String(value || '').trim().toLowerCase(); }
function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
function operationalError(status, code, message) { const error = new Error(message); error.status = status; error.code = code; return error; }

module.exports = {
  audit,
  buildCreatePatches,
  closeEligibility,
  closeIncident,
  confirmRecovery,
  createRelated,
  featureEnabled,
  linkExisting,
  makeIdempotencyKey,
  normalizeAdoWorkItem,
  resolveMapping,
  synchronize
};
