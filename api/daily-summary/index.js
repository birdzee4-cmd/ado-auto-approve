/**
 * POST /api/daily-summary
 *
 * ส่ง Teams notification สรุป PR รายวันเวลา 18:00 (Asia/Bangkok)
 * แยกจาก exception/build notification เดิม
 */

module.exports = async function (context, req) {
  function jsonResponse(status, payload) {
    context.res = {
      status: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    };
  }

  try {
    const expectedToken = process.env.DAILY_SUMMARY_TOKEN;
    if (!expectedToken) {
      jsonResponse(503, {
        ok: false,
        error: 'DAILY_SUMMARY_TOKEN is not configured'
      });
      return;
    }

    const suppliedToken = (req.headers && (req.headers['x-daily-summary-token'] || req.headers['X-Daily-Summary-Token'])) ||
      (req.query && req.query.token);
    if (suppliedToken !== expectedToken) {
      jsonResponse(401, { ok: false, error: 'Unauthorized' });
      return;
    }

    const summary = await buildDailySummary(context);
    const eventKey = 'teams:daily-summary:' + summary.dateKey;
    const sp = require('../shared/sharepoint-client');
    if (await dailySummaryAlreadySent(sp, summary, eventKey)) {
      jsonResponse(200, {
        ok: true,
        skipped: true,
        reason: 'duplicate',
        eventKey: eventKey,
        summary: summary
      });
      return;
    }

    const notifier = require('../shared/teams-notifier');
    const result = await notifier.sendTeamsCard({ text: buildDailySummaryMessage(summary) });
    if (result.ok) {
      await sp.addLogItem(sp.buildLogFields({
        prId: 0,
        action: 'Notification Sent',
        user: 'System',
        repository: 'Daily Summary',
        prTitle: 'Daily PR Summary - ' + summary.dateLabel,
        targetBranch: summary.targetBranch,
        result: 'Daily summary sent',
        reason: 'Teams status ' + result.status,
        source: 'Teams Daily Summary',
        eventKey: eventKey,
        lastCheckedAt: summary.generatedAt
      }));
    }

    jsonResponse(result.ok ? 200 : 502, {
      ok: result.ok,
      teamsStatus: result.status,
      eventKey: eventKey,
      summary: summary
    });
  } catch (err) {
    context.log.error('Daily summary failed:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};

async function buildDailySummary(context) {
  const ado = require('../shared/ado-client');
  const cfg = ado.getConfig();
  const targetPrefix = (process.env.ADO_TARGET_BRANCH || 'refs/heads/staging').toLowerCase();
  const reviewerGroup = process.env.ADO_REVIEWER_GROUP || 'IT Support Approve';
  const range = getBangkokTodayRange();

  const allPrs = await fetchAllPullRequests(ado, cfg.org, cfg.project);
  const relevant = allPrs.filter(pr => {
    const targetRef = String(pr.targetRefName || '').toLowerCase();
    return (targetRef.startsWith(targetPrefix) || isMergeCodeBranch(targetRef)) &&
      ado.hasReviewerGroup(pr, reviewerGroup);
  });

  const createdToday = relevant.filter(pr => isWithin(pr.creationDate, range.startUtcMs, range.endUtcMs));
  const completedToday = relevant.filter(pr => {
    if (String(pr.status || '').toLowerCase() !== 'completed') return false;
    return isWithin(getClosedDate(pr), range.startUtcMs, range.endUtcMs);
  });
  const abandonedToday = relevant.filter(pr => {
    if (String(pr.status || '').toLowerCase() !== 'abandoned') return false;
    return isWithin(getClosedDate(pr), range.startUtcMs, range.endUtcMs);
  });
  const activeNow = relevant.filter(pr => String(pr.status || '').toLowerCase() === 'active');

  const statusTargets = activeNow.concat(completedToday).slice(0, 80);
  const rows = [];
  for (const pr of statusTargets) {
    rows.push(await buildPrSummaryRow(context, ado, cfg, pr));
  }

  const failedRows = rows.filter(row => row.issueType === 'build_failed' || row.issueType === 'policy_failed');
  const rejectedRows = rows.filter(row => row.approvalStatus === 'rejected');
  const attentionRows = rows
    .filter(row => row.status === 'active' && row.attention && Number(row.attention.rank) >= 2)
    .sort(sortByAttention);
  const criticalRows = attentionRows.filter(row => row.attention && Number(row.attention.rank) >= 4);
  const warningRows = attentionRows.filter(row => row.attention && Number(row.attention.rank) >= 2 && Number(row.attention.rank) < 4);
  const staleRows = attentionRows.filter(row => row.attention && row.attention.status === 'stale');
  const completedRows = completedToday.map(pr => buildBasicRow(cfg, pr));

  return {
    dateLabel: range.dateLabel,
    dateKey: range.dateKey,
    generatedAt: new Date().toISOString(),
    targetBranch: targetPrefix,
    reviewerGroup: reviewerGroup,
    counts: {
      createdToday: createdToday.length,
      completedToday: completedToday.length,
      abandonedToday: abandonedToday.length,
      activeNow: activeNow.length,
      failedOrPolicyFailed: failedRows.length,
      rejectedActive: rejectedRows.length,
      attentionCritical: criticalRows.length,
      attentionWarning: warningRows.length,
      staleActive: staleRows.length
    },
    failedItems: failedRows.slice(0, 8),
    attentionItems: attentionRows.slice(0, 8),
    rejectedItems: rejectedRows.slice(0, 5),
    completedItems: completedRows.slice(0, 5)
  };
}

async function fetchPullRequests(ado, org, project, status, top) {
  const path = '/' + encodeURIComponent(org) + '/' + encodeURIComponent(project) +
    '/_apis/git/pullrequests?api-version=7.0' +
    '&searchCriteria.status=' + encodeURIComponent(status) +
    '&$top=' + (top || 100);
  const result = await ado.adoRequest('GET', path);
  if (!result.ok || !result.body || !Array.isArray(result.body.value)) {
    throw new Error('ADO pull request lookup failed: HTTP ' + result.status);
  }
  return result.body.value || [];
}

async function fetchAllPullRequests(ado, org, project) {
  const statuses = ['active', 'completed', 'abandoned'];
  const seen = new Map();
  for (const status of statuses) {
    const prs = await fetchPullRequests(ado, org, project, status, 200);
    for (const pr of prs) {
      if (pr && pr.pullRequestId) seen.set(String(pr.pullRequestId), pr);
    }
  }
  return Array.from(seen.values());
}

async function buildPrSummaryRow(context, ado, cfg, pr) {
  const repositoryId = pr.repository && pr.repository.id;
  const snapshot = await getStatusSnapshot(context, ado, pr, repositoryId);
  const approval = buildApprovalSummary(pr.reviewers || []);
  const row = buildBasicRow(cfg, pr);
  row.approvalStatus = approval.status;
  row.approvals = (approval.approvedCount || 0) + '/' + (approval.requiredCount || 0);
  row.build = [snapshot.buildStatus, snapshot.buildResult].filter(Boolean).join(' / ') || '-';
  row.policy = snapshot.policyStatus || '-';
  row.issueType = getIssueType(snapshot);
  row.attention = buildAttention(pr, approval, snapshot, isMergeCodeBranch(pr.targetRefName));
  return row;
}

async function getStatusSnapshot(context, ado, pr, repositoryId) {
  try {
    if (!repositoryId || !pr || !pr.pullRequestId) return ado.summarizeStatusSnapshot(pr, [], null);
    const statusesResult = await ado.getPullRequestStatuses(repositoryId, pr.pullRequestId);
    const statuses = statusesResult.ok && statusesResult.body && Array.isArray(statusesResult.body.value)
      ? statusesResult.body.value
      : [];
    const policyResult = await ado.getPolicyEvaluations(pr.pullRequestId);
    const policies = policyResult.ok && policyResult.body && Array.isArray(policyResult.body.value)
      ? policyResult.body.value
      : [];
    return ado.summarizeStatusSnapshot(pr, statuses, null, policies);
  } catch (e) {
    if (context && context.log && context.log.warn) {
      context.log.warn('Daily summary status lookup failed for #' + (pr && pr.pullRequestId) + ': ' + e.message);
    }
    return ado.summarizeStatusSnapshot(pr, [], null);
  }
}

function buildBasicRow(cfg, pr) {
  return {
    id: pr.pullRequestId,
    title: pr.title || '',
    repository: pr.repository && pr.repository.name || '',
    createdBy: pr.createdBy && pr.createdBy.displayName || '',
    status: pr.status || '',
    closedDate: getClosedDate(pr),
    url: pr.repository && pr.repository.name
      ? 'https://dev.azure.com/' + cfg.org + '/' + cfg.project + '/_git/' + pr.repository.name + '/pullrequest/' + pr.pullRequestId
      : ''
  };
}

function buildApprovalSummary(reviewers) {
  const people = (Array.isArray(reviewers) ? reviewers : []).filter(r => r && r.isContainer !== true);
  const required = (Array.isArray(reviewers) ? reviewers : []).filter(r => r && r.isRequired === true);
  const reviewersToCount = required.length > 0 ? required : people;
  const approvedCount = reviewersToCount.filter(r => Number(r.vote) >= 10).length;
  const requiredCount = reviewersToCount.length;
  const hasRejected = people.some(r => Number(r.vote) <= -10) || required.some(r => Number(r.vote) <= -10);
  return {
    approvedCount: approvedCount,
    requiredCount: requiredCount,
    status: hasRejected ? 'rejected' : (requiredCount > 0 && approvedCount >= requiredCount ? 'complete' : 'pending')
  };
}

function getIssueType(snapshot) {
  const buildResult = String(snapshot.buildResult || '').toLowerCase();
  const policyStatus = String(snapshot.policyStatus || '').toLowerCase();
  if (buildResult === 'failed' || buildResult === 'error') return 'build_failed';
  if (policyStatus === 'failed') return 'policy_failed';
  return '';
}

function buildAttention(pr, approval, statusSnapshot, isMergeCodeTarget) {
  const createdMs = Date.parse(pr && pr.creationDate || '');
  const ageMs = Number.isFinite(createdMs) ? Math.max(Date.now() - createdMs, 0) : 0;
  const ageHours = ageMs / (60 * 60 * 1000);
  const ageLabel = formatAge(ageMs);
  const buildResult = String(statusSnapshot && statusSnapshot.buildResult || '').toLowerCase();
  const buildStatus = String(statusSnapshot && statusSnapshot.buildStatus || '').toLowerCase();
  const policyStatus = String(statusSnapshot && statusSnapshot.policyStatus || '').toLowerCase();
  const approvalStatus = String(approval && approval.status || '').toLowerCase();
  const hasBuildStatus = buildResult && buildResult !== 'unknown' && buildResult !== 'no_status';

  if (isMergeCodeTarget) {
    return attention('manual', 1, 'Manual in ADO', ageLabel, 'MergeCode target branch requires Azure DevOps action', ageHours);
  }
  if (buildResult === 'failed' || buildResult === 'error') {
    return attention('critical', 4, 'Build Failed', ageLabel, 'Build result is ' + buildResult, ageHours);
  }
  if (approvalStatus === 'rejected') {
    return attention('critical', 4, 'Rejected', ageLabel, 'At least one reviewer rejected this PR', ageHours);
  }
  if (policyStatus === 'failed') {
    return attention('critical', 4, 'Policy Failed', ageLabel, 'Azure DevOps policy evaluation failed', ageHours);
  }

  const buildPending = buildResult === 'pending' || buildStatus === 'in_progress';
  const policyPending = policyStatus === 'pending';
  if (approvalStatus === 'complete') {
    if ((buildPending || policyPending) && ageHours >= 1) {
      return attention('warning', 3, 'Completing slow', ageLabel, 'Approvals complete, waiting for build or policy', ageHours);
    }
    return attention('ready', 1, 'Ready', ageLabel, 'Approvals are complete', ageHours);
  }

  if (!hasBuildStatus && policyStatus === 'unknown' && ageHours >= 4) {
    return attention('warning', 3, 'No status 4h+', ageLabel, 'No build or policy status found yet', ageHours);
  }
  if (ageHours >= 24) {
    return attention('stale', 3, 'Stale 1d+', ageLabel, 'PR has been waiting more than one day', ageHours);
  }
  if (ageHours >= 4) {
    return attention('warning', 2, 'Waiting 4h+', ageLabel, 'Approval is still pending', ageHours);
  }
  if (ageHours >= 2) {
    return attention('watch', 1, 'Waiting ' + ageLabel, ageLabel, 'Approval is pending', ageHours);
  }
  return attention('normal', 0, 'New ' + ageLabel, ageLabel, 'Within normal waiting time', ageHours);
}

function attention(status, rank, label, ageLabel, reason, ageHours) {
  return {
    status: status,
    rank: rank,
    label: label,
    ageLabel: ageLabel,
    reason: reason,
    ageHours: Math.round(ageHours * 10) / 10
  };
}

function sortByAttention(a, b) {
  const ar = a && a.attention ? Number(a.attention.rank) || 0 : 0;
  const br = b && b.attention ? Number(b.attention.rank) || 0 : 0;
  if (br !== ar) return br - ar;
  const ah = a && a.attention ? Number(a.attention.ageHours) || 0 : 0;
  const bh = b && b.attention ? Number(b.attention.ageHours) || 0 : 0;
  return bh - ah;
}

function buildDailySummaryMessage(summary) {
  const c = summary.counts || {};
  const lines = [
    '📊 **Daily PR Summary - Staging**',
    '',
    'สรุป Pull Request ประจำวันที่ **' + summary.dateLabel + '**',
    '',
    '| Metric | Count |',
    '| --- | ---: |',
    '| New PR today | ' + (c.createdToday || 0) + ' |',
    '| Completed today | ' + (c.completedToday || 0) + ' |',
    '| Active now | ' + (c.activeNow || 0) + ' |',
    '| Critical attention | ' + (c.attentionCritical || 0) + ' |',
    '| Warning attention | ' + (c.attentionWarning || 0) + ' |',
    '| Stale active | ' + (c.staleActive || 0) + ' |',
    '| Build/Policy failed | ' + (c.failedOrPolicyFailed || 0) + ' |',
    '| Rejected active | ' + (c.rejectedActive || 0) + ' |',
    '| Abandoned today | ' + (c.abandonedToday || 0) + ' |',
    ''
  ];

  appendItems(lines, '🚦 PR attention / aging', summary.attentionItems, item =>
    '#' + item.id + ' ' + item.repository + ' - ' + item.attention.label + ' (' + item.attention.ageLabel + ') - ' + item.attention.reason,
    true);
  appendItems(lines, '⚠️ Items needing attention', summary.failedItems, item =>
    '#' + item.id + ' ' + item.repository + ' - ' + item.build + ' / Policy: ' + item.policy,
    true);
  appendItems(lines, '❌ Rejected active PRs', summary.rejectedItems, item =>
    '#' + item.id + ' ' + item.repository + ' - approvals ' + item.approvals,
    true);
  appendItems(lines, '✅ Recently completed today', summary.completedItems, item =>
    '#' + item.id + ' ' + item.repository + ' - ' + trimText(item.title, 80),
    false);

  lines.push('');
  lines.push('_Daily Summary notification is separate from Build/Policy exception alerts._');
  return lines.join('\n');
}

function appendItems(lines, title, items, formatter, includeLink) {
  if (!Array.isArray(items) || items.length === 0) return;
  lines.push('**' + title + '**');
  for (const item of items) {
    const label = formatter(item);
    lines.push('- ' + (includeLink && item.url ? '[' + safe(label) + '](' + item.url + ')' : safe(label)));
  }
  lines.push('');
}

function getBangkokTodayRange() {
  const offsetMs = 7 * 60 * 60 * 1000;
  const now = new Date();
  const bkkNow = new Date(now.getTime() + offsetMs);
  const year = bkkNow.getUTCFullYear();
  const month = bkkNow.getUTCMonth();
  const date = bkkNow.getUTCDate();
  const startUtcMs = Date.UTC(year, month, date) - offsetMs;
  const endUtcMs = startUtcMs + (24 * 60 * 60 * 1000);
  return {
    startUtcMs: startUtcMs,
    endUtcMs: endUtcMs,
    dateKey: [
      String(year).padStart(4, '0'),
      String(month + 1).padStart(2, '0'),
      String(date).padStart(2, '0')
    ].join('-'),
    dateLabel: new Date(startUtcMs).toLocaleDateString('th-TH', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  };
}

function isWithin(value, startUtcMs, endUtcMs) {
  const ts = Date.parse(value || '');
  return Number.isFinite(ts) && ts >= startUtcMs && ts < endUtcMs;
}

function getClosedDate(pr) {
  return pr.closedDate || pr.completionDate ||
    (pr.lastMergeCommit && pr.lastMergeCommit.committer && pr.lastMergeCommit.committer.date) ||
    '';
}

function isMergeCodeBranch(refName) {
  return String(refName || '').toLowerCase().includes('mergecode');
}

function trimText(value, max) {
  const text = String(value || '');
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

function formatAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return '-';
  const minutes = Math.floor(ageMs / (60 * 1000));
  if (minutes < 1) return '<1m';
  if (minutes < 60) return minutes + 'm';
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes > 0 ? hours + 'h ' + remainingMinutes + 'm' : hours + 'h';
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? days + 'd ' + remainingHours + 'h' : days + 'd';
}

function safe(value) {
  return String(value || '-').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

async function dailySummaryAlreadySent(sp, summary, eventKey) {
  const byEventKey = await sp.getLogByEventKey(eventKey);
  const eventKeyItems = byEventKey.ok && byEventKey.body && Array.isArray(byEventKey.body.value)
    ? byEventKey.body.value
    : [];
  if (eventKeyItems.length > 0) return true;

  const markerLogs = await sp.getLogForPR(0);
  const rows = markerLogs.ok && markerLogs.body && Array.isArray(markerLogs.body.value)
    ? markerLogs.body.value.map(item => item.fields || {})
    : [];
  return rows.some(fields => {
    const markerText = [
      fields.PR_Title,
      fields.Result,
      fields.Reason,
      fields.Title
    ].join(' ').toLowerCase();
    return markerText.includes('daily summary') &&
      getBangkokDateKey(fields.Last_Checked_At) === summary.dateKey;
  });
}

function getBangkokDateKey(value) {
  const ts = Date.parse(value || '');
  if (!Number.isFinite(ts)) return '';
  const offsetMs = 7 * 60 * 60 * 1000;
  const bkk = new Date(ts + offsetMs);
  return [
    String(bkk.getUTCFullYear()).padStart(4, '0'),
    String(bkk.getUTCMonth() + 1).padStart(2, '0'),
    String(bkk.getUTCDate()).padStart(2, '0')
  ].join('-');
}
