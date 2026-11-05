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

function indexPartition(timestamp) {
  const date = new Date(timestamp);
  return `${String(9999 - date.getUTCFullYear()).padStart(4, '0')}${String(12 - date.getUTCMonth()).padStart(2, '0')}`;
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
      partitionKey: indexPartition(timestamp),
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

async function listAll(options) {
  const clauses = [];
  for (const field of ['environmentGroup', 'sourceType', 'result']) {
    const value = options && options[field] ? String(options[field]).replace(/'/g, "''") : '';
    if (value) clauses.push(`${field} eq '${value}'`);
  }
  const from = options && options.from ? new Date(options.from) : null;
  const to = options && options.to ? new Date(options.to) : null;
  if (from && !Number.isNaN(from.getTime())) clauses.push(`eventCreatedAt ge '${from.toISOString()}'`);
  if (to && !Number.isNaN(to.getTime())) clauses.push(`eventCreatedAt lt '${to.toISOString()}'`);
  const queryOptions = clauses.length ? { queryOptions: { filter: clauses.join(' and ') } } : {};
  const items = [];
  for await (const entity of client().listEntities(queryOptions)) {
    const item = Object.assign({}, entity);
    delete item.partitionKey; delete item.rowKey; delete item.etag;
    items.push(item);
  }
  return items;
}

async function summarize(options) {
  const items = await listAll(options);
  const summary = {
    total: items.length, succeeded: 0, failed: 0, canceled: 0, unknown: 0,
    successRate: 0, failureRate: 0, byEnvironment: {}, bySource: {}, byResult: {},
    byDay: {}, byPipeline: {}, openFailures: [], averageDurationSeconds: null
  };
  const successRuns = new Set();
  let durationTotal = 0; let durationCount = 0;
  for (const item of items) {
    const result = String(item.result || 'unknown').toLowerCase() || 'unknown';
    summary.byResult[result] = (summary.byResult[result] || 0) + 1;
    if (result === 'succeeded') summary.succeeded += 1;
    else if (result === 'failed') summary.failed += 1;
    else if (result === 'canceled' || result === 'cancelled') summary.canceled += 1;
    else summary.unknown += 1;
    const env = item.environmentGroup || 'Other';
    const source = item.sourceType || 'other';
    const pipeline = item.pipelineName || 'Unknown';
    summary.byEnvironment[env] = (summary.byEnvironment[env] || 0) + 1;
    summary.bySource[source] = (summary.bySource[source] || 0) + 1;
    summary.byPipeline[pipeline] = (summary.byPipeline[pipeline] || 0) + 1;
    const day = String(item.eventCreatedAt || item.receivedAt || '').slice(0, 10);
    if (day) summary.byDay[day] = (summary.byDay[day] || 0) + 1;
    const started = Date.parse(item.startedAt || ''); const completed = Date.parse(item.completedAt || '');
    if (started && completed && completed >= started) { durationTotal += completed - started; durationCount += 1; }
    if (result === 'succeeded' && item.pullRequestId) successRuns.add(String(item.pullRequestId));
  }
  summary.successRate = summary.total ? Number((summary.succeeded / summary.total * 100).toFixed(2)) : 0;
  summary.failureRate = summary.total ? Number((summary.failed / summary.total * 100).toFixed(2)) : 0;
  summary.averageDurationSeconds = durationCount ? Math.round(durationTotal / durationCount / 1000) : null;
  summary.openFailures = items.filter(item => String(item.result || '').toLowerCase() === 'failed' && item.pullRequestId && !successRuns.has(String(item.pullRequestId))).slice(0, 100);
  return summary;
}

async function listIndexedPage(options) {
  const pageSize = Math.min(Math.max(Number(options && (options.pageSize || options.limit)) || 50, 1), 200);
  if (process.env.ADO_DEPLOYMENT_EVENT_INDEX_ENABLED !== 'true') return { items: [], nextCursor: '', enabled: false };
  const clauses = [];
  for (const field of ['environmentGroup', 'sourceType', 'result']) {
    const value = options && options[field] ? String(options[field]).replace(/'/g, "''") : '';
    if (value) clauses.push(`${field} eq '${value}'`);
  }
  const from = options && options.from ? new Date(options.from) : null;
  const to = options && options.to ? new Date(options.to) : null;
  if (from && !Number.isNaN(from.getTime())) clauses.push(`eventCreatedAt ge '${from.toISOString()}'`);
  if (to && !Number.isNaN(to.getTime())) clauses.push(`eventCreatedAt lt '${to.toISOString()}'`);
  const queryOptions = clauses.length ? { queryOptions: { filter: clauses.join(' and ') } } : {};
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

module.exports = { save, list, listIndexedPage, summarize, resetForTests };

