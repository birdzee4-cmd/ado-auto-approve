/**
 * POST /api/monthly-summary
 *
 * Sends the completed previous calendar month to Teams. Recommended schedule:
 * day 1 at 08:00 Asia/Bangkok.
 */

const helpers = require('./helpers');

async function monthlySummaryHandler(context, req) {
  function jsonResponse(status, payload) {
    context.res = {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    };
  }

  try {
    const expectedToken = process.env.MONTHLY_SUMMARY_TOKEN || process.env.DAILY_SUMMARY_TOKEN;
    if (!expectedToken) {
      jsonResponse(503, {
        ok: false,
        error: 'MONTHLY_SUMMARY_TOKEN (or DAILY_SUMMARY_TOKEN) is not configured'
      });
      return;
    }

    const suppliedToken =
      getHeader(req, 'x-monthly-summary-token') ||
      getHeader(req, 'x-daily-summary-token');
    if (suppliedToken !== expectedToken) {
      jsonResponse(401, { ok: false, error: 'Unauthorized' });
      return;
    }

    const options = parseRequestOptions(req && req.body);
    const summary = await buildMonthlySummary(context, options.reportMonth, getReportBaseUrl(req));
    const eventKey = options.testMode
      ? 'teams:monthly-summary-test:' + summary.monthKey + ':' + Date.now()
      : 'teams:monthly-summary:' + summary.monthKey;
    const sp = require('../shared/sharepoint-client');

    if (!options.testMode && await monthlySummaryAlreadySent(sp, eventKey)) {
      jsonResponse(200, {
        ok: true,
        skipped: true,
        reason: 'duplicate',
        eventKey,
        summary
      });
      return;
    }

    const notifier = require('../shared/teams-notifier');
    const result = await notifier.sendTeamsCard({
      text: buildMonthlySummaryMessage(summary, options.testMode)
    });

    if (result.ok) {
      await sp.addLogItem(sp.buildLogFields({
        prId: 0,
        action: options.testMode ? 'Test Notification Sent' : 'Notification Sent',
        user: options.requestedBy || 'System',
        repository: options.testMode ? 'Monthly Summary Test' : 'Monthly Summary',
        prTitle: (options.testMode ? '[TEST] ' : '') + 'Monthly PR Summary - ' + summary.monthLabel,
        targetBranch: summary.targetBranch,
        result: options.testMode ? 'Test monthly summary sent' : 'Monthly summary sent',
        reason: buildLogReason(result.status, options, summary),
        source: options.source,
        eventKey,
        lastCheckedAt: summary.generatedAt
      }));
    }

    jsonResponse(result.ok ? 200 : 502, {
      ok: result.ok,
      teamsStatus: result.status,
      eventKey,
      summary
    });
  } catch (err) {
    context.log.error('Monthly summary failed:', err);
    jsonResponse(500, {
      ok: false,
      error: 'Unexpected server error',
      detail: err.message
    });
  }
}

async function buildMonthlySummary(context, reportMonth, reportBaseUrl) {
  const ado = require('../shared/ado-client');
  const sp = require('../shared/sharepoint-client');
  const cfg = ado.getConfig();
  const range = helpers.getBangkokMonthRange(reportMonth);
  const previousRange = helpers.getPreviousMonthRange(range);
  const targetPrefix = String(process.env.ADO_TARGET_BRANCH || 'refs/heads/staging').toLowerCase();
  const reviewerGroup = process.env.ADO_REVIEWER_GROUP || 'IT Support Approve';

  const allPrs = await helpers.fetchAllPullRequests(ado, cfg.org, cfg.project);
  const relevant = allPrs.filter(pr =>
    helpers.isRelevantPr(ado, pr, targetPrefix, reviewerGroup));
  const currentPrStats = helpers.calculatePrStats(relevant, range);
  const previousPrStats = helpers.calculatePrStats(relevant, previousRange);
  const activeNow = relevant.filter(pr =>
    String(pr.status || '').toLowerCase() === 'active');
  const attention = await helpers.buildAttentionSnapshot(context, ado, cfg, activeNow);

  const [logsResult, previousLogsResult] = await Promise.all([
    sp.getLogItemsRange(range.startIso, range.endIso, 10000),
    sp.getLogItemsRange(previousRange.startIso, previousRange.endIso, 10000)
  ]);
  if (!logsResult.ok) {
    throw new Error('SharePoint monthly log lookup failed: HTTP ' + logsResult.status);
  }
  const logs = getResultItems(logsResult);
  const previousLogs = previousLogsResult.ok ? getResultItems(previousLogsResult) : [];
  const approval = helpers.calculateApprovalStats(logs);
  const previousApproval = helpers.calculateApprovalStats(previousLogs);

  const deployments = await helpers.loadDeploymentArchive(context, sp, range);
  const build = helpers.calculateBuildStats(deployments, range);
  const previousDeployments = range.year === previousRange.year
    ? deployments
    : await helpers.loadDeploymentArchive(context, sp, previousRange);
  const previousBuild = helpers.calculateBuildStats(previousDeployments, previousRange);

  return {
    monthKey: range.monthKey,
    monthLabel: range.monthLabel,
    generatedAt: new Date().toISOString(),
    range: { start: range.startIso, end: range.endIso },
    targetBranch: targetPrefix,
    reviewerGroup,
    pr: Object.assign({}, currentPrStats, {
      createdItems: undefined,
      activeNow: activeNow.length,
      activeMerge: activeNow.filter(pr => helpers.isMergeCodeBranch(pr.targetRefName)).length
    }),
    approval,
    build,
    attention: attention.counts,
    attentionItems: attention.items.slice(0, 5),
    topRepos: helpers.getTopRepositories(currentPrStats.createdItems, 5),
    comparison: {
      created: helpers.buildComparison(currentPrStats.created, previousPrStats.created),
      completed: helpers.buildComparison(currentPrStats.completed, previousPrStats.completed),
      abandoned: helpers.buildComparison(currentPrStats.abandoned, previousPrStats.abandoned),
      autoApproved: helpers.buildComparison(approval.autoApproved, previousApproval.autoApproved),
      failedBuilds: helpers.buildComparison(build.failed, previousBuild.failed)
    },
    dataQuality: {
      logsFetched: logs.length,
      logsTruncated: !!(logsResult.body && logsResult.body.truncated),
      previousLogsAvailable: previousLogsResult.ok,
      prFetched: relevant.length
    },
    reportUrl: buildReportUrl(reportBaseUrl, range)
  };
}

function buildMonthlySummaryMessage(summary, testMode) {
  const pr = summary.pr || {};
  const approval = summary.approval || {};
  const build = summary.build || {};
  const attention = summary.attention || {};
  const comparison = summary.comparison || {};
  const lines = [
    '📅 **' + (testMode ? '[TEST] ' : '') + 'Monthly PR Summary - Staging**',
    '',
    'สรุปประจำเดือน **' + summary.monthLabel + '**',
    'ช่วงข้อมูล: ' + summary.range.start + ' ถึง ' + summary.range.end + ' (Asia/Bangkok)',
    '',
    '**PR Overview**',
    '',
    '| Metric | Count | เทียบเดือนก่อน |',
    '| --- | ---: | ---: |',
    '| New PR | ' + number(pr.created) + ' | ' + formatComparison(comparison.created) + ' |',
    '| Completed | ' + number(pr.completed) + ' | ' + formatComparison(comparison.completed) + ' |',
    '| New PR completed in month | ' + percent(pr.completionRate) + ' | — |',
    '| Abandoned | ' + number(pr.abandoned) + ' | ' + formatComparison(comparison.abandoned) + ' |',
    '| Active now (snapshot) | ' + number(pr.activeNow) + ' | — |',
    '| Active Merge PRs | ' + number(pr.activeMerge) + ' | — |',
    '',
    '**Approval Performance**',
    '',
    '| Metric | Count | เทียบเดือนก่อน |',
    '| --- | ---: | ---: |',
    '| Unique PRs handled | ' + number(approval.uniquePrs) + ' | — |',
    '| Auto Approved | ' + number(approval.autoApproved) + ' | ' + formatComparison(comparison.autoApproved) + ' |',
    '| Manual Approved | ' + number(approval.manualApproved) + ' | — |',
    '| Rejected | ' + number(approval.rejected) + ' | — |',
    '| Hold | ' + number(approval.onHold) + ' | — |',
    '| Auto-Approve rate | ' + percent(approval.autoApproveRate) + ' | — |',
    '',
    '**Build & Deployment**',
    '',
    '| Metric | Count | เทียบเดือนก่อน |',
    '| --- | ---: | ---: |',
    '| Total Builds | ' + number(build.total) + ' | — |',
    '| Build Success | ' + number(build.succeeded) + ' | — |',
    '| Build Failed | ' + number(build.failed) + ' | ' + formatComparison(comparison.failedBuilds) + ' |',
    '| Success rate | ' + percent(build.successRate) + ' | — |',
    '',
    '🚦 **Attention snapshot:** Critical ' + number(attention.critical) +
      ' · Warning ' + number(attention.warning) +
      ' · Stale ' + number(attention.stale) +
      ' · Rejected ' + number(attention.rejected) +
      ' · Build/Policy failed ' + number(attention.failedOrPolicyFailed),
    ''
  ];

  appendRankedItems(lines, '📦 Top repositories by new PR', summary.topRepos,
    item => item.repo + ' — ' + number(item.count));
  appendRankedItems(lines, '⚠️ Top repositories with failed builds', build.topFailedRepos,
    item => item.repo + ' — ' + number(item.count));
  appendLinkedItems(lines, '🚦 PRs needing attention', summary.attentionItems);

  if (summary.dataQuality && summary.dataQuality.logsTruncated) {
    lines.push('⚠️ _Audit log reached the 10,000-row safety limit; approval totals may be incomplete._');
    lines.push('');
  }
  if (summary.reportUrl) {
    lines.push('🔗 [เปิดรายงานประจำเดือน](' + summary.reportUrl + ')');
  }
  lines.push('');
  lines.push('_Monthly Summary is calculated from source data and is not the sum of Daily Summary messages._');
  return lines.join('\n');
}

function appendRankedItems(lines, title, items, formatter) {
  if (!Array.isArray(items) || !items.length) return;
  lines.push('**' + title + '**');
  items.forEach((item, index) =>
    lines.push((index + 1) + '. ' + safe(formatter(item))));
  lines.push('');
}

function appendLinkedItems(lines, title, items) {
  if (!Array.isArray(items) || !items.length) return;
  lines.push('**' + title + '**');
  items.forEach(item => {
    const label = '#' + item.id + ' ' + item.repository + ' — ' +
      (item.attention && item.attention.label || 'Attention') + ' (' +
      (item.attention && item.attention.ageLabel || '-') + ')';
    lines.push('- ' + (item.url
      ? '[' + safe(label) + '](' + item.url + ')'
      : safe(label)));
  });
  lines.push('');
}

function parseRequestOptions(body) {
  let payload = body && typeof body === 'object' ? body : {};
  if (typeof body === 'string') {
    try {
      payload = JSON.parse(body);
    } catch (err) {
      payload = {};
    }
  }
  return {
    reportMonth: payload.reportMonth ? String(payload.reportMonth).trim() : '',
    scheduledFor: payload.scheduledFor ? String(payload.scheduledFor).trim() : '',
    testMode: payload.testMode === true,
    requestedBy: payload.requestedBy ? String(payload.requestedBy).trim() : '',
    source: payload.source === 'Dashboard Test'
      ? 'Dashboard Test Monthly Summary'
      : (payload.source === 'Logic Apps'
        ? 'Logic Apps Monthly Summary'
        : 'Teams Monthly Summary')
  };
}

function formatComparison(value) {
  if (!value || value.percent === null) return '—';
  if (value.delta === 0) return '— 0%';
  return (value.delta > 0 ? '▲ ' : '▼ ') + Math.abs(value.percent).toFixed(1) + '%';
}

function buildReportUrl(baseUrl, range) {
  if (!baseUrl) return '';
  return baseUrl.replace(/\/$/, '') +
    '/report.html?type=monthly&year=' + range.year + '&month=' + range.month;
}

function getReportBaseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (configured) return configured;
  const host = getHeader(req, 'x-forwarded-host') || getHeader(req, 'host');
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return '';
  const proto = getHeader(req, 'x-forwarded-proto') || 'https';
  return (proto === 'http' ? 'http' : 'https') + '://' + host;
}

async function monthlySummaryAlreadySent(sp, eventKey) {
  const result = await sp.getLogByEventKey(eventKey);
  return !!(result.ok && result.body &&
    Array.isArray(result.body.value) && result.body.value.length);
}

function buildLogReason(status, options, summary) {
  const values = ['Teams status ' + status, 'month ' + summary.monthKey];
  if (options.scheduledFor) values.push('scheduledFor ' + options.scheduledFor);
  return values.join(' | ');
}

function getResultItems(result) {
  return result.body && Array.isArray(result.body.value)
    ? result.body.value
    : [];
}

function getHeader(req, name) {
  const headers = req && req.headers || {};
  const wanted = String(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (String(key).toLowerCase() === wanted) return String(headers[key] || '');
  }
  return '';
}

function percent(value) {
  return (Number(value) || 0).toFixed(2).replace(/\.00$/, '') + '%';
}

function number(value) {
  return (Number(value) || 0).toLocaleString('en-US');
}

function safe(value) {
  return String(value || '-').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

monthlySummaryHandler.buildMonthlySummary = buildMonthlySummary;
monthlySummaryHandler.buildMonthlySummaryMessage = buildMonthlySummaryMessage;
monthlySummaryHandler.parseRequestOptions = parseRequestOptions;
module.exports = monthlySummaryHandler;
