/**
 * POST /api/daily-summary
 *
 * ส่ง Teams notification สรุป PR รายวันเวลา 18:00 (Asia/Bangkok)
 * แยกจาก exception/build notification เดิม
 */

const attentionUtil = require('../shared/attention');

async function dailySummaryHandler(context, req) {
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

    const suppliedToken = req.headers &&
      (req.headers['x-daily-summary-token'] || req.headers['X-Daily-Summary-Token']);
    if (suppliedToken !== expectedToken) {
      jsonResponse(401, { ok: false, error: 'Unauthorized' });
      return;
    }

    const requestOptions = parseRequestOptions(req.body);
    const summary = await buildDailySummary(context, requestOptions.reportDate);
    const eventKey = requestOptions.testMode
      ? 'teams:daily-summary-test:' + summary.dateKey + ':' + Date.now()
      : 'teams:daily-summary:' + summary.dateKey;
    const sp = require('../shared/sharepoint-client');
    if (!requestOptions.testMode && await dailySummaryAlreadySent(sp, summary, eventKey)) {
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
    const result = await notifier.sendTeamsCard({ text: buildDailySummaryMessage(summary, requestOptions.testMode) });
    if (result.ok) {
      await sp.addLogItem(sp.buildLogFields({
        prId: 0,
        action: requestOptions.testMode ? 'Test Notification Sent' : 'Notification Sent',
        user: requestOptions.requestedBy || 'System',
        repository: requestOptions.testMode ? 'Daily Summary Test' : 'Daily Summary',
        prTitle: (requestOptions.testMode ? '[TEST] ' : '') + 'Daily PR Summary - ' + summary.dateLabel,
        targetBranch: summary.targetBranch,
        result: requestOptions.testMode ? 'Test daily summary sent' : 'Daily summary sent',
        reason: buildLogReason(result.status, requestOptions),
        source: requestOptions.source,
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

async function buildDailySummary(context, reportDate) {
  const ado = require('../shared/ado-client');
  const cfg = ado.getConfig();
  const targetPrefix = (process.env.ADO_TARGET_BRANCH || 'refs/heads/staging').toLowerCase();
  const reviewerGroup = process.env.ADO_REVIEWER_GROUP || 'IT Support Approve';
  const range = getBangkokDateRange(reportDate);

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
  const batchSize = 15;
  for (let i = 0; i < statusTargets.length; i += batchSize) {
    const batch = statusTargets.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(pr => buildPrSummaryRow(context, ado, cfg, pr)));
    rows.push(...batchResults);
  }

  const failedRows = rows.filter(row => row.issueType === 'build_failed' || row.issueType === 'policy_failed');
  const rejectedRows = rows.filter(row => row.approvalStatus === 'rejected');
  const attentionRows = rows
    .filter(row => row.status === 'active' && row.attention && Number(row.attention.rank) >= 2)
    .sort(attentionUtil.sortByAttention);
  const criticalRows = attentionRows.filter(row => row.attention && Number(row.attention.rank) >= 4);
  const warningRows = attentionRows.filter(row => row.attention && Number(row.attention.rank) >= 2 && Number(row.attention.rank) < 4);
  const staleRows = attentionRows.filter(row => row.attention && row.attention.status === 'stale');
  const abandonedRows = abandonedToday.map(pr => buildBasicRow(cfg, pr));

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
    abandonedItems: abandonedRows.slice(0, 5)
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
  row.attention = attentionUtil.buildAttention(pr, approval, snapshot, isMergeCodeBranch(pr.targetRefName));
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
    let buildRuns = [];
    if (isMergeCodeBranch(pr.targetRefName) && !statuses.some(ado.isBuildStatus)) {
      const buildsResult = await ado.getBuildsForBranch(repositoryId, pr.targetRefName, 10);
      buildRuns = buildsResult.ok && buildsResult.body && Array.isArray(buildsResult.body.value)
        ? buildsResult.body.value
        : [];
    }
    return ado.summarizeStatusSnapshot(pr, statuses, null, policies, buildRuns);
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

function buildDailySummaryMessage(summary, testMode) {
  const c = summary.counts || {};
  const lines = [
    '📊 **' + (testMode ? '[TEST] ' : '') + 'Daily PR Summary - Staging**',
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
  appendItems(lines, '🟠 Abandoned today', summary.abandonedItems, item =>
    '#' + item.id + ' ' + item.repository + ' - ' + trimText(item.title, 80),
    true);

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

function getBangkokDateRange(reportDate) {
  const offsetMs = 7 * 60 * 60 * 1000;
  let year;
  let month;
  let date;
  if (reportDate) {
    const parts = String(reportDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!parts) throw new Error('reportDate must use YYYY-MM-DD format');
    year = Number(parts[1]);
    month = Number(parts[2]) - 1;
    date = Number(parts[3]);
    const check = new Date(Date.UTC(year, month, date));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month || check.getUTCDate() !== date) {
      throw new Error('reportDate is not a valid calendar date');
    }
  } else {
    const now = new Date();
    const bkkNow = new Date(now.getTime() + offsetMs);
    year = bkkNow.getUTCFullYear();
    month = bkkNow.getUTCMonth();
    date = bkkNow.getUTCDate();
  }
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

function parseRequestOptions(body) {
  const payload = body && typeof body === 'object' ? body : {};
  return {
    reportDate: payload.reportDate ? String(payload.reportDate).trim() : '',
    scheduledFor: payload.scheduledFor ? String(payload.scheduledFor).trim() : '',
    testMode: payload.testMode === true,
    requestedBy: payload.requestedBy ? String(payload.requestedBy).trim() : '',
    source: payload.source === 'Dashboard Test'
      ? 'Dashboard Test Daily Summary'
      : (payload.source === 'Logic Apps'
        ? 'Logic Apps Daily Summary'
        : (payload.source === 'Power Automate'
          ? 'Power Automate Daily Summary'
          : 'Teams Daily Summary'))
  };
}

function buildLogReason(teamsStatus, requestOptions) {
  const details = ['Teams status ' + teamsStatus];
  if (requestOptions.scheduledFor) details.push('scheduledFor ' + requestOptions.scheduledFor);
  return details.join(' | ');
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

dailySummaryHandler.buildDailySummary = buildDailySummary;
dailySummaryHandler.getBangkokDateRange = getBangkokDateRange;
dailySummaryHandler.parseRequestOptions = parseRequestOptions;
dailySummaryHandler.buildDailySummaryMessage = buildDailySummaryMessage;
module.exports = dailySummaryHandler;
