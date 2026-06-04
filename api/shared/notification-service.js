const teams = require('./teams-notifier');
const sp = require('./sharepoint-client');

function isTeamsEnabled() {
  return !!process.env.TEAMS_WEBHOOK_URL && process.env.TEAMS_EXCEPTION_NOTIFICATIONS !== 'false';
}

async function notifyPrIssueIfNeeded(context, pr, options) {
  if (!isTeamsEnabled() || !pr || !pr.id) {
    return { skipped: true, reason: 'disabled_or_missing_pr' };
  }

  const opts = options || {};
  const scope = normalizeKey(opts.scope || 'active');
  const issue = getPrIssue(pr, scope);
  if (!issue) {
    return { skipped: true, reason: 'no_exception' };
  }

  const eventKey = 'teams:pr-issue:' + scope + ':' + pr.id + ':' + issue.key;
  return sendOnce(context, eventKey, {
    prId: pr.id,
    action: 'Notification Sent',
    user: 'System',
    repository: pr.repository,
    prTitle: pr.title,
    targetBranch: pr.targetBranch,
    result: issue.title,
    reason: issue.message,
    source: 'Teams Notification',
    eventKey: eventKey,
    statusSnapshot: pr.statusSnapshot,
    adoPrUrl: pr.url
  }, buildPrIssueMessage(pr, issue, scope));
}

async function notifyRejected(context, opts) {
  if (!isTeamsEnabled()) return { skipped: true, reason: 'disabled' };
  const prId = opts && opts.prId;
  const eventKey = 'teams:rejected:' + prId + ':' + normalizeIdentity(opts.user || 'unknown');
  return sendOnce(context, eventKey, {
    prId: prId,
    action: 'Notification Sent',
    user: 'System',
    repository: opts.repository,
    prTitle: opts.prTitle,
    targetBranch: opts.targetBranch,
    result: 'PR rejected',
    reason: opts.reason || '',
    source: 'Teams Notification',
    eventKey: eventKey,
    statusSnapshot: opts.statusSnapshot,
    adoPrUrl: opts.adoPrUrl
  }, buildRejectedMessage(opts));
}

async function notifyOperationFailed(context, opts) {
  if (!isTeamsEnabled()) return { skipped: true, reason: 'disabled' };
  const prId = opts && opts.prId;
  const eventKey = 'teams:operation-failed:' + prId + ':' + normalizeKey(opts.operation || 'unknown');
  return sendOnce(context, eventKey, {
    prId: prId,
    action: 'Notification Sent',
    user: 'System',
    repository: opts.repository,
    prTitle: opts.prTitle,
    targetBranch: opts.targetBranch,
    result: opts.operation + ' failed',
    reason: opts.error || '',
    source: 'Teams Notification',
    eventKey: eventKey,
    statusSnapshot: opts.statusSnapshot,
    adoPrUrl: opts.adoPrUrl
  }, buildOperationFailedMessage(opts));
}

async function sendOnce(context, eventKey, logOptions, message) {
  try {
    const history = await sp.getLogForPR(logOptions.prId);
    const existing = history.ok && history.body && Array.isArray(history.body.value)
      ? history.body.value.map(item => item.fields || {})
      : [];
    if (existing.some(item => item.Event_Key === eventKey)) {
      return { skipped: true, reason: 'duplicate', eventKey: eventKey };
    }

    const result = await teams.sendTeamsCard({ text: message });
    if (!result.ok) {
      if (context && context.log && context.log.warn) {
        context.log.warn('Teams notification failed: HTTP ' + result.status);
      }
      return { ok: false, status: result.status, eventKey: eventKey };
    }

    const s = logOptions.statusSnapshot || {};
    await sp.addLogItem(sp.buildLogFields({
      prId: logOptions.prId,
      action: logOptions.action,
      user: logOptions.user,
      repository: logOptions.repository,
      prTitle: logOptions.prTitle,
      targetBranch: logOptions.targetBranch,
      result: logOptions.result,
      reason: logOptions.reason,
      source: logOptions.source,
      eventKey: eventKey,
      buildStatus: s.buildStatus,
      buildResult: s.buildResult,
      policyStatus: s.policyStatus,
      mergeStatus: s.mergeStatus,
      autoCompleteStatus: s.autoCompleteStatus,
      lastCheckedAt: s.lastCheckedAt,
      adoBuildUrl: s.adoBuildUrl,
      adoPrUrl: logOptions.adoPrUrl
    }));
    return { ok: true, eventKey: eventKey };
  } catch (e) {
    if (context && context.log && context.log.warn) {
      context.log.warn('Teams notification skipped/failed: ' + e.message);
    }
    return { ok: false, error: e.message, eventKey: eventKey };
  }
}

function getPrIssue(pr, scope) {
  const approval = pr.approval || {};
  const isRecentlyCompleted = scope === 'recently-completed';
  const prStatus = String(pr.status || '').toLowerCase();
  if (!isRecentlyCompleted && approval.status !== 'complete') return null;
  if (isRecentlyCompleted && prStatus !== 'completed') return null;

  const s = pr.statusSnapshot || {};
  const buildResult = String(s.buildResult || '').toLowerCase();
  const policyStatus = String(s.policyStatus || '').toLowerCase();

  if (buildResult === 'failed' || buildResult === 'error') {
    return {
      key: 'build-' + buildResult,
      title: isRecentlyCompleted
        ? 'Build failed after PR completed'
        : 'Build failed after approvals completed',
      message: isRecentlyCompleted
        ? 'PR is completed, but build result is ' + buildResult + '.'
        : 'Approvals are complete, but build result is ' + buildResult + '.'
    };
  }
  if (policyStatus === 'failed') {
    return {
      key: 'policy-failed',
      title: isRecentlyCompleted
        ? 'Policy failed after PR completed'
        : 'Policy failed after approvals completed',
      message: isRecentlyCompleted
        ? 'PR is completed, but Azure DevOps policy evaluation failed.'
        : 'Approvals are complete, but Azure DevOps policy evaluation failed.'
    };
  }
  return null;
}

function buildPrIssueMessage(pr, issue, scope) {
  const a = pr.approval || {};
  const s = pr.statusSnapshot || {};
  const lines = [
    '⚠️ **PR needs attention**',
    '',
    issue.message,
    '',
    '| Field | Value |',
    '| --- | --- |',
    '| **PR** | #' + pr.id + ' |',
    '| **Title** | ' + safe(pr.title) + ' |',
    '| **Repository** | ' + safe(pr.repository) + ' |',
    '| **Scope** | ' + safe(scope === 'recently-completed' ? 'Recently Completed' : 'Active PR Queue') + ' |',
    '| **Approvals** | ' + (a.approvedCount || 0) + '/' + (a.requiredCount || 0) + ' |',
    '| **Build** | ' + safe([s.buildStatus, s.buildResult].filter(Boolean).join(' / ') || '-') + ' |',
    '| **Policy** | ' + safe(s.policyStatus || '-') + ' |'
  ];
  if (pr.url) lines.push('', '🔗 [Open PR in Azure DevOps](' + pr.url + ')');
  return lines.join('\n');
}

function buildRejectedMessage(opts) {
  const lines = [
    '❌ **PR rejected**',
    '',
    '| Field | Value |',
    '| --- | --- |',
    '| **PR** | #' + safe(opts.prId) + ' |',
    '| **Title** | ' + safe(opts.prTitle) + ' |',
    '| **Repository** | ' + safe(opts.repository) + ' |',
    '| **Rejected By** | ' + safe(opts.user) + ' |',
    '| **Reason** | ' + safe(opts.reason || '-') + ' |'
  ];
  if (opts.adoPrUrl) lines.push('', '🔗 [Open PR in Azure DevOps](' + opts.adoPrUrl + ')');
  return lines.join('\n');
}

function buildOperationFailedMessage(opts) {
  const lines = [
    '🚨 **ADO Auto-Approve action failed**',
    '',
    '| Field | Value |',
    '| --- | --- |',
    '| **Operation** | ' + safe(opts.operation) + ' |',
    '| **PR** | #' + safe(opts.prId) + ' |',
    '| **Title** | ' + safe(opts.prTitle) + ' |',
    '| **Repository** | ' + safe(opts.repository) + ' |',
    '| **Triggered By** | ' + safe(opts.user) + ' |',
    '| **Error** | ' + safe(opts.error) + ' |'
  ];
  if (opts.adoPrUrl) lines.push('', '🔗 [Open PR in Azure DevOps](' + opts.adoPrUrl + ')');
  return lines.join('\n');
}

function safe(value) {
  return String(value || '-').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function normalizeIdentity(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeKey(value) {
  return normalizeIdentity(value).replace(/[^a-z0-9_-]+/g, '-');
}

module.exports = {
  notifyPrIssueIfNeeded,
  notifyRejected,
  notifyOperationFailed
};
