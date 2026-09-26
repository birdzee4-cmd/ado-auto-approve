const CLOSED_STATES = new Set(['CLOSED', 'DONE', 'REMOVED', 'RESOLVED', 'REJECT', 'REJECTED']);

function primaryWorkItemFromIncident(incident) {
  if (!incident || !Number.isSafeInteger(incident.workItemId) || incident.workItemId <= 0) return null;
  return {
    workItemId: incident.workItemId,
    incidentId: incident.incidentId || '',
    role: 'PRIMARY',
    supportTeam: 'TIER1',
    state: incident.adoState || '',
    assignedTo: incident.assignedTo || '',
    url: incident.workItemUrl || '',
    createdAt: incident.adoCreatedAt || '',
    closedAt: incident.adoClosedAt || '',
    lastSyncedAt: incident.lastSyncedAt || '',
    source: 'EXISTING_INCIDENT'
  };
}

function mapSharePointWorkItem(item, helpers = {}) {
  const fields = item && item.fields || {};
  const text = helpers.textField || textField;
  const date = helpers.dateField || dateField;
  const safeUrl = helpers.safeAdoUrl || (() => '');
  const idValue = text(fields, ['WorkItemId', 'AdoWorkItemId', 'ADOWorkItemId', 'field_2']);
  const workItemId = /^\d+$/.test(idValue) ? Number(idValue) : undefined;
  if (!workItemId) return null;

  return {
    sharePointId: numericId(item && item.id),
    workItemId,
    incidentId: text(fields, ['IncidentId', 'CorrelationId', 'field_1']),
    role: normalizeRole(text(fields, ['Role', 'WorkItemRole', 'field_3'])),
    supportTeam: normalizeSupportTeam(text(fields, ['SupportTeam', 'Team', 'field_4'])),
    state: text(fields, ['State', 'AdoState', 'WorkItemState', 'field_5']),
    assignedTo: text(fields, ['AssignedTo', 'field_7']),
    url: safeUrl(text(fields, ['URL', 'Url', 'WorkItemUrl', 'AdoWorkItemUrl', 'field_6'])),
    createdAt: date(fields, ['CreatedAt', 'AdoCreatedAt', 'field_8']) || isoDate(item && item.createdDateTime),
    closedAt: date(fields, ['ClosedAt', 'AdoClosedAt', 'field_9']),
    lastSyncedAt: date(fields, ['LastSyncedAt', 'field_10']) || isoDate(item && item.lastModifiedDateTime),
    idempotencyKey: text(fields, ['IdempotencyKey', 'field_11']),
    source: 'OPERATIONS_HUB_WORK_ITEMS'
  };
}

function attachWorkItems(incidents, storedWorkItems) {
  const byIncident = new Map();
  for (const workItem of storedWorkItems || []) {
    if (!workItem || !workItem.incidentId || !workItem.workItemId) continue;
    const key = workItem.incidentId.toLowerCase();
    if (!byIncident.has(key)) byIncident.set(key, []);
    byIncident.get(key).push(workItem);
  }

  return (incidents || []).map(incident => {
    const primary = primaryWorkItemFromIncident(incident);
    const candidates = [primary, ...(byIncident.get(String(incident.incidentId || '').toLowerCase()) || [])]
      .filter(Boolean);
    const workItems = deduplicateWorkItems(candidates, primary && primary.workItemId);
    const summary = summarizeWorkItems(workItems);
    return {
      ...incident,
      workItems,
      workItemSummary: summary,
      trackingStatus: aggregateTrackingStatus(incident.trackingStatus, workItems)
    };
  });
}

function deduplicateWorkItems(items, primaryWorkItemId) {
  const byId = new Map();
  for (const item of items) {
    const existing = byId.get(item.workItemId);
    const merged = existing ? { ...existing, ...removeEmpty(item) } : { ...item };
    if (item.workItemId === primaryWorkItemId) {
      merged.role = 'PRIMARY';
      merged.supportTeam = 'TIER1';
      merged.source = 'EXISTING_INCIDENT';
    }
    byId.set(item.workItemId, merged);
  }
  return [...byId.values()].sort((left, right) => {
    if (left.role !== right.role) return left.role === 'PRIMARY' ? -1 : 1;
    return left.workItemId - right.workItemId;
  });
}

function summarizeWorkItems(items) {
  const total = items.length;
  const closed = items.filter(item => isClosedState(item.state)).length;
  return { total, closed, open: total - closed };
}

function aggregateTrackingStatus(existingStatus, items) {
  if (['FAILED', 'CANCELLED', 'PENDING'].includes(existingStatus)) return existingStatus;
  if (!items.length) return existingStatus;
  if (items.some(item => !isClosedState(item.state))) return 'OPEN';
  return 'CLOSED';
}

function isClosedState(state) {
  return CLOSED_STATES.has(String(state || '').trim().toUpperCase());
}

function normalizeRole(value) {
  return String(value || '').trim().toUpperCase() === 'PRIMARY' ? 'PRIMARY' : 'RELATED';
}

function normalizeSupportTeam(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const aliases = {
    TIER1: 'TIER1',
    IT_SUPPORT_TIER1: 'TIER1',
    APP_SUPPORT: 'APP_SUPPORT',
    APPLICATION_SUPPORT: 'APP_SUPPORT',
    TIER2: 'TIER2',
    IT_SUPPORT_TIER2: 'TIER2',
    CLOUD_OPS: 'TIER2',
    TIER2_CLOUD_OPS: 'TIER2'
  };
  return aliases[normalized];
}

function removeEmpty(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== '' && item != null));
}

function numericId(value) {
  const normalized = String(value == null ? '' : value).trim();
  return /^\d+$/.test(normalized) ? Number(normalized) : undefined;
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
  return isoDate(textField(fields, names));
}

function isoDate(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

module.exports = {
  aggregateTrackingStatus,
  attachWorkItems,
  isClosedState,
  mapSharePointWorkItem,
  normalizeRole,
  normalizeSupportTeam,
  primaryWorkItemFromIncident,
  summarizeWorkItems
};
