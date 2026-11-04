const { TableClient } = require('@azure/data-tables');

const apply = process.argv.includes('--apply');
const connectionString = process.env.ADO_DEPLOYMENT_EVENT_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
const sourceTable = process.env.ADO_DEPLOYMENT_EVENT_TABLE || 'AdoDeploymentEvents';
const indexTable = process.env.ADO_DEPLOYMENT_EVENT_INDEX_TABLE || 'AdoDeploymentEventIndex';

if (!connectionString) throw new Error('Set ADO_DEPLOYMENT_EVENT_STORAGE_CONNECTION_STRING or AzureWebJobsStorage');

function safeKey(value) {
  return String(value || 'unknown').replace(/[\\/#?\u0000-\u001f\u007f-\u009f]/g, '_').slice(0, 512);
}
function indexPartition(timestamp) {
  const date = new Date(timestamp);
  return `${String(9999 - date.getUTCFullYear()).padStart(4, '0')}${String(12 - date.getUTCMonth()).padStart(2, '0')}`;
}

async function main() {
  const source = TableClient.fromConnectionString(connectionString, sourceTable);
  const index = TableClient.fromConnectionString(connectionString, indexTable);
  if (apply) await index.createTable().catch(error => { if (error.statusCode !== 409 && error.code !== 'TableAlreadyExists') throw error; });
  let scanned = 0;
  let written = 0;
  for await (const entity of source.listEntities()) {
    scanned += 1;
    const timestamp = Date.parse(entity.eventCreatedAt || entity.receivedAt || '');
    if (!Number.isFinite(timestamp)) continue;
    const reverseTicks = String(9999999999999999999 - timestamp).padStart(20, '0');
    const indexed = Object.assign({}, entity, {
      partitionKey: indexPartition(timestamp),
      rowKey: `${reverseTicks}_${safeKey(entity.eventId || entity.rowKey)}`
    });
    delete indexed.etag;
    if (apply) {
      await index.upsertEntity(indexed, 'Merge');
      written += 1;
    }
  }
  console.log(JSON.stringify({ apply, sourceTable, indexTable, scanned, written }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
