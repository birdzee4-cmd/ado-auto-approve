const crypto = require('crypto');
const { TableClient } = require('@azure/data-tables');

const SYSTEM_INCIDENT_ID = '__OPERATIONS_HUB_GLOBAL__';
const AUTO_RESTART_ACTION = 'GLOBAL_AUTO_RESTART_CONFIG';
let cachedSetting = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60 * 1000;
let tableClient;

function settingsTable() {
  if (!tableClient) {
    const connectionString = process.env.OPERATIONS_INCIDENT_TABLE_CONNECTION_STRING || process.env.AzureWebJobsStorage || process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connectionString) return null;
    tableClient = TableClient.fromConnectionString(connectionString, process.env.OPERATIONS_GLOBAL_SETTINGS_TABLE_NAME || 'OperationsGlobalSettings');
  }
  return tableClient;
}

async function readTableSetting() {
  const client = settingsTable();
  if (!client) return null;
  try {
    const entity = await client.getEntity('settings', 'auto-restart');
    return { enabled: entity.enabled === true, configured: entity.configured === true, changedAt: entity.changedAt || '', changedBy: entity.changedBy || '' };
  } catch (error) {
    if (error.statusCode !== 404) console.warn('Operations global setting table read failed:', error.message);
    return null;
  }
}

async function writeTableSetting(setting) {
  const client = settingsTable();
  if (!client) return false;
  try {
    await client.createTable();
    await client.upsertEntity({ partitionKey: 'settings', rowKey: 'auto-restart', ...setting }, 'Merge');
    return true;
  } catch (error) {
    console.warn('Operations global setting table write failed:', error.message);
    return false;
  }
}

async function getAutoRestart(sharePoint) {
  if (!sharePoint || typeof sharePoint.listAudit !== 'function') return { enabled: false, configured: false, changedAt: '', changedBy: '' };
  if (cachedSetting && Date.now() - cachedAt < CACHE_TTL_MS) return cachedSetting;
  const tableSetting = await readTableSetting();
  if (tableSetting) {
    cachedSetting = tableSetting;
    cachedAt = Date.now();
    return cachedSetting;
  }
  const events = await sharePoint.listAudit(SYSTEM_INCIDENT_ID);
  const latest = events
    .filter(event => String(event.eventType || '').toUpperCase() === AUTO_RESTART_ACTION)
    .sort((a, b) => (Date.parse(b.timestamp || '') || 0) - (Date.parse(a.timestamp || '') || 0))[0];
  cachedSetting = { enabled: String(latest?.result || '').toUpperCase() === 'ENABLED', configured: Boolean(latest), changedAt: latest?.timestamp || '', changedBy: latest?.operationsUserEmail || latest?.operationsUserName || '' };
  cachedAt = Date.now();
  return cachedSetting;
}

async function setAutoRestart(sharePoint, context, enabled) {
  if (!sharePoint || typeof sharePoint.appendAudit !== 'function') throw Object.assign(new Error('Operations audit list is not configured'), { status: 503, code: 'GLOBAL_SETTING_UNAVAILABLE' });
  const operations = context.operationsIdentity || {};
  const now = new Date().toISOString();
  const setting = { enabled: Boolean(enabled), configured: true, changedAt: now, changedBy: operations.email || operations.name || '' };
  const tablePersisted = await writeTableSetting(setting);
  try {
    await sharePoint.appendAudit({
      Title: AUTO_RESTART_ACTION,
      EventId: crypto.randomUUID(),
      EventKey: `${AUTO_RESTART_ACTION}:${now}`,
      CorrelationId: context.correlationId || '',
      IncidentId: SYSTEM_INCIDENT_ID,
      Action: AUTO_RESTART_ACTION,
      Result: enabled ? 'ENABLED' : 'DISABLED',
      OperationsUserId: operations.id || '',
      OperationsUserName: operations.name || '',
      OperationsUserEmail: operations.email || '',
      AdoIdentityId: '', AdoIdentityName: '', AdoIdentityEmail: '',
      Detail: enabled ? 'Global automatic P1 App Service restart enabled from Operations Hub.' : 'Global automatic P1 App Service restart disabled from Operations Hub.',
      OccurredAt: now
    });
  } catch (error) {
    console.warn('Operations global setting audit write deferred:', error.message);
    if (!tablePersisted) throw Object.assign(new Error('Unable to persist global Auto-Restart setting'), { status: 503, code: 'GLOBAL_SETTING_UNAVAILABLE' });
  }
  cachedSetting = setting;
  cachedAt = Date.now();
  return cachedSetting;
}

module.exports = { SYSTEM_INCIDENT_ID, AUTO_RESTART_ACTION, getAutoRestart, setAutoRestart };
