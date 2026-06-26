const crypto = require('crypto');

const DEFAULT_TABLE_NAME = 'AdoUserTokens';
const PARTITION_KEY = 'ado-oauth';

let tableClientPromise = null;

function isEnabled() {
  return !!getConnectionString();
}

function getConnectionString() {
  return process.env.ADO_TOKEN_STORAGE_CONNECTION_STRING ||
    process.env.AzureWebJobsStorage ||
    process.env.AZURE_STORAGE_CONNECTION_STRING ||
    '';
}

function getTableName() {
  return process.env.ADO_TOKEN_TABLE_NAME || DEFAULT_TABLE_NAME;
}

async function getTableClient() {
  const connectionString = getConnectionString();
  if (!connectionString) {
    throw new Error('Missing ADO_TOKEN_STORAGE_CONNECTION_STRING or AzureWebJobsStorage');
  }
  if (!tableClientPromise) {
    tableClientPromise = (async () => {
      const { TableClient } = require('@azure/data-tables');
      const client = TableClient.fromConnectionString(connectionString, getTableName());
      await client.createTable().catch(err => {
        if (err && (err.statusCode === 409 || err.code === 'TableAlreadyExists')) return;
        throw err;
      });
      return client;
    })();
  }
  return tableClientPromise;
}

function makeTokenRef(principal) {
  const userId = principal && principal.userId || '';
  const userDetails = principal && principal.userDetails || '';
  const stableId = userId || userDetails;
  return crypto.createHmac('sha256', getStoreSecret())
    .update(String(stableId || 'unknown-user'))
    .digest('hex');
}

function getStoreSecret() {
  return process.env.ADO_TOKEN_STORE_SECRET ||
    process.env.ADO_TOKEN_COOKIE_SECRET ||
    process.env.AAD_CLIENT_SECRET ||
    'ado-auto-approve-token-store';
}

function deriveKey() {
  return crypto.createHash('sha256').update(getStoreSecret()).digest();
}

function base64Url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(input.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

function encryptRecord(record) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(record), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [base64Url(iv), base64Url(cipher.getAuthTag()), base64Url(encrypted)].join('.');
}

function decryptRecord(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), fromBase64Url(parts[0]));
  decipher.setAuthTag(fromBase64Url(parts[1]));
  const plaintext = Buffer.concat([decipher.update(fromBase64Url(parts[2])), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

async function saveTokenRecord(tokenRef, record) {
  const client = await getTableClient();
  const entity = {
    partitionKey: PARTITION_KEY,
    rowKey: tokenRef,
    userId: record.userId || '',
    userDetails: record.userDetails || '',
    connectedAt: record.connectedAt || '',
    expiresAt: String(record.expiresAt || ''),
    encryptedRecord: encryptRecord(record)
  };
  await client.upsertEntity(entity, 'Replace');
}

async function getTokenRecord(tokenRef) {
  const client = await getTableClient();
  try {
    const entity = await client.getEntity(PARTITION_KEY, tokenRef);
    return decryptRecord(entity.encryptedRecord);
  } catch (err) {
    if (err && err.statusCode === 404) return null;
    throw err;
  }
}

async function deleteTokenRecord(tokenRef) {
  const client = await getTableClient();
  try {
    await client.deleteEntity(PARTITION_KEY, tokenRef);
  } catch (err) {
    if (err && err.statusCode === 404) return;
    throw err;
  }
}

module.exports = {
  isEnabled,
  makeTokenRef,
  saveTokenRecord,
  getTokenRecord,
  deleteTokenRecord
};
