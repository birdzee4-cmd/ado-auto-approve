const { TableClient } = require('@azure/data-tables');

let cachedClient;

function config() {
  const connectionString = process.env.ADO_DEPLOYMENT_EVENT_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
  if (!connectionString) throw new Error('Missing ADO_DEPLOYMENT_EVENT_STORAGE_CONNECTION_STRING or AzureWebJobsStorage');
  return {
    connectionString,
    tableName: process.env.ADO_DEPLOYMENT_EVENT_TABLE || 'AdoDeploymentEvents'
  };
}

function client() {
  if (!cachedClient) {
    const cfg = config();
    cachedClient = TableClient.fromConnectionString(cfg.connectionString, cfg.tableName);
  }
  return cachedClient;
}

function safeKey(value) {
  return String(value || 'unknown').replace(/[\\/#?\u0000-\u001f\u007f-\u009f]/g, '_').slice(0, 512);
}

async function save(event) {
  const entity = Object.assign({}, event, {
    partitionKey: safeKey(event.projectId || event.projectName || 'unknown-project'),
    rowKey: safeKey(event.eventId),
    receivedAt: new Date().toISOString()
  });
  await client().upsertEntity(entity, 'Merge');
  return entity;
}

async function list(options) {
  const limit = Math.min(Math.max(Number(options && options.limit) || 100, 1), 2000);
  const projectId = options && options.projectId ? safeKey(options.projectId) : '';
  const clauses = [];
  if (projectId) clauses.push(`PartitionKey eq '${projectId.replace(/'/g, "''")}'`);
  const from = options && options.from ? new Date(options.from) : null;
  const to = options && options.to ? new Date(options.to) : null;
  if (from && !Number.isNaN(from.getTime())) clauses.push(`eventCreatedAt ge '${from.toISOString()}'`);
  if (to && !Number.isNaN(to.getTime())) clauses.push(`eventCreatedAt lt '${to.toISOString()}'`);
  const queryOptions = clauses.length ? { queryOptions: { filter: clauses.join(' and ') } } : {};
  const items = [];
  for await (const entity of client().listEntities(queryOptions)) {
    const item = Object.assign({}, entity);
    delete item.partitionKey;
    delete item.rowKey;
    delete item.etag;
    items.push(item);
  }
  items.sort((a, b) => String(b.eventCreatedAt || b.receivedAt).localeCompare(String(a.eventCreatedAt || a.receivedAt)));
  return items.slice(0, limit);
}

function resetForTests() {
  cachedClient = undefined;
}

module.exports = { save, list, resetForTests };

