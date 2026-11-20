const { TableClient } = require('@azure/data-tables');

// Azure Table is an additive read model. SharePoint remains the system of
// record; this module must never be required by a write path unless the
// feature flag is explicitly enabled.
let client;
let stateClient;

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

function stateTable() {
  if (!stateClient) {
    const cfg = config();
    stateClient = TableClient.fromConnectionString(cfg.connectionString, process.env.OPERATIONS_INCIDENT_SYNC_STATE_TABLE || 'OperationsIncidentSyncState');
  }
  return stateClient;
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
  await stateTable().createTable();
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
  const limit = Math.max(1, Math.min(Number(options.limit) || 200, 10000));
  // Azure Table does not guarantee entity enumeration order. Do not stop the
  // scan at `limit`, otherwise an arbitrary subset can hide newer incidents.
  // The read model is intentionally bounded, then sorted client-side.
  const scanLimit = Math.max(limit, Math.min(Number(options.scanLimit) || 10000, 10000));
  const filter = options.partitionKey ? `PartitionKey eq '${String(options.partitionKey).replace(/'/g, "''")}'` : '';
  const result = [];
  for await (const entity of table().listEntities({ queryOptions: filter ? { filter } : undefined })) {
    result.push(fromEntity(entity));
    if (result.length >= scanLimit) break;
  }
  return result
    .sort((a, b) => {
      const byDate = (Date.parse(b.firstSeen || '') || 0) - (Date.parse(a.firstSeen || '') || 0);
      return byDate || String(b.incidentId || b.displayId || '').localeCompare(String(a.incidentId || a.displayId || ''), undefined, { numeric: true });
    })
    .slice(0, limit);
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

async function syncPageFromSharePoint(sharePoint, pageSize = 100, cursor = '') {
  await ensureTable();
  const state = await getSyncState();
  const size = Math.max(1, Math.min(Number(pageSize) || 100, 100));
  // Always refresh the newest page first. A single long-running cursor walk
  // can otherwise spend hours in history and hide newly-created incidents.
  const head = await sharePoint.listIncidentPage(size, '');
  let written = await upsertMany(head.items);
  let backfill = null;
  const effectiveCursor = cursor || state.cursor || '';
  if (effectiveCursor) {
    backfill = await sharePoint.listIncidentPage(size, effectiveCursor);
    written += await upsertMany(backfill.items);
  }
  const nextCursor = backfill ? (backfill.nextCursor || '') : (effectiveCursor || head.nextCursor || '');
  await setSyncState(nextCursor);
  return {
    read: head.items.length + (backfill ? backfill.items.length : 0),
    written,
    nextCursor,
    hasMore: Boolean(nextCursor),
    source: 'sharepoint',
    table: config().tableName,
    refreshedHead: true,
    resumed: Boolean(effectiveCursor)
  };
}

async function getSyncState() {
  try { return await stateTable().getEntity('incidents', 'primary'); } catch (error) {
    if (error.statusCode === 404) return { cursor: '' };
    throw error;
  }
}

async function setSyncState(cursor) {
  await stateTable().upsertEntity({ partitionKey: 'incidents', rowKey: 'primary', cursor: String(cursor || ''), updatedAt: new Date().toISOString() }, 'Merge');
}

module.exports = { enabled, ensureTable, upsert, upsertMany, list, get, syncFromSharePoint, syncPageFromSharePoint, toEntity, fromEntity };
