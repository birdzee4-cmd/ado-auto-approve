const { TableClient } = require('@azure/data-tables');

// Azure Table is an additive read model. SharePoint remains the system of
// record; this module must never be required by a write path unless the
// feature flag is explicitly enabled.
let client;

function config() {
  const connectionString = process.env.OPERATIONS_INCIDENT_TABLE_CONNECTION_STRING ||
    process.env.AzureWebJobsStorage || process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) throw new Error('Missing Operations incident table storage connection string');
  return {
    connectionString,
    tableName: process.env.OPERATIONS_INCIDENT_TABLE_NAME || 'OperationsIncidentReadModel'
  };
}

function enabled() {
  return String(process.env.OPERATIONS_INCIDENT_READ_MODEL_ENABLED || '').toLowerCase() === 'true';
}

function table() {
  if (!client) {
    const cfg = config();
    client = TableClient.fromConnectionString(cfg.connectionString, cfg.tableName);
  }
  return client;
}

function partitionKey(incident) {
  const date = Date.parse(incident.firstSeen || incident.createdAt || incident.lastSyncedAt || '');
  return Number.isFinite(date) ? new Date(date).getUTCFullYear().toString() : 'unknown';
}

function rowKey(incident) {
  return String(incident.incidentId || incident.displayId || '').trim().replace(/[\\/#?]/g, '_');
}

function toEntity(incident) {
  const key = rowKey(incident);
  if (!key) throw new Error('Incident read model requires incidentId');
  const entity = {
    partitionKey: partitionKey(incident),
    rowKey: key,
    incidentId: String(incident.incidentId || ''),
    displayId: String(incident.displayId || ''),
    alertName: String(incident.alertName || ''),
    resource: String(incident.resource || ''),
    status: String(incident.status || ''),
    workflowStatus: String(incident.workflowStatus || ''),
    operationsStatus: String(incident.operationsStatus || ''),
    adoState: String(incident.adoState || ''),
    queue: String(incident.queue || ''),
    assignedTo: String(incident.assignedTo || ''),
    firstSeen: String(incident.firstSeen || ''),
    resolvedAt: String(incident.resolvedAt || ''),
    receivedAt: String(incident.receivedAt || ''),
    lastSyncedAt: String(incident.lastSyncedAt || ''),
    sharePointId: Number(incident.sharePointId) || 0,
    workItemId: Number(incident.workItemId) || 0,
    payloadJson: JSON.stringify(incident)
  };
  return entity;
}

function fromEntity(entity) {
  if (entity.payloadJson) {
    try { return JSON.parse(entity.payloadJson); } catch (_) {}
  }
  return {
    incidentId: entity.incidentId,
    displayId: entity.displayId,
    alertName: entity.alertName,
    resource: entity.resource,
    status: entity.status,
    workflowStatus: entity.workflowStatus,
    operationsStatus: entity.operationsStatus,
    adoState: entity.adoState,
    queue: entity.queue,
    assignedTo: entity.assignedTo,
    firstSeen: entity.firstSeen,
    resolvedAt: entity.resolvedAt,
    receivedAt: entity.receivedAt,
    lastSyncedAt: entity.lastSyncedAt,
    sharePointId: entity.sharePointId || undefined,
    workItemId: entity.workItemId || undefined
  };
}

async function ensureTable() {
  await table().createTable();
}

async function upsert(incident) {
  await table().upsertEntity(toEntity(incident), 'Merge');
}

async function upsertMany(incidents) {
  const items = Array.isArray(incidents) ? incidents : [];
  for (let index = 0; index < items.length; index += 100) {
    await Promise.all(items.slice(index, index + 100).map(upsert));
  }
  return items.length;
}

async function list(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 200, 1000));
  const filter = options.partitionKey ? `PartitionKey eq '${String(options.partitionKey).replace(/'/g, "''")}'` : '';
  const result = [];
  for await (const entity of table().listEntities({ queryOptions: filter ? { filter } : undefined })) {
    result.push(fromEntity(entity));
    if (result.length >= limit) break;
  }
  return result.sort((a, b) => (Date.parse(b.firstSeen || '') || 0) - (Date.parse(a.firstSeen || '') || 0));
}

async function get(incidentId) {
  const id = String(incidentId || '').trim();
  if (!id) return null;
  for await (const entity of table().listEntities({ queryOptions: { filter: `incidentId eq '${id.replace(/'/g, "''")}'` } })) return fromEntity(entity);
  return null;
}

async function syncFromSharePoint(sharePoint, maxItems = 5000) {
  await ensureTable();
  const incidents = await sharePoint.listIncidentRows(Math.max(1, Math.min(Number(maxItems) || 5000, 5000)));
  const written = await upsertMany(incidents);
  return { read: incidents.length, written, source: 'sharepoint', table: config().tableName };
}

module.exports = { enabled, ensureTable, upsert, upsertMany, list, get, syncFromSharePoint, toEntity, fromEntity };
