/**
 * POST /api/log-retention-cleanup
 *
 * Archives SharePoint log items older than the retention window to CSV,
 * then deletes them only after the archive upload succeeds.
 */

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
    const expectedToken = process.env.LOG_RETENTION_TOKEN || process.env.DAILY_SUMMARY_TOKEN || '';
    if (!expectedToken) {
      jsonResponse(500, { ok: false, error: 'LOG_RETENTION_TOKEN or DAILY_SUMMARY_TOKEN is not configured' });
      return;
    }

    const suppliedToken = req.headers &&
      (req.headers['x-log-retention-token'] ||
       req.headers['X-Log-Retention-Token'] ||
       req.headers['x-daily-summary-token'] ||
       req.headers['X-Daily-Summary-Token']);
    if (suppliedToken !== expectedToken) {
      jsonResponse(401, { ok: false, error: 'Unauthorized' });
      return;
    }

    const options = parseOptions(req.body);
    const result = await runRetentionCleanup(context, options);
    jsonResponse(result.ok ? 200 : 502, result);
  } catch (err) {
    context.log.error('Log retention cleanup failed:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};

async function runRetentionCleanup(context, options) {
  const cutoff = new Date(Date.now() - options.retentionDays * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();
  const query = await sp.getLogItemsBefore(cutoffIso, options.maxItems);
  if (!query.ok) {
    return {
      ok: false,
      error: 'SharePoint old log query failed: HTTP ' + query.status,
      retentionDays: options.retentionDays,
      dryRun: options.dryRun,
      cutoff: cutoffIso,
      archiveUploaded: false,
      deleted: 0
    };
  }

  const items = query.body && Array.isArray(query.body.value) ? query.body.value : [];
  const rows = items.map(normalizeLogItem);
  const archivePath = buildArchivePath(options.archiveFolder, cutoff, new Date());
  const csv = buildCsv(rows);

  if (options.dryRun) {
    return {
      ok: true,
      dryRun: options.dryRun,
      retentionDays: options.retentionDays,
      cutoff: cutoffIso,
      matched: rows.length,
      truncated: !!(query.body && query.body.truncated),
      archivePath: archivePath,
      archiveUploaded: false,
      deleted: 0,
      message: 'Dry run only. Send dryRun=false to archive and delete.'
    };
  }

  if (rows.length === 0) {
    await writeRetentionLog(context, {
      result: 'OK',
      reason: 'Archived 0 | Deleted 0 | Retention ' + options.retentionDays + ' days',
      archivePath: archivePath,
      deleted: 0
    });
    return {
      ok: true,
      dryRun: false,
      retentionDays: options.retentionDays,
      cutoff: cutoffIso,
      matched: 0,
      truncated: false,
      archivePath: archivePath,
      archiveUploaded: false,
      deleted: 0,
      message: 'No old log items found.'
    };
  }

  const upload = await sp.uploadArchiveFile(archivePath, csv, 'text/csv; charset=utf-8');
  if (!upload.ok) {
    await writeRetentionLog(context, {
      result: 'Archive failed',
      reason: 'Upload failed HTTP ' + upload.status + ' | Matched ' + rows.length,
      archivePath: archivePath,
      deleted: 0
    });
    return {
      ok: false,
      error: 'Archive upload failed: HTTP ' + upload.status,
      retentionDays: options.retentionDays,
      cutoff: cutoffIso,
      matched: rows.length,
      archivePath: archivePath,
      archiveUploaded: false,
      deleted: 0
    };
  }

  let deleted = 0;
  const deleteErrors = [];
  if (options.deleteAfterArchive) {
    for (const item of items) {
      const deletedResult = await sp.deleteLogItem(item.id);
      if (deletedResult.ok) {
        deleted += 1;
      } else {
        deleteErrors.push('Item ' + item.id + ': HTTP ' + deletedResult.status);
        if (deleteErrors.length >= 10) break;
      }
    }
  }

  await writeRetentionLog(context, {
    result: deleteErrors.length ? 'Warning' : 'OK',
    reason: 'Archived ' + rows.length +
      ' | Deleted ' + deleted +
      ' | Retention ' + options.retentionDays + ' days' +
      (deleteErrors.length ? ' | Delete errors ' + deleteErrors.join(' | ') : ''),
    archivePath: archivePath,
    deleted: deleted
  });

  return {
    ok: deleteErrors.length === 0,
    dryRun: false,
    retentionDays: options.retentionDays,
    cutoff: cutoffIso,
    matched: rows.length,
    truncated: !!(query.body && query.body.truncated),
    archivePath: archivePath,
    archiveUploaded: true,
    deleted: deleted,
    deleteErrors: deleteErrors
  };
}

function parseOptions(body) {
  const payload = body && typeof body === 'object' ? body : {};
  return {
    retentionDays: Math.min(Math.max(Number(payload.retentionDays || process.env.LOG_RETENTION_DAYS || 180), 30), 3650),
    maxItems: Math.min(Math.max(Number(payload.maxItems || process.env.LOG_RETENTION_BATCH_LIMIT || 500), 1), 1000),
    archiveFolder: String(payload.archiveFolder || process.env.LOG_ARCHIVE_FOLDER || 'ADO AutoApprove Archive').trim(),
    dryRun: payload.dryRun !== false,
    deleteAfterArchive: payload.deleteAfterArchive !== false
  };
}

function normalizeLogItem(item) {
  const fields = item && item.fields || {};
  return {
    itemId: item && item.id || '',
    createdAt: item && item.createdDateTime || '',
    modifiedAt: item && item.lastModifiedDateTime || '',
    title: fields.Title || '',
    prId: fields.PR_ID || '',
    action: fields.Action || '',
    user: fields.User || '',
    repository: fields.Repository || '',
    prTitle: fields.PR_Title || '',
    targetBranch: fields.Target_Branch || '',
    result: fields.Result || '',
    reason: fields.Reason || '',
    logSource: fields.Log_Source || fields.Source || '',
    eventKey: fields.Event_Key || '',
    buildStatus: fields.Build_Status || '',
    buildResult: fields.Build_Result || '',
    policyStatus: fields.Policy_Status || '',
    mergeStatus: fields.Merge_Status || '',
    autoCompleteStatus: fields.AutoComplete_Status || '',
    lastCheckedAt: fields.Last_Checked_At || '',
    adoBuildUrl: fields.ADO_Build_URL || '',
    adoPrUrl: fields.ADO_PR_URL || ''
  };
}

function buildCsv(rows) {
  const columns = [
    'itemId',
    'createdAt',
    'modifiedAt',
    'title',
    'prId',
    'action',
    'user',
    'repository',
    'prTitle',
    'targetBranch',
    'result',
    'reason',
    'logSource',
    'eventKey',
    'buildStatus',
    'buildResult',
    'policyStatus',
    'mergeStatus',
    'autoCompleteStatus',
    'lastCheckedAt',
    'adoBuildUrl',
    'adoPrUrl'
  ];
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map(column => csvCell(row[column])).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function buildArchivePath(baseFolder, cutoffDate, runDate) {
  const runKey = formatUtc(runDate, 'compact');
  const cutoffKey = formatUtc(cutoffDate, 'date');
  const year = String(runDate.getUTCFullYear());
  const month = String(runDate.getUTCMonth() + 1).padStart(2, '0');
  return [
    baseFolder || 'ADO AutoApprove Archive',
    year,
    month,
    'ado-autoapprove-log-before-' + cutoffKey + '-run-' + runKey + '.csv'
  ].join('/');
}

function formatUtc(date, mode) {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  if (mode === 'date') return yyyy + mm + dd;
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return yyyy + mm + dd + '-' + hh + mi + ss;
}

async function writeRetentionLog(context, opts) {
  try {
    const nowIso = new Date().toISOString();
    await sp.addLogItem(sp.buildLogFields({
      prId: 0,
      action: 'Log Retention Cleanup',
      user: 'System',
      repository: 'System Health',
      prTitle: 'SharePoint Log Retention Cleanup',
      targetBranch: '',
      result: opts.result || 'OK',
      reason: (opts.reason || '') + ' | Archive: ' + (opts.archivePath || ''),
      source: 'Logic Apps Retention Cleanup',
      eventKey: 'log-retention-cleanup:' + nowIso,
      lastCheckedAt: nowIso
    }));
  } catch (e) {
    if (context && context.log && context.log.warn) {
      context.log.warn('Retention cleanup summary log failed: ' + e.message);
    }
  }
}

module.exports.runRetentionCleanup = runRetentionCleanup;
