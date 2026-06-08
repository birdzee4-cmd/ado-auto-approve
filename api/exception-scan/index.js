/**
 * POST /api/exception-scan
 *
 * Scans recent SharePoint approval logs, enriches each PR from Azure DevOps,
 * and sends Teams alerts only for Build/Policy failed cases.
 */

const ado = require('../shared/ado-client');
const sp = require('../shared/sharepoint-client');
const notifications = require('../shared/notification-service');

module.exports = async function (context, req) {
  function jsonResponse(status, payload) {
    context.res = {
      status: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    };
  }

  try {
    const expectedToken = process.env.EXCEPTION_SCAN_TOKEN || process.env.DAILY_SUMMARY_TOKEN || '';
    if (!expectedToken) {
      jsonResponse(500, { ok: false, error: 'EXCEPTION_SCAN_TOKEN or DAILY_SUMMARY_TOKEN is not configured' });
      return;
    }

    const suppliedToken = req.headers &&
      (req.headers['x-exception-scan-token'] ||
       req.headers['X-Exception-Scan-Token'] ||
       req.headers['x-daily-summary-token'] ||
       req.headers['X-Daily-Summary-Token']);
    if (suppliedToken !== expectedToken) {
      jsonResponse(401, { ok: false, error: 'Unauthorized' });
      return;
    }

    const options = parseOptions(req.body);
    const result = await scanExceptions(context, options);
    jsonResponse(200, result);
  } catch (err) {
    context.log.error('Exception scan failed:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};

async function scanExceptions(context, options) {
  const cfg = ado.getConfig();
  const lookbackHours = options.lookbackHours;
  const sinceIso = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const reviewerGroup = process.env.ADO_REVIEWER_GROUP || 'IT Support Approve';
  const targetPrefix = (process.env.ADO_TARGET_BRANCH || 'refs/heads/staging').toLowerCase();
  const maxLogs = Math.min(Math.max(options.maxLogs, 50), 1000);
  const maxPrs = Math.min(Math.max(options.maxPrs, 1), 200);
  const branchBuildCache = {};

  const logsResult = await sp.getLogItemsSince(sinceIso, maxLogs);
  if (!logsResult.ok) {
    const failedResult = {
      ok: false,
      error: 'SharePoint log query failed: HTTP ' + logsResult.status,
      checkedLogs: 0,
      checkedPrs: 0,
      sent: 0,
      skipped: 0,
      errors: ['SharePoint log query failed: HTTP ' + logsResult.status]
    };
    await writeScanSummaryLog(context, failedResult, {
      lookbackHours: lookbackHours,
      maxLogs: maxLogs,
      maxPrs: maxPrs
    });
    return failedResult;
  }

  const logs = logsResult.body && Array.isArray(logsResult.body.value) ? logsResult.body.value : [];
  const approvalLogs = collectApprovalLogs(logs, sinceIso).slice(0, maxPrs);
  const rows = [];
  const errors = [];
  let sent = 0;
  let skipped = 0;

  for (const log of approvalLogs) {
    try {
      const prResult = await ado.getPullRequest(log.prId);
      if (!prResult.ok || !prResult.body) {
        skipped += 1;
        errors.push('PR #' + log.prId + ': ADO returned HTTP ' + prResult.status);
        continue;
      }

      const pr = prResult.body;
      const targetRef = String(pr.targetRefName || '').toLowerCase();
      if (!(targetRef.startsWith(targetPrefix) || isMergeCodeBranch(targetRef))) {
        skipped += 1;
        continue;
      }
      if (!ado.hasReviewerGroup(pr, reviewerGroup)) {
        skipped += 1;
        continue;
      }

      const row = await buildNotificationPr(context, cfg, pr, log, branchBuildCache);
      const notifyResult = await notifications.notifyPrIssueIfNeeded(context, row, { scope: 'approval-log' });
      if (notifyResult && notifyResult.ok) sent += 1;
      else skipped += 1;

      rows.push({
        prId: row.id,
        title: row.title,
        repository: row.repository,
        status: row.status,
        buildStatus: row.statusSnapshot && row.statusSnapshot.buildStatus,
        buildResult: row.statusSnapshot && row.statusSnapshot.buildResult,
        buildRunId: row.statusSnapshot && row.statusSnapshot.buildRunId,
        policyStatus: row.statusSnapshot && row.statusSnapshot.policyStatus,
        notification: notifyResult
      });
    } catch (e) {
      skipped += 1;
      errors.push('PR #' + log.prId + ': ' + e.message);
      if (context && context.log && context.log.warn) {
        context.log.warn('Exception scan skipped PR #' + log.prId + ': ' + e.message);
      }
    }
  }

  const result = {
    ok: errors.length === 0,
    source: 'Approval Log Exception Scan',
    lookbackHours: lookbackHours,
    checkedLogs: logs.length,
    checkedPrs: approvalLogs.length,
    sent: sent,
    skipped: skipped,
    errors: errors.slice(0, 10),
    rows: rows
  };
  await writeScanSummaryLog(context, result, {
    lookbackHours: lookbackHours,
    maxLogs: maxLogs,
    maxPrs: maxPrs
  });
  return result;
}

async function writeScanSummaryLog(context, result, options) {
  try {
    const nowIso = new Date().toISOString();
    const status = result && result.ok ? 'OK' : 'Warning';
    const reasonParts = [
      'Checked logs ' + (result && result.checkedLogs || 0),
      'Checked PRs ' + (result && result.checkedPrs || 0),
      'Alerts sent ' + (result && result.sent || 0),
      'Skipped ' + (result && result.skipped || 0),
      'Lookback ' + (options && options.lookbackHours || result && result.lookbackHours || 24) + 'h'
    ];
    const errors = Array.isArray(result && result.errors) ? result.errors.filter(Boolean) : [];
    if (errors.length) {
      reasonParts.push('Errors ' + errors.slice(0, 3).join(' | '));
    }

    await sp.addLogItem(sp.buildLogFields({
      prId: 0,
      action: 'Exception Scan',
      user: 'System',
      repository: 'System Health',
      prTitle: 'Build/Policy Exception Scan',
      targetBranch: process.env.ADO_TARGET_BRANCH || 'refs/heads/staging',
      result: status,
      reason: reasonParts.join(' | '),
      source: 'Approval Log Exception Scan',
      eventKey: 'exception-scan:' + nowIso,
      lastCheckedAt: nowIso
    }));
  } catch (e) {
    if (context && context.log && context.log.warn) {
      context.log.warn('Exception scan summary log failed: ' + e.message);
    }
  }
}

function parseOptions(body) {
  const payload = body && typeof body === 'object' ? body : {};
  return {
    lookbackHours: Math.min(Math.max(Number(payload.lookbackHours || process.env.EXCEPTION_SCAN_LOOKBACK_HOURS || 24), 1), 72),
    maxLogs: Math.min(Math.max(Number(payload.maxLogs || process.env.EXCEPTION_SCAN_LOG_LIMIT || 500), 50), 1000),
    maxPrs: Math.min(Math.max(Number(payload.maxPrs || process.env.EXCEPTION_SCAN_PR_LIMIT || 80), 1), 200)
  };
}

function collectApprovalLogs(items, sinceIso) {
  const sinceTime = Date.parse(sinceIso);
  const byPr = new Map();
  for (const item of items || []) {
    const fields = item && item.fields || {};
    const prId = parseInt(fields.PR_ID, 10);
    if (!Number.isFinite(prId) || prId <= 0) continue;
    if (!isApprovedLogAction(fields.Action)) continue;
    const createdAt = item.createdDateTime || item.lastModifiedDateTime || fields.Last_Checked_At || '';
    const createdTime = Date.parse(createdAt);
    if (Number.isFinite(sinceTime) && (!Number.isFinite(createdTime) || createdTime < sinceTime)) continue;
    const existing = byPr.get(prId);
    if (!existing || Date.parse(createdAt) > Date.parse(existing.approvedAt || '')) {
      byPr.set(prId, {
        prId: prId,
        approvedAt: createdAt,
        action: fields.Action || '',
        user: fields.User || '',
        source: fields.Log_Source || fields.Source || '',
        logId: item.id || ''
      });
    }
  }
  return Array.from(byPr.values())
    .sort((a, b) => Date.parse(b.approvedAt || '') - Date.parse(a.approvedAt || ''));
}

function isApprovedLogAction(action) {
  const text = String(action || '').toLowerCase();
  return text === 'approved' ||
    text === 'external approved' ||
    text === 'external approved with suggestions';
}

async function buildNotificationPr(context, cfg, pr, log, branchBuildCache) {
  const reviewers = Array.isArray(pr.reviewers) ? pr.reviewers : [];
  const repositoryId = pr.repository && pr.repository.id;
  const isMergeCodeTarget = isMergeCodeBranch(pr.targetRefName);
  const approval = buildApprovalSummary(reviewers);
  const statusSnapshot = await getStatusSnapshot(context, pr, repositoryId, isMergeCodeTarget, branchBuildCache);
  return {
    id: pr.pullRequestId,
    title: pr.title || '',
    repository: pr.repository && pr.repository.name || '',
    repositoryId: repositoryId,
    targetBranch: pr.targetRefName || '',
    sourceBranch: pr.sourceRefName || '',
    status: pr.status || '',
    mergeStatus: pr.mergeStatus || '',
    creationDate: pr.creationDate,
    closedDate: pr.closedDate || pr.completionDate || null,
    approvedAt: log.approvedAt,
    approval: approval,
    statusSnapshot: statusSnapshot,
    url: pr.repository
      ? 'https://dev.azure.com/' + encodeURIComponent(cfg.org) + '/' + encodeURIComponent(cfg.project) +
        '/_git/' + encodeURIComponent(pr.repository.name) + '/pullrequest/' + pr.pullRequestId
      : ''
  };
}

async function getStatusSnapshot(context, pr, repositoryId, isMergeCodeTarget, branchBuildCache) {
  try {
    if (!repositoryId || !pr || !pr.pullRequestId) {
      return ado.summarizeStatusSnapshot(pr, [], isMergeCodeTarget ? null : undefined, [], []);
    }

    const statusesResult = await ado.getPullRequestStatuses(repositoryId, pr.pullRequestId);
    const statuses = statusesResult.ok && statusesResult.body && Array.isArray(statusesResult.body.value)
      ? statusesResult.body.value
      : [];

    const policyResult = await ado.getPolicyEvaluations(pr.pullRequestId);
    const policies = policyResult.ok && policyResult.body && Array.isArray(policyResult.body.value)
      ? policyResult.body.value
      : [];

    const buildsResult = await getCachedBuildsForBranch(branchBuildCache, repositoryId, pr.targetRefName);
    const buildRuns = buildsResult.ok && buildsResult.body && Array.isArray(buildsResult.body.value)
      ? buildsResult.body.value
      : [];

    return ado.summarizeStatusSnapshot(pr, statuses, isMergeCodeTarget ? null : undefined, policies, buildRuns);
  } catch (e) {
    if (context && context.log && context.log.warn) {
      context.log.warn('Exception scan status lookup failed for #' + (pr && pr.pullRequestId) + ': ' + e.message);
    }
    return ado.summarizeStatusSnapshot(pr, [], isMergeCodeTarget ? null : undefined, [], []);
  }
}

async function getCachedBuildsForBranch(cache, repositoryId, branchName) {
  const key = String(repositoryId || '') + '|' + String(branchName || '').toLowerCase();
  if (cache[key]) return cache[key];
  const result = await ado.getBuildsForBranch(repositoryId, branchName, 20);
  cache[key] = result;
  return result;
}

function buildApprovalSummary(reviewers) {
  const people = reviewers.filter(r => r && r.isContainer !== true);
  const required = reviewers.filter(r => r && r.isRequired === true);
  const rejectedCount = people.filter(r => Number(r.vote) <= -10).length;
  const hasRequiredReviewers = required.length > 0;
  const approvedCount = hasRequiredReviewers
    ? required.filter(r => Number(r.vote) >= 10).length
    : people.filter(r => Number(r.vote) >= 10).length;
  const requiredCount = hasRequiredReviewers ? required.length : Math.max(1, approvedCount);
  return {
    approvedCount: approvedCount,
    requiredCount: requiredCount,
    rejectedCount: rejectedCount,
    status: rejectedCount > 0 ? 'rejected' : approvedCount >= requiredCount ? 'complete' : 'pending'
  };
}

function isMergeCodeBranch(refName) {
  return String(refName || '').toLowerCase().includes('mergecode');
}

module.exports.scanExceptions = scanExceptions;
