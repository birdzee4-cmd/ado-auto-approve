const crypto = require('crypto');
const { TableClient } = require('@azure/data-tables');

const SETTINGS_PARTITION = 'settings';
const SETTINGS_ROW = 'auto-approve';
const LOGS_PARTITION = 'sharepoint-log';

let settingsClient = null;
let logsClient = null;
let settingsReady = false;
let logsReady = false;

function getConfig() {
  const connectionString = process.env.SHAREPOINT_FALLBACK_STORAGE_CONNECTION_STRING ||
    process.env.APPROVAL_LOCK_STORAGE_CONNECTION_STRING ||
    process.env.ADO_TOKEN_STORAGE_CONNECTION_STRING ||
    process.env.AzureWebJobsStorage ||
    process.env.AZURE_STORAGE_CONNECTION_STRING || '';

  if (!connectionString) {
    throw new Error('Missing storage connection string for SharePoint fallback');
  }

  return {
    connectionString,
    settingsTable: process.env.SHAREPOINT_FALLBACK_SETTINGS_TABLE || 'AutoApproveSettings',
    logsTable: process.env.SHAREPOINT_FALLBACK_LOGS_TABLE || 'SharePointFallbackLogs'
  };
}

async function getSettingsClient() {
  if (!settingsClient) {
    const cfg = getConfig();
    settingsClient = TableClient.fromConnectionString(cfg.connectionString, cfg.settingsTable);
  }
  if (!settingsReady) {
    await ensureTable(settingsClient);
    settingsReady = true;
  }
  return settingsClient;
}

async function getLogsClient() {
  if (!logsClient) {
    const cfg = getConfig();
    logsClient = TableClient.fromConnectionString(cfg.connectionString, cfg.logsTable);
  }
  if (!logsReady) {
    await ensureTable(logsClient);
    logsReady = true;
  }
  return logsClient;
}

async function ensureTable(client) {
  try {
    await client.createTable();
  } catch (err) {
    if (!err || (err.statusCode !== 409 && err.code !== 'TableAlreadyExists')) throw err;
  }
}

async function getAutoApproveSettings() {
  const client = await getSettingsClient();
  try {
    const entity = await client.getEntity(SETTINGS_PARTITION, SETTINGS_ROW);
    return {
      autoMode: entity.autoMode || 'normal',
      expiryTime: entity.expiryTime || '',
      enabledBy: entity.enabledBy || '',
      updatedAt: entity.updatedAt || ''
    };
  } catch (err) {
    if (err && err.statusCode === 404) return null;
    throw err;
  }
}

async function saveAutoApproveSettings(mode, expiryTime, enabledBy) {
  const client = await getSettingsClient();
  const updatedAt = new Date().toISOString();
  await client.upsertEntity({
    partitionKey: SETTINGS_PARTITION,
    rowKey: SETTINGS_ROW,
    autoMode: String(mode || 'normal'),
    expiryTime: String(expiryTime || ''),
    enabledBy: String(enabledBy || ''),
    updatedAt
  }, 'Replace');
  return { autoMode: mode || 'normal', expiryTime: expiryTime || '', enabledBy: enabledBy || '', updatedAt };
}

async function clearAutoApproveSettings() {
  const client = await getSettingsClient();
  try {
    await client.deleteEntity(SETTINGS_PARTITION, SETTINGS_ROW);
  } catch (err) {
    if (!err || err.statusCode !== 404) throw err;
  }
}

async function saveAuditLog(fields, sharePointStatus) {
  const client = await getLogsClient();
  const now = new Date().toISOString();
  const rowKey = crypto.randomUUID();
  await client.createEntity({
    partitionKey: LOGS_PARTITION,
    rowKey,
    createdAt: now,
    lastModifiedAt: now,
    sharePointStatus: Number(sharePointStatus) || 507,
    fieldsJson: JSON.stringify(fields || {})
  });
  return {
    id: 'table:' + rowKey,
    createdDateTime: now,
    lastModifiedDateTime: now,
    fields: fields || {}
  };
}

async function getAuditLogItems(options) {
  const opts = options || {};
  const client = await getLogsClient();
  const rows = [];
  const iterator = client.listEntities({
    queryOptions: { filter: `PartitionKey eq '${LOGS_PARTITION}'` }
  });
  for await (const entity of iterator) {
    const fields = parseFields(entity.fieldsJson);
    if (opts.prId && Number(fields.PR_ID) !== Number(opts.prId)) continue;
    if (opts.eventKey && String(fields.Event_Key || '') !== String(opts.eventKey)) continue;
    rows.push({
      id: 'table:' + entity.rowKey,
      createdDateTime: entity.createdAt || entity.timestamp || '',
      lastModifiedDateTime: entity.lastModifiedAt || entity.timestamp || '',
      fields
    });
  }
  rows.sort((a, b) => Date.parse(b.lastModifiedDateTime) - Date.parse(a.lastModifiedDateTime));
  const top = Math.max(1, Math.min(Number(opts.top) || 100, 1000));
  return rows.slice(0, top);
}

function parseFields(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

function isQuotaLimitResult(result) {
  const error = result && result.body && result.body.error || {};
  return !!result && (Number(result.status) === 507 || error.code === 'quotaLimitReached');
}

module.exports = {
  getAutoApproveSettings,
  saveAutoApproveSettings,
  clearAutoApproveSettings,
  saveAuditLog,
  getAuditLogItems,
  isQuotaLimitResult
};
