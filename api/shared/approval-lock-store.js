const crypto = require('crypto');
const { TableClient } = require('@azure/data-tables');

let cachedClient = null;
let tableReady = false;

function getConfig() {
  const connectionString = process.env.APPROVAL_LOCK_STORAGE_CONNECTION_STRING ||
    process.env.ADO_TOKEN_STORAGE_CONNECTION_STRING ||
    process.env.AzureWebJobsStorage ||
    process.env.AZURE_STORAGE_CONNECTION_STRING;
  const tableName = process.env.APPROVAL_LOCK_TABLE || 'ApprovalLocks';
  const processingTtlSeconds = parseInt(process.env.APPROVAL_LOCK_TTL_SECONDS || '120', 10);
  const completedTtlSeconds = parseInt(process.env.APPROVAL_LOCK_COMPLETED_TTL_SECONDS || '600', 10);
  const failedTtlSeconds = parseInt(process.env.APPROVAL_LOCK_FAILED_TTL_SECONDS || '15', 10);

  if (!connectionString) {
    throw new Error('Missing APPROVAL_LOCK_STORAGE_CONNECTION_STRING, ADO_TOKEN_STORAGE_CONNECTION_STRING, AzureWebJobsStorage, or AZURE_STORAGE_CONNECTION_STRING');
  }

  return {
    connectionString,
    tableName,
    processingTtlSeconds: normalizeTtl(processingTtlSeconds, 120),
    completedTtlSeconds: normalizeTtl(completedTtlSeconds, 600),
    failedTtlSeconds: normalizeTtl(failedTtlSeconds, 15)
  };
}

function normalizeTtl(value, fallback) {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

async function getClient() {
  if (cachedClient) return cachedClient;
  const cfg = getConfig();
  cachedClient = TableClient.fromConnectionString(cfg.connectionString, cfg.tableName);
  return cachedClient;
}

async function ensureTable() {
  const client = await getClient();
  if (tableReady) return client;
  try {
    await client.createTable();
  } catch (e) {
    if (!isConflict(e)) throw e;
  }
  tableReady = true;
  return client;
}

async function acquireLock(scope, resourceId, owner, metadata) {
  const cfg = getConfig();
  const client = await ensureTable();
  const now = new Date();
  const operationId = createOperationId();
  const entity = buildProcessingEntity(scope, resourceId, owner, operationId, now, cfg.processingTtlSeconds, metadata);

  try {
    await client.createEntity(entity);
    return { acquired: true, operationId, entity };
  } catch (e) {
    if (!isConflict(e)) throw e;
  }

  let existing;
  try {
    existing = await client.getEntity(entity.partitionKey, entity.rowKey);
  } catch (e) {
    if (isNotFound(e)) {
      return acquireLock(scope, resourceId, owner, metadata);
    }
    throw e;
  }

  const status = String(existing.status || '').toLowerCase();
  const expired = isExpired(existing.expiresAt, now);
  if (status === 'completed' && !expired) {
    return {
      acquired: false,
      completed: true,
      entity: existing,
      response: buildCompletedResponse(existing)
    };
  }

  if (!expired) {
    return {
      acquired: false,
      inProgress: status === 'processing',
      entity: existing,
      response: buildLockedResponse(existing)
    };
  }

  const takeover = Object.assign({}, buildProcessingEntity(scope, resourceId, owner, operationId, now, cfg.processingTtlSeconds, metadata), {
    createdAt: existing.createdAt || now.toISOString(),
    takeoverAt: now.toISOString(),
    previousStatus: existing.status || '',
    attempts: Number(existing.attempts || 0) + 1
  });

  try {
    await client.updateEntity(takeover, 'Merge', { etag: existing.etag });
    return { acquired: true, operationId, entity: takeover, takeover: true };
  } catch (e) {
    if (isPreconditionFailed(e) || isConflict(e)) {
      return {
        acquired: false,
        inProgress: true,
        entity: existing,
        response: buildLockedResponse(existing)
      };
    }
    throw e;
  }
}

async function completeLock(lock, result) {
  if (!lock || !lock.acquired) return { skipped: true };
  const cfg = getConfig();
  const client = await ensureTable();
  const now = new Date();
  const entity = {
    partitionKey: lock.entity.partitionKey,
    rowKey: lock.entity.rowKey,
    status: 'completed',
    operationId: lock.operationId,
    owner: lock.entity.owner || '',
    completedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: addSeconds(now, cfg.completedTtlSeconds).toISOString(),
    resultStatus: result && result.status || 'completed',
    resultMessage: result && result.message || '',
    resultUser: result && result.user || lock.entity.owner || ''
  };
  return updateLockState(client, lock, entity);
}

async function failLock(lock, result) {
  if (!lock || !lock.acquired) return { skipped: true };
  const cfg = getConfig();
  const client = await ensureTable();
  const now = new Date();
  const entity = {
    partitionKey: lock.entity.partitionKey,
    rowKey: lock.entity.rowKey,
    status: 'failed',
    operationId: lock.operationId,
    owner: lock.entity.owner || '',
    failedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: addSeconds(now, cfg.failedTtlSeconds).toISOString(),
    resultStatus: result && result.status || 'failed',
    resultMessage: result && result.message || ''
  };
  return updateLockState(client, lock, entity);
}

async function updateLockState(client, lock, entity) {
  let current;
  try {
    current = await client.getEntity(lock.entity.partitionKey, lock.entity.rowKey);
  } catch (e) {
    if (isNotFound(e)) return { ok: false, missing: true };
    throw e;
  }

  if (String(current.operationId || '') !== String(lock.operationId || '')) {
    return {
      ok: false,
      stale: true,
      currentOperationId: current.operationId || ''
    };
  }

  await client.updateEntity(entity, 'Merge', { etag: current.etag });
  return { ok: true };
}

function buildProcessingEntity(scope, resourceId, owner, operationId, now, ttlSeconds, metadata) {
  const safeScope = sanitizeKey(scope);
  const safeResourceId = sanitizeKey(resourceId);
  const entity = {
    partitionKey: safeScope,
    rowKey: safeResourceId,
    status: 'processing',
    owner: String(owner || ''),
    operationId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: addSeconds(now, ttlSeconds).toISOString(),
    attempts: 1
  };
  const data = metadata || {};
  Object.keys(data).forEach(key => {
    const safeKey = String(key || '').replace(/[^A-Za-z0-9_]/g, '');
    if (!safeKey) return;
    entity[safeKey] = toTableValue(data[key]);
  });
  return entity;
}

function buildLockedResponse(entity) {
  return {
    ok: false,
    error: 'Approval is already in progress',
    detail: 'Another approval request is already processing this item.',
    lockedBy: entity.owner || '',
    status: entity.status || '',
    operationId: entity.operationId || '',
    expiresAt: entity.expiresAt || ''
  };
}

function buildCompletedResponse(entity) {
  return {
    ok: true,
    skipped: true,
    message: 'Approval request was already completed recently',
    approvedBy: entity.resultUser || entity.owner || '',
    completedAt: entity.completedAt || '',
    result: entity.resultMessage || ''
  };
}

function sanitizeKey(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/#?\u0000-\u001f\u007f-\u009f]/g, '_')
    .slice(0, 512) || 'unknown';
}

function toTableValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value).slice(0, 1024);
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

function isExpired(expiresAt, now) {
  const expires = Date.parse(expiresAt);
  return !Number.isFinite(expires) || expires <= now.getTime();
}

function createOperationId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function isConflict(error) {
  return getStatusCode(error) === 409;
}

function isNotFound(error) {
  return getStatusCode(error) === 404;
}

function isPreconditionFailed(error) {
  return getStatusCode(error) === 412;
}

function getStatusCode(error) {
  return error && (error.statusCode || error.status || error.code);
}

module.exports = {
  acquireLock,
  completeLock,
  failLock,
  getConfig,
  ensureTable
};
