const { TableClient } = require('@azure/data-tables');
const { createHash } = require('node:crypto');
function store() {
  const connection = process.env.COMPANY_MONITOR_STORAGE_CONNECTION_STRING || process.env.ADO_DEPLOYMENT_EVENT_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
  if (!connection) throw new Error('Missing company monitor storage configuration');
  const table = TableClient.fromConnectionString(connection, process.env.COMPANY_MONITOR_ARCHIVE_TABLE || 'CompanyDeploymentArchive');
  return table;
}
function key(day, buildId) { return createHash('sha256').update(`${day}|${buildId}`).digest('hex'); }
async function read(day) {
  const result = {};
  for await (const entity of store().listEntities({ queryOptions: { filter: `PartitionKey eq 'overrides-${day}'` } })) result[entity.buildId] = { buildId: entity.buildId, status: entity.status, confirmedAt: entity.confirmedAt, confirmedBy: entity.confirmedBy };
  return result;
}
async function set(day, buildId, principal) {
  const table = store(); await table.createTable().catch(error => { if (error.statusCode !== 409) throw error; });
  const entity = { partitionKey: `overrides-${day}`, rowKey: key(day, buildId), buildId, status: 'manually-resolved', confirmedAt: new Date().toISOString(), confirmedBy: String(principal?.userDetails || principal?.userId || 'Authorized User') };
  await table.upsertEntity(entity, 'Replace'); return entity;
}
module.exports = { read, set };
