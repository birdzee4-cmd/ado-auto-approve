const teams = require('./teams-notifier');
const sp = require('./sharepoint-client');

function isTeamsEnabled() {
  return !!process.env.TEAMS_WEBHOOK_URL && process.env.TEAMS_EXCEPTION_NOTIFICATIONS !== 'false';
}

function isManualMergeCodeTeamsEnabled() {
  return !!process.env.TEAMS_WEBHOOK_URL && process.env.TEAMS_MANUAL_MERGECODE_NOTIFICATIONS !== 'false';
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

async function notifyManualMergeCodeIfNeeded(context, pr, options) {
  if (!isManualMergeCodeTeamsEnabled() || !pr || !pr.id) {
    return { skipped: true, reason: 'disabled_or_missing_pr' };
  }
  if (!isMergeCodeTarget(pr)) {
    return { skipped: true, reason: 'not_mergecode' };
  }

  const opts = options || {};
  const baseEventKey = buildManualMergeCodeEventKey(pr);
  const initialEventKey = baseEventKey + ':created';
  const initialResult = await sendOnce(
    context,
    initialEventKey,
    buildManualMergeCodeLogOptions(pr, initialEventKey, 0),
    buildManualMergeCodeMessage(pr, 0)
  );

  if (!initialResult || initialResult.reason !== 'duplicate' || opts.allowReminder === false) {
    return initialResult;
  }

  const reminderHours = getDueManualReminderHours(pr, opts.now);
  if (!reminderHours) return initialResult;

  const reminderEventKey = baseEventKey + ':reminder:' + reminderHours + 'h';
  return sendOnce(
    context,
    reminderEventKey,
    buildManualMergeCodeLogOptions(pr, reminderEventKey, reminderHours),
    buildManualMergeCodeMessage(pr, reminderHours)
  );
}

async function sendOnce(context, eventKey, logOptions, message) {
  try {
    const existing = await sp.getLogByEventKey(eventKey);
    const existingItems = existing.ok && existing.body && Array.isArray(existing.body.value)
      ? existing.body.value
      : [];
    if (existingItems.length > 0) {
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
  const isApprovalLogScan = scope === 'approval-log';
  const prStatus = String(pr.status || '').toLowerCase();
  if (!isRecentlyCompleted && !isApprovalLogScan && approval.status !== 'complete') return null;
  if (isRecentlyCompleted && prStatus !== 'completed') return null;

  const s = pr.statusSnapshot || {};
  const buildResult = String(s.buildResult || '').toLowerCase();
  const policyStatus = String(s.policyStatus || '').toLowerCase();
  const buildRunId = normalizeKey(s.buildRunId || 'no-build-id');

  if (buildResult === 'failed' || buildResult === 'error') {
    return {
      key: 'build-' + buildResult + '-' + buildRunId,
      title: isRecentlyCompleted
        ? 'Build failed after PR completed'
        : isApprovalLogScan
          ? 'Build failed after PR approval'
          : 'Build failed after approvals completed',
      message: isRecentlyCompleted
        ? 'PR is completed, but build result is ' + buildResult + '.'
        : isApprovalLogScan
          ? 'PR has an approval log, and the latest build result is ' + buildResult + '.'
          : 'Approvals are complete, but build result is ' + buildResult + '.'
    };
  }
  if (policyStatus === 'failed') {
    return {
      key: 'policy-failed',
      title: isRecentlyCompleted
        ? 'Policy failed after PR completed'
        : isApprovalLogScan
          ? 'Policy failed after PR approval'
          : 'Policy failed after approvals completed',
      message: isRecentlyCompleted
        ? 'PR is completed, but Azure DevOps policy evaluation failed.'
        : isApprovalLogScan
          ? 'PR has an approval log, and Azure DevOps policy evaluation failed.'
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
    '| **Scope** | ' + safe(scope === 'recently-completed' ? 'Recently Completed' : scope === 'approval-log' ? 'Approval Log Scan' : 'Active PR Queue') + ' |',
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

function buildManualMergeCodeLogOptions(pr, eventKey, reminderHours) {
  return {
    prId: pr.id,
    action: reminderHours ? 'MergeCode Manual Reminder' : 'MergeCode Manual Alert',
    user: 'System',
    repository: pr.repository,
    prTitle: pr.title,
    targetBranch: pr.targetBranch,
    result: reminderHours ? 'Manual action overdue (' + reminderHours + 'h)' : 'Manual action required',
    reason: 'MergeCode target branch requires manual action in Azure DevOps.',
    source: 'Teams Notification',
    eventKey: eventKey,
    statusSnapshot: pr.statusSnapshot,
    adoPrUrl: pr.url
  };
}

function buildManualMergeCodeMessage(pr, reminderHours) {
  const s = pr.statusSnapshot || {};
  const age = formatAge(pr.creationDate);
  const heading = reminderHours
    ? '🔴 **MergeCode Manual overdue — ' + reminderHours + 'h reminder**'
    : '🟠 **Action required — MergeCode Manual**';
  const lines = [
    heading,
    '',
    'PR นี้ต้องดำเนินการแบบ Manual ใน Azure DevOps',
    '',
    '| Field | Value |',
    '| --- | --- |',
    '| **PR** | #' + safe(pr.id) + ' |',
    '| **Title** | ' + safe(pr.title) + ' |',
    '| **Repository** | ' + safe(pr.repository) + ' |',
    '| **Branch** | ' + safe(pr.sourceBranch) + ' → ' + safe(pr.targetBranch) + ' |',
    '| **Created by** | ' + safe(pr.createdBy) + ' |',
    '| **Waiting** | ' + safe(age) + ' |',
    '| **Build** | ' + safe([s.buildStatus, s.buildResult].filter(Boolean).join(' / ') || '-') + ' |',
    '| **Policy** | ' + safe(s.policyStatus || '-') + ' |'
  ];
  if (pr.url) lines.push('', '🔗 [Open PR in Azure DevOps](' + pr.url + ')');
  return lines.join('\n');
}

function buildManualMergeCodeEventKey(pr) {
  const repositoryKey = normalizeKey(pr.repositoryId || pr.repository || 'unknown-repository');
  return 'teams:manual-mergecode:' + repositoryKey + ':' + normalizeKey(pr.id);
}

function isMergeCodeTarget(pr) {
  return pr && (pr.isMergeCodeTarget === true || String(pr.targetBranch || '').toLowerCase().includes('mergecode'));
}

function getDueManualReminderHours(pr, now) {
  const createdMs = Date.parse(pr && pr.creationDate || '');
  if (!Number.isFinite(createdMs)) return 0;
  const nowMs = now == null ? Date.now() : new Date(now).getTime();
  if (!Number.isFinite(nowMs) || nowMs < createdMs) return 0;
  const ageHours = (nowMs - createdMs) / (60 * 60 * 1000);
  const thresholds = getManualReminderHours();
  for (let index = thresholds.length - 1; index >= 0; index -= 1) {
    if (ageHours >= thresholds[index]) return thresholds[index];
  }
  return 0;
}

function getManualReminderHours() {
  const configured = process.env.MERGECODE_REMINDER_HOURS || '4,24';
  return Array.from(new Set(String(configured).split(',')
    .map(value => Number(value.trim()))
    .filter(value => Number.isFinite(value) && value > 0)))
    .sort((a, b) => a - b);
}

function formatAge(creationDate) {
  const createdMs = Date.parse(creationDate || '');
  if (!Number.isFinite(createdMs)) return '-';
  const minutes = Math.max(0, Math.floor((Date.now() - createdMs) / 60000));
  if (minutes < 60) return minutes + 'm';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h ' + (minutes % 60) + 'm';
  return Math.floor(hours / 24) + 'd ' + (hours % 24) + 'h';
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
  notifyOperationFailed,
  notifyManualMergeCodeIfNeeded,
  _test: {
    buildManualMergeCodeEventKey,
    buildManualMergeCodeMessage,
    getDueManualReminderHours,
    getManualReminderHours,
    isMergeCodeTarget
  }
};
