/**
 * POST /api/table-retention-cleanup
 *
 * Deletes old Azure Table rows for short-lived approval locks and stale
 * server-side ADO token records. This intentionally targets only the app-owned
 * tables, never Azure Functions host tables.
 */

const { TableClient } = require('@azure/data-tables');
const sp = require('../shared/sharepoint-client');

module.exports = async function (context, req) {
  function jsonResponse(status, payload) {
    context.res = {
      status: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    };
  }

  try {
    const expectedToken = process.env.TABLE_RETENTION_TOKEN ||
      process.env.LOG_RETENTION_TOKEN ||
      process.env.DAILY_SUMMARY_TOKEN ||
      '';
    if (!expectedToken) {
      jsonResponse(500, { ok: false, error: 'TABLE_RETENTION_TOKEN, LOG_RETENTION_TOKEN, or DAILY_SUMMARY_TOKEN is not configured' });
      return;
    }

    const suppliedToken = req.headers &&
      (req.headers['x-table-retention-token'] ||
       req.headers['X-Table-Retention-Token'] ||
       req.headers['x-log-retention-token'] ||
       req.headers['X-Log-Retention-Token'] ||
       req.headers['x-daily-summary-token'] ||
       req.headers['X-Daily-Summary-Token']);
    if (suppliedToken !== expectedToken) {
      jsonResponse(401, { ok: false, error: 'Unauthorized' });
      return;
    }

    const options = parseOptions(req.body);
    const result = await runTableRetentionCleanup(context, options);
    jsonResponse(result.ok ? 200 : 502, result);
  } catch (err) {
    context.log.error('Table retention cleanup failed:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};

async function runTableRetentionCleanup(context, options) {
  const now = new Date();
  const lockCutoff = new Date(now.getTime() - options.lockRetentionDays * 24 * 60 * 60 * 1000);
  const tokenCutoff = new Date(now.getTime() - options.tokenRetentionDays * 24 * 60 * 60 * 1000);
  const results = [];

  results.push(await cleanupApprovalLocks({
    context,
    cutoff: lockCutoff,
    dryRun: options.dryRun,
    maxItems: options.maxItems
  }));

  results.push(await cleanupAdoUserTokens({
    context,
    cutoff: tokenCutoff,
    dryRun: options.dryRun,
    maxItems: options.maxItems
  }));

  const ok = results.every(result => result.ok || result.skipped);
  const deleted = results.reduce((sum, result) => sum + Number(result.deleted || 0), 0);
  const matched = results.reduce((sum, result) => sum + Number(result.matched || 0), 0);

  await writeTableRetentionLog(context, {
    result: ok ? 'OK' : 'Warning',
    reason: 'Locks retention ' + options.lockRetentionDays + ' days' +
      ' | Tokens retention ' + options.tokenRetentionDays + ' days' +
      ' | Dry run ' + options.dryRun +
      ' | Matched ' + matched +
      ' | Deleted ' + deleted +
      buildResultReason(results)
  });

  return {
    ok: ok,
    dryRun: options.dryRun,
    lockRetentionDays: options.lockRetentionDays,
    tokenRetentionDays: options.tokenRetentionDays,
    lockCutoff: lockCutoff.toISOString(),
    tokenCutoff: tokenCutoff.toISOString(),
    matched: matched,
    deleted: deleted,
    results: results
  };
}

async function cleanupApprovalLocks(opts) {
  const cfg = {
    connectionString: process.env.APPROVAL_LOCK_STORAGE_CONNECTION_STRING ||
      process.env.AzureWebJobsStorage ||
      process.env.AZURE_STORAGE_CONNECTION_STRING ||
      '',
    tableName: process.env.APPROVAL_LOCK_TABLE || 'ApprovalLocks',
    name: 'ApprovalLocks',
    retentionField: 'expiresAt'
  };
  return cleanupTable({
    context: opts.context,
    cfg,
    cutoff: opts.cutoff,
    dryRun: opts.dryRun,
    maxItems: opts.maxItems,
    isExpired: entity => {
      const expiresAt = Date.parse(entity.expiresAt);
      return Number.isFinite(expiresAt) && expiresAt < opts.cutoff.getTime();
    }
  });
}

async function cleanupAdoUserTokens(opts) {
  const cfg = {
    connectionString: process.env.ADO_TOKEN_STORAGE_CONNECTION_STRING ||
      process.env.AzureWebJobsStorage ||
      process.env.AZURE_STORAGE_CONNECTION_STRING ||
      '',
    tableName: process.env.ADO_TOKEN_TABLE_NAME || 'AdoUserTokens',
    name: 'AdoUserTokens',
    retentionField: 'expiresAt'
  };
  return cleanupTable({
    context: opts.context,
    cfg,
    cutoff: opts.cutoff,
    dryRun: opts.dryRun,
    maxItems: opts.maxItems,
    isExpired: entity => {
      const expiresAtMs = Number(entity.expiresAt || 0);
      return Number.isFinite(expiresAtMs) && expiresAtMs > 0 && expiresAtMs < opts.cutoff.getTime();
    }
  });
}

async function cleanupTable(opts) {
  const cfg = opts.cfg;
  if (!cfg.connectionString) {
    return {
      ok: true,
      skipped: true,
      table: cfg.name,
      tableName: cfg.tableName,
      reason: 'Storage connection string is not configured',
      matched: 0,
      deleted: 0
    };
  }

  const client = TableClient.fromConnectionString(cfg.connectionString, cfg.tableName);
  const expired = [];
  let scanned = 0;
  try {
    for await (const entity of client.listEntities()) {
      scanned += 1;
      if (opts.isExpired(entity)) expired.push(toEntityRef(entity));
      if (expired.length >= opts.maxItems) break;
    }
  } catch (err) {
    if (isNotFound(err)) {
      return {
        ok: true,
        skipped: true,
        table: cfg.name,
        tableName: cfg.tableName,
        reason: 'Table does not exist',
        matched: 0,
        deleted: 0
      };
    }
    throw err;
  }

  let deleted = 0;
  const deleteErrors = [];
  if (!opts.dryRun) {
    for (const entity of expired) {
      try {
        await client.deleteEntity(entity.partitionKey, entity.rowKey);
        deleted += 1;
      } catch (err) {
        if (isNotFound(err)) continue;
        deleteErrors.push(entity.partitionKey + '/' + entity.rowKey + ': ' + (err.message || err.code || 'delete failed'));
        if (deleteErrors.length >= 10) break;
      }
    }
  }

  return {
    ok: deleteErrors.length === 0,
    table: cfg.name,
    tableName: cfg.tableName,
    dryRun: opts.dryRun,
    cutoff: opts.cutoff.toISOString(),
    scanned: scanned,
    matched: expired.length,
    deleted: deleted,
    maxItems: opts.maxItems,
    truncated: expired.length >= opts.maxItems,
    deleteErrors: deleteErrors
  };
}

function parseOptions(body) {
  const payload = body && typeof body === 'object' ? body : {};
  return {
    lockRetentionDays: clampNumber(payload.lockRetentionDays || process.env.TABLE_RETENTION_LOCK_DAYS, 1, 365, 7),
    tokenRetentionDays: clampNumber(payload.tokenRetentionDays || process.env.TABLE_RETENTION_TOKEN_DAYS, 7, 3650, 90),
    maxItems: clampNumber(payload.maxItems || process.env.TABLE_RETENTION_BATCH_LIMIT, 1, 1000, 500),
    dryRun: payload.dryRun !== false
  };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function toEntityRef(entity) {
  return {
    partitionKey: entity.partitionKey || entity.PartitionKey || '',
    rowKey: entity.rowKey || entity.RowKey || ''
  };
}

function isNotFound(error) {
  const status = error && (error.statusCode || error.status || error.code);
  return status === 404 || status === 'ResourceNotFound';
}

function buildResultReason(results) {
  return results.map(result =>
    ' | ' + result.table + ' matched ' + Number(result.matched || 0) +
    ', deleted ' + Number(result.deleted || 0) +
    (result.skipped ? ', skipped: ' + result.reason : '') +
    (result.deleteErrors && result.deleteErrors.length ? ', errors ' + result.deleteErrors.length : '')
  ).join('');
}

async function writeTableRetentionLog(context, opts) {
  try {
    const nowIso = new Date().toISOString();
    await sp.addLogItem(sp.buildLogFields({
      prId: 0,
      action: 'Table Retention Cleanup',
      user: 'System',
      repository: 'System Health',
      prTitle: 'Azure Table Retention Cleanup',
      targetBranch: '',
      result: opts.result || 'OK',
      reason: opts.reason || '',
      source: 'Logic Apps Table Retention Cleanup',
      eventKey: 'table-retention-cleanup:' + nowIso,
      lastCheckedAt: nowIso
    }));
  } catch (e) {
    if (context && context.log && context.log.warn) {
      context.log.warn('Table retention cleanup summary log failed: ' + e.message);
    }
  }
}

module.exports.runTableRetentionCleanup = runTableRetentionCleanup;
