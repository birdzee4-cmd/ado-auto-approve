const { TableClient } = require('@azure/data-tables');

let cachedClient;
let cachedIndexClient;

function config() {
  const connectionString = process.env.ADO_DEPLOYMENT_EVENT_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
  if (!connectionString) throw new Error('Missing ADO_DEPLOYMENT_EVENT_STORAGE_CONNECTION_STRING or AzureWebJobsStorage');
  return {
    connectionString,
    tableName: process.env.ADO_DEPLOYMENT_EVENT_TABLE || 'AdoDeploymentEvents'
  };
}

function indexConfig() {
  const connectionString = process.env.ADO_DEPLOYMENT_EVENT_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
  if (!connectionString) throw new Error('Missing deployment event storage connection string');
  return { connectionString, tableName: process.env.ADO_DEPLOYMENT_EVENT_INDEX_TABLE || 'AdoDeploymentEventIndex' };
}

function client() {
  if (!cachedClient) {
    const cfg = config();
    cachedClient = TableClient.fromConnectionString(cfg.connectionString, cfg.tableName);
  }
  return cachedClient;
}

function indexClient() {
  if (!cachedIndexClient) {
    const cfg = indexConfig();
    cachedIndexClient = TableClient.fromConnectionString(cfg.connectionString, cfg.tableName);
  }
  return cachedIndexClient;
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
  if (process.env.ADO_DEPLOYMENT_EVENT_INDEX_ENABLED === 'true') {
    const timestamp = Date.parse(event.eventCreatedAt || entity.receivedAt || '') || Date.now();
    const reverseTicks = String(9999999999999999999 - timestamp).padStart(20, '0');
    const indexEntity = Object.assign({}, entity, {
      partitionKey: new Date(timestamp).toISOString().slice(0, 7),
      rowKey: `${reverseTicks}_${safeKey(event.eventId)}`
    });
    await indexClient().createTable().catch(error => {
      if (error.statusCode !== 409 && error.code !== 'TableAlreadyExists') throw error;
    });
    await indexClient().upsertEntity(indexEntity, 'Merge');
  }
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
  for (const field of ['environmentGroup', 'sourceType', 'result']) {
    const value = options && options[field] ? String(options[field]).replace(/'/g, "''") : '';
    if (value) clauses.push(`${field} eq '${value}'`);
  }
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

async function listIndexedPage(options) {
  const pageSize = Math.min(Math.max(Number(options && (options.pageSize || options.limit)) || 50, 1), 200);
  if (process.env.ADO_DEPLOYMENT_EVENT_INDEX_ENABLED !== 'true') return { items: [], nextCursor: '', enabled: false };
  const queryOptions = {};
  const iterator = indexClient().listEntities(queryOptions).byPage({ continuationToken: options && options.cursor, maxPageSize: pageSize });
  const page = (await iterator.next()).value || [];
  const items = page.map(entity => {
    const item = Object.assign({}, entity);
    delete item.partitionKey; delete item.rowKey; delete item.etag;
    return item;
  });
  return { items, nextCursor: page.continuationToken || '', enabled: true };
}

function resetForTests() {
  cachedClient = undefined;
  cachedIndexClient = undefined;
}

module.exports = { save, list, listIndexedPage, resetForTests };

