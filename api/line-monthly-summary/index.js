/**
 * POST /api/line-monthly-summary
 *
 * Sends the completed previous calendar month to LINE OA. Recommended schedule:
 * day 1 at 08:05 Asia/Bangkok, shortly after the Teams monthly summary.
 */

const line = require('../shared/line-notifier');
const monthlySummaryModule = require('../monthly-summary/index');
const sp = require('../shared/sharepoint-client');

async function lineMonthlySummaryHandler(context, req) {
  function jsonResponse(status, payload) {
    context.res = {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    };
  }

  try {
    const expectedToken = process.env.LINE_MONTHLY_SUMMARY_TOKEN ||
      process.env.MONTHLY_SUMMARY_TOKEN ||
      process.env.LINE_DAILY_SUMMARY_TOKEN ||
      process.env.DAILY_SUMMARY_TOKEN;
    if (!expectedToken) {
      jsonResponse(503, {
        ok: false,
        error: 'LINE_MONTHLY_SUMMARY_TOKEN (or a summary token fallback) is not configured'
      });
      return;
    }

    const suppliedToken = getHeader(req, 'x-line-monthly-summary-token') ||
      getHeader(req, 'x-monthly-summary-token');
    if (suppliedToken !== expectedToken) {
      jsonResponse(401, { ok: false, error: 'Unauthorized' });
      return;
    }

    const options = parseRequestOptions(req && req.body);
    const summary = await monthlySummaryModule.buildMonthlySummary(
      context,
      options.reportMonth,
      getReportBaseUrl(req)
    );
    const eventKey = options.testMode
      ? 'line:monthly-summary-test:' + summary.monthKey + ':' + Date.now()
      : 'line:monthly-summary:' + summary.monthKey;

    if (!options.testMode && await summaryAlreadySent(eventKey)) {
      jsonResponse(200, {
        ok: true,
        skipped: true,
        reason: 'duplicate',
        eventKey,
        summary
      });
      return;
    }

    let result;
    try {
      result = await line.sendLinePush(buildLineMonthlySummaryMessage(summary, options.testMode));
    } catch (err) {
      context.log.error('LINE monthly summary send failed:', err);
      result = {
        ok: false,
        status: 500,
        body: err && err.message ? err.message : 'LINE monthly summary send failed'
      };
    }

    if (result.ok) {
      try {
        await sp.addLogItem(sp.buildLogFields({
          prId: 0,
          action: options.testMode ? 'Test LINE Notification Sent' : 'LINE Notification Sent',
          user: options.requestedBy || 'System',
          repository: options.testMode ? 'Monthly Summary LINE Test' : 'Monthly Summary LINE',
          prTitle: (options.testMode ? '[TEST] ' : '') +
            'Monthly PR Summary (LINE) - ' + summary.monthLabel,
          targetBranch: summary.targetBranch,
          result: options.testMode ? 'Test LINE monthly summary sent' : 'LINE monthly summary sent',
          reason: 'LINE status ' + result.status +
            ' | target ' + (process.env.LINE_TARGET_ID || '-') +
            (options.scheduledFor ? ' | scheduledFor ' + options.scheduledFor : ''),
          source: options.source,
          eventKey,
          lastCheckedAt: summary.generatedAt
        }));
      } catch (err) {
        context.log.warn('LINE monthly summary log to SharePoint failed: ' + err.message);
      }
    }

    jsonResponse(result.ok ? 200 : 502, {
      ok: result.ok,
      lineStatus: result.status,
      eventKey,
      summary
    });
  } catch (err) {
    context.log.error('LINE monthly summary failed:', err);
    jsonResponse(500, {
      ok: false,
      error: 'Unexpected server error',
      detail: err.message
    });
  }
}

function buildLineMonthlySummaryMessage(summary, testMode) {
  const pr = summary.pr || {};
  const approval = summary.approval || {};
  const build = summary.build || {};
  const attention = summary.attention || {};
  const comparison = summary.comparison || {};
  const lines = [
    '📅 ' + (testMode ? '[TEST] ' : '') + 'Monthly PR Summary - Staging (LINE)',
    'สรุปประจำเดือน ' + plain(summary.monthLabel),
    '────────────────────',
    '',
    '📊 PR Overview',
    '• New PR: ' + number(pr.created) + comparisonSuffix(comparison.created),
    '• Completed: ' + number(pr.completed) + comparisonSuffix(comparison.completed),
    '• Completion rate: ' + percent(pr.completionRate),
    '• Abandoned: ' + number(pr.abandoned) + comparisonSuffix(comparison.abandoned),
    '• Active now: ' + number(pr.activeNow),
    '• Active Merge PRs: ' + number(pr.activeMerge),
    '',
    '✅ Approval Performance',
    '• PRs handled: ' + number(approval.uniquePrs),
    '• Auto Approved: ' + number(approval.autoApproved) + comparisonSuffix(comparison.autoApproved),
    '• Manual Approved: ' + number(approval.manualApproved),
    '• Rejected: ' + number(approval.rejected),
    '• Hold: ' + number(approval.onHold),
    '• Auto-Approve rate: ' + percent(approval.autoApproveRate),
    '',
    '🚀 Build & Deployment',
    '• Total Builds: ' + number(build.total),
    '• Succeeded: ' + number(build.succeeded),
    '• Failed: ' + number(build.failed) + comparisonSuffix(comparison.failedBuilds),
    '• Success rate: ' + percent(build.successRate),
    '',
    '🚦 Current attention snapshot',
    '• Critical: ' + number(attention.critical),
    '• Warning: ' + number(attention.warning),
    '• Stale: ' + number(attention.stale),
    '• Rejected active: ' + number(attention.rejected),
    '• Build/Policy failed: ' + number(attention.failedOrPolicyFailed)
  ];

  appendRankedItems(lines, '📦 Top repositories by new PR', summary.topRepos,
    item => plain(item.repo) + ' — ' + number(item.count));
  appendRankedItems(lines, '⚠️ Top repositories with failed builds', build.topFailedRepos,
    item => plain(item.repo) + ' — ' + number(item.count));
  appendAttentionItems(lines, summary.attentionItems);

  if (summary.dataQuality && summary.dataQuality.logsTruncated) {
    lines.push('');
    lines.push('⚠️ Audit log ถึงขีดจำกัด 10,000 รายการ ตัวเลข Approval อาจไม่ครบถ้วน');
  }
  if (summary.reportUrl) {
    lines.push('');
    lines.push('🔗 เปิดรายงานประจำเดือน');
    lines.push(String(summary.reportUrl));
  }
  lines.push('');
  lines.push('ข้อมูลคำนวณจากระบบต้นทาง ไม่ใช่ผลรวมข้อความ Daily Summary');
  return lines.join('\n');
}

function appendRankedItems(lines, title, items, formatter) {
  const selected = Array.isArray(items) ? items.slice(0, 5) : [];
  if (!selected.length) return;
  lines.push('');
  lines.push(title);
  selected.forEach((item, index) => lines.push((index + 1) + '. ' + formatter(item)));
}

function appendAttentionItems(lines, items) {
  const selected = Array.isArray(items) ? items.slice(0, 5) : [];
  if (!selected.length) return;
  lines.push('');
  lines.push('⚠️ PRs needing attention');
  selected.forEach(item => {
    const attention = item.attention || {};
    lines.push('• #' + number(item.id) + ' ' + plain(item.repository) +
      ' — ' + plain(attention.label || 'Attention') +
      ' (' + plain(attention.ageLabel || '-') + ')');
    if (item.url) lines.push('  ' + String(item.url));
  });
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
      ? 'Dashboard Test LINE Monthly Summary'
      : (payload.source === 'Logic Apps'
        ? 'Logic Apps LINE Monthly Summary'
        : 'LINE Monthly Summary')
  };
}

async function summaryAlreadySent(eventKey) {
  const result = await sp.getLogByEventKey(eventKey);
  return !!(result.ok && result.body &&
    Array.isArray(result.body.value) && result.body.value.length);
}

function getReportBaseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (configured) return configured;
  const host = getHeader(req, 'x-forwarded-host') || getHeader(req, 'host');
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return '';
  const proto = getHeader(req, 'x-forwarded-proto') || 'https';
  return (proto === 'http' ? 'http' : 'https') + '://' + host;
}

function getHeader(req, name) {
  const headers = req && req.headers || {};
  const wanted = String(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (String(key).toLowerCase() === wanted) return String(headers[key] || '');
  }
  return '';
}

function comparisonSuffix(value) {
  if (!value || value.percent === null || typeof value.percent === 'undefined') return '';
  if (Number(value.delta) === 0) return ' (— 0%)';
  return ' (' + (Number(value.delta) > 0 ? '▲ ' : '▼ ') +
    Math.abs(Number(value.percent) || 0).toFixed(1) + '%)';
}

function percent(value) {
  return (Number(value) || 0).toFixed(2).replace(/\.00$/, '') + '%';
}

function number(value) {
  return (Number(value) || 0).toLocaleString('en-US');
}

function plain(value) {
  return String(value || '-').replace(/\r?\n/g, ' ').trim();
}

lineMonthlySummaryHandler.buildLineMonthlySummaryMessage = buildLineMonthlySummaryMessage;
lineMonthlySummaryHandler.parseRequestOptions = parseRequestOptions;
module.exports = lineMonthlySummaryHandler;
