/**
 * POST /api/line-daily-summary
 *
 * ส่ง LINE notification สรุป PR รายวันเวลา 23:59 (Asia/Bangkok)
 */

const line = require('../shared/line-notifier');
const dailySummaryModule = require('../daily-summary/index');
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
    const expectedToken = process.env.LINE_DAILY_SUMMARY_TOKEN || process.env.DAILY_SUMMARY_TOKEN;
    if (!expectedToken) {
      jsonResponse(503, {
        ok: false,
        error: 'LINE_DAILY_SUMMARY_TOKEN (or DAILY_SUMMARY_TOKEN) is not configured'
      });
      return;
    }

    const suppliedToken = req.headers &&
      (req.headers['x-line-daily-summary-token'] || req.headers['X-Line-Daily-Summary-Token'] || req.headers['x-daily-summary-token']);
    if (suppliedToken !== expectedToken) {
      jsonResponse(401, { ok: false, error: 'Unauthorized' });
      return;
    }

    // Parse options (reuse daily summary helper)
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    const requestOptions = dailySummaryModule.parseRequestOptions(body);

    // Fetch and build daily summary data (reuse daily summary helper)
    const summary = await dailySummaryModule.buildDailySummary(context, requestOptions.reportDate);

    // Check duplicate for LINE
    const lineEventKey = requestOptions.testMode
      ? 'line:daily-summary-test:' + summary.dateKey + ':' + Date.now()
      : 'line:daily-summary:' + summary.dateKey;
    const lineAlreadySent = !requestOptions.testMode && await lineSummaryAlreadySent(sp, summary, lineEventKey);

    // Check duplicate for Teams 23:59
    const teamsEventKey = requestOptions.testMode
      ? 'teams:daily-summary-2359-test:' + summary.dateKey + ':' + Date.now()
      : 'teams:daily-summary-2359:' + summary.dateKey;
    const teamsAlreadySent = !requestOptions.testMode && await teamsSummaryAlreadySent(sp, summary, teamsEventKey);

    let lineResult = { ok: true, skipped: true, reason: 'duplicate' };
    let teamsResult = { ok: true, skipped: true, reason: 'duplicate' };

    // Send to LINE if not already sent
    if (!lineAlreadySent) {
      const lineMessage = buildLineDailySummaryMessage(summary, requestOptions.testMode);
      context.log(`Sending Daily PR Summary to LINE: ${lineEventKey}...`);
      lineResult = await line.sendLinePush(lineMessage);

      if (lineResult.ok) {
        try {
          await sp.addLogItem(sp.buildLogFields({
            prId: 0,
            action: requestOptions.testMode ? 'Test LINE Notification Sent' : 'LINE Notification Sent',
            user: requestOptions.requestedBy || 'System',
            repository: requestOptions.testMode ? 'Daily Summary LINE Test' : 'Daily Summary LINE',
            prTitle: (requestOptions.testMode ? '[TEST] ' : '') + 'Daily PR Summary (LINE) - ' + summary.dateLabel,
            targetBranch: summary.targetBranch,
            result: requestOptions.testMode ? 'Test LINE daily summary sent' : 'LINE daily summary sent',
            reason: `LINE status ${lineResult.status} | target ${process.env.LINE_TARGET_ID || '-'}`,
            source: requestOptions.testMode ? 'Dashboard Test LINE' : 'Logic Apps LINE Daily Summary',
            eventKey: lineEventKey,
            lastCheckedAt: summary.generatedAt
          }));
        } catch (spErr) {
          context.log.warn('LINE daily summary log to SharePoint failed:', spErr.message);
        }
      }
    } else {
      context.log(`Daily PR Summary to LINE already sent for date ${summary.dateKey}. Skipping.`);
    }

    // Send to Teams if not already sent
    if (!teamsAlreadySent) {
      const teams = require('../shared/teams-notifier');
      const teamsMessage = dailySummaryModule.buildDailySummaryMessage(summary, requestOptions.testMode);
      context.log(`Sending Daily PR Summary to MS Teams (23:59): ${teamsEventKey}...`);
      teamsResult = await teams.sendTeamsCard({ text: teamsMessage });

      if (teamsResult.ok) {
        try {
          await sp.addLogItem(sp.buildLogFields({
            prId: 0,
            action: requestOptions.testMode ? 'Test Notification Sent' : 'Notification Sent',
            user: requestOptions.requestedBy || 'System',
            repository: requestOptions.testMode ? 'Daily Summary Test' : 'Daily Summary',
            prTitle: (requestOptions.testMode ? '[TEST] ' : '') + 'Daily PR Summary (Teams 23:59) - ' + summary.dateLabel,
            targetBranch: summary.targetBranch,
            result: requestOptions.testMode ? 'Test daily summary sent' : 'Daily summary sent',
            reason: `Teams status ${teamsResult.status} (23:59)`,
            source: requestOptions.testMode ? 'Dashboard Test LINE' : 'Logic Apps LINE Daily Summary',
            eventKey: teamsEventKey,
            lastCheckedAt: summary.generatedAt
          }));
        } catch (spErr) {
          context.log.warn('Teams 23:59 daily summary log to SharePoint failed:', spErr.message);
        }
      }
    } else {
      context.log(`Daily PR Summary to MS Teams (23:59) already sent for date ${summary.dateKey}. Skipping.`);
    }

    jsonResponse((lineResult.ok && teamsResult.ok) ? 200 : 502, {
      ok: lineResult.ok && teamsResult.ok,
      line: {
        ok: lineResult.ok,
        status: lineResult.status,
        skipped: !!lineResult.skipped,
        eventKey: lineEventKey
      },
      teams: {
        ok: teamsResult.ok,
        status: teamsResult.status,
        skipped: !!teamsResult.skipped,
        eventKey: teamsEventKey
      },
      summary: summary
    });

  } catch (err) {
    context.log.error('LINE/Teams Daily summary failed:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};

/**
 * Format Daily PR Summary Message specifically for LINE OA.
 * (LINE doesn't support Markdown tables, so we use list/bullet points with neat spacing)
 */
function buildLineDailySummaryMessage(summary, testMode) {
  const c = summary.counts || {};
  const lines = [
    '📊 ' + (testMode ? '[TEST] ' : '') + 'Daily PR Summary - Staging (LINE)',
    'สรุป Pull Request ประจำวันที่ ' + summary.dateLabel,
    '----------------------------------------',
    `• New PR today : ${c.createdToday || 0}`,
    `• Completed today : ${c.completedToday || 0}`,
    `• Active now : ${c.activeNow || 0}`,
    `• Active Merge PRs : ${c.activeMerge || 0}`,
    `• Critical attention : ${c.attentionCritical || 0}`,
    `• Warning attention : ${c.attentionWarning || 0}`,
    `• Stale active : ${c.staleActive || 0}`,
    `• Build/Policy failed : ${c.failedOrPolicyFailed || 0}`,
    `• Rejected active : ${c.rejectedActive || 0}`,
    `• Abandoned today : ${c.abandonedToday || 0}`,
    '----------------------------------------'
  ];

  appendLineItems(lines, '🚦 PR attention / aging', summary.attentionItems, item =>
    `#${item.id} ${item.repository}\n  ↳ ${item.attention.label} (${item.attention.ageLabel})\n  ↳ สาเหตุ: ${item.attention.reason}`
  );

  appendLineItems(lines, '⚠️ Items needing attention', summary.failedItems, item =>
    `#${item.id} ${item.repository}\n  ↳ Build: ${item.build}\n  ↳ Policy: ${item.policy}`
  );

  appendLineItems(lines, '❌ Rejected active PRs', summary.rejectedItems, item =>
    `#${item.id} ${item.repository}\n  ↳ approvals: ${item.approvals}`
  );

  appendLineItems(lines, '🟠 Abandoned today', summary.abandonedItems, item =>
    `#${item.id} ${item.repository}\n  ↳ ${trimText(item.title, 60)}`
  );

  lines.push('');
  lines.push('💡 การแจ้งเตือนสรุปรายวัน LINE จะส่งทุกวันเวลา 23:59 น.');
  return lines.join('\n');
}

function appendLineItems(lines, title, items, formatter) {
  if (!Array.isArray(items) || items.length === 0) return;
  lines.push('');
  lines.push(`[${title}]`);
  for (const item of items) {
    lines.push(`- ${formatter(item)}`);
  }
}

function trimText(value, max) {
  const text = String(value || '');
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

async function lineSummaryAlreadySent(sp, summary, eventKey) {
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
    return markerText.includes('line daily summary') &&
      getBangkokDateKey(fields.Last_Checked_At) === summary.dateKey;
  });
}

async function teamsSummaryAlreadySent(sp, summary, eventKey) {
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
    return markerText.includes('daily pr summary') &&
      markerText.includes('23:59') &&
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
