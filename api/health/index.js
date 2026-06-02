/**
 * GET /api/health
 *
 * System health สำหรับ dashboard:
 *  - Backend runtime
 *  - Azure DevOps PAT / connection
 *  - SharePoint log read/write dependencies
 *  - Teams / Daily Summary configuration
 *  - Last notification from SharePoint log
 */
module.exports = async function (context, req) {
  const generatedAt = new Date().toISOString();
  const checks = [];

  checks.push({
    key: 'backend',
    label: 'Backend',
    status: 'ok',
    message: 'API runtime is running',
    checkedAt: generatedAt,
    detail: {
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version
    }
  });

  checks.push(await checkAdo(context));
  const sharePointResult = await checkSharePoint(context);
  checks.push(sharePointResult.check);
  checks.push(checkTeamsConfig());
  checks.push(checkDailySummaryConfig());

  const lastNotification = sharePointResult.recentLogs
    ? findLastNotification(sharePointResult.recentLogs)
    : null;

  const rollup = checks.some(c => c.status === 'error')
    ? 'degraded'
    : (checks.some(c => c.status === 'warning') ? 'warning' : 'healthy');

  context.res = {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    },
    body: {
      status: rollup,
      timestamp: generatedAt,
      phase: 'Production Dashboard',
      version: '1.1.0',
      checks: checks,
      lastNotification: lastNotification,
      schedule: {
        dailySummary: {
          enabled: !!process.env.DAILY_SUMMARY_TOKEN && !!process.env.TEAMS_WEBHOOK_URL,
          scheduler: 'GitHub Actions fallback',
          timeZone: 'Asia/Bangkok',
          localTime: '18:00',
          nextRunAt: getNextDailySummaryRun(generatedAt)
        }
      },
      message: 'ADO Auto-Approve API health checked'
    }
  };
};

async function checkAdo(context) {
  const startedAt = Date.now();
  try {
    const ado = require('../shared/ado-client');
    const cfg = ado.getConfig();
    const result = await ado.getConnectionData();
    if (!result.ok) {
      return buildCheck('ado', 'Azure DevOps', 'error', 'ADO returned HTTP ' + result.status, startedAt, {
        configured: !!(cfg.org && cfg.project)
      });
    }
    return buildCheck('ado', 'Azure DevOps', 'ok', 'Connected to ADO', startedAt, {
      configured: !!(cfg.org && cfg.project)
    });
  } catch (e) {
    logWarn(context, 'ADO health check failed: ' + e.message);
    return buildCheck('ado', 'Azure DevOps', 'error', e.message, startedAt);
  }
}

async function checkSharePoint(context) {
  const startedAt = Date.now();
  try {
    const sp = require('../shared/sharepoint-client');
    const siteId = await sp.getSiteId();
    const listId = await sp.getListId();
    const recent = await sp.getRecentLogItems(80);
    const recentLogs = recent.ok && recent.body && Array.isArray(recent.body.value)
      ? recent.body.value
      : [];
    const status = recent.ok ? 'ok' : 'warning';
    const message = recent.ok
      ? 'SharePoint log is readable'
      : 'SharePoint site/list found, recent log query returned HTTP ' + recent.status;
    return {
      check: buildCheck('sharepoint', 'SharePoint Log', status, message, startedAt, {
        siteReady: !!siteId,
        listReady: !!listId,
        recentLogCount: recentLogs.length
      }),
      recentLogs: recentLogs
    };
  } catch (e) {
    logWarn(context, 'SharePoint health check failed: ' + e.message);
    return {
      check: buildCheck('sharepoint', 'SharePoint Log', 'error', e.message, startedAt),
      recentLogs: []
    };
  }
}

function checkTeamsConfig() {
  const startedAt = Date.now();
  const url = process.env.TEAMS_WEBHOOK_URL || '';
  if (!url) {
    return buildCheck('teams', 'Teams Webhook', 'warning', 'TEAMS_WEBHOOK_URL is not configured', startedAt);
  }
  try {
    const parsed = new URL(url);
    return buildCheck('teams', 'Teams Webhook', 'ok', 'Webhook URL is configured', startedAt, {
      host: parsed.hostname
    });
  } catch (e) {
    return buildCheck('teams', 'Teams Webhook', 'error', 'TEAMS_WEBHOOK_URL is invalid', startedAt);
  }
}

function checkDailySummaryConfig() {
  const startedAt = Date.now();
  if (!process.env.DAILY_SUMMARY_TOKEN) {
    return buildCheck('daily-summary', 'Daily Summary', 'warning', 'DAILY_SUMMARY_TOKEN is not configured', startedAt, {
      scheduler: 'GitHub Actions fallback',
      schedule: '18:00 Asia/Bangkok'
    });
  }
  return buildCheck('daily-summary', 'Daily Summary', 'ok', 'Daily summary token is configured', startedAt, {
    scheduler: 'GitHub Actions fallback',
    schedule: '18:00 Asia/Bangkok'
  });
}

function findLastNotification(logItems) {
  for (const item of logItems || []) {
    const fields = item.fields || {};
    const title = String(fields.Title || '');
    const action = String(fields.Action || '');
    const result = String(fields.Result || '');
    const reason = String(fields.Reason || '');
    const source = String(fields.Source || '');
    const text = [title, action, result, reason, source].join(' ').toLowerCase();
    const looksLikeNotification =
      action === 'Notification Sent' ||
      title.includes('Notification Sent') ||
      text.includes('notification') ||
      text.includes('teams') ||
      text.includes('daily summary');
    if (!looksLikeNotification) continue;
    return {
      at: item.createdDateTime || fields.Last_Checked_At || '',
      prId: fields.PR_ID || 0,
      result: fields.Result || '',
      reason: fields.Reason || '',
      source: fields.Source || inferNotificationSource(text)
    };
  }
  return null;
}

function inferNotificationSource(text) {
  if (text.includes('daily summary')) return 'Teams Daily Summary';
  if (text.includes('teams')) return 'Teams Notification';
  return 'Notification';
}

function buildCheck(key, label, status, message, startedAt, detail) {
  return {
    key: key,
    label: label,
    status: status,
    message: message,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    detail: detail || {}
  };
}

function getNextDailySummaryRun(nowIso) {
  const offsetMs = 7 * 60 * 60 * 1000;
  const now = new Date(nowIso);
  const bkkNow = new Date(now.getTime() + offsetMs);
  let runUtcMs = Date.UTC(
    bkkNow.getUTCFullYear(),
    bkkNow.getUTCMonth(),
    bkkNow.getUTCDate(),
    18,
    0,
    0
  ) - offsetMs;
  if (runUtcMs <= now.getTime()) runUtcMs += 24 * 60 * 60 * 1000;
  return new Date(runUtcMs).toISOString();
}

function logWarn(context, message) {
  if (context && context.log && context.log.warn) {
    context.log.warn(message);
  }
}
