/**
 * POST /api/build-failure-scan
 *
 * Polls Azure DevOps REST API for recent failed staging builds and sends Teams
 * alerts once per build. Intended for Logic Apps / scheduler usage when ADO
 * Service Hooks are unreliable.
 */

const ado = require('../shared/ado-client');
const sp = require('../shared/sharepoint-client');
const teams = require('../shared/teams-notifier');

module.exports = async function (context, req) {
  function jsonResponse(status, payload) {
    context.res = {
      status: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    };
  }

  try {
    const expectedToken = process.env.BUILD_FAILURE_SCAN_TOKEN || process.env.DAILY_SUMMARY_TOKEN || '';
    if (!expectedToken) {
      jsonResponse(500, { ok: false, error: 'BUILD_FAILURE_SCAN_TOKEN or DAILY_SUMMARY_TOKEN is not configured' });
      return;
    }

    const suppliedToken = getHeader(req, 'x-build-failure-scan-token') ||
      getHeader(req, 'x-daily-summary-token') ||
      (req.query && req.query.token);
    if (suppliedToken !== expectedToken) {
      jsonResponse(401, { ok: false, error: 'Unauthorized' });
      return;
    }

    const options = parseOptions(req.body);
    const result = await scanBuildFailures(context, options);
    jsonResponse(200, result);
  } catch (err) {
    context.log.error('Build failure scan failed:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};

async function scanBuildFailures(context, options) {
  const cfg = ado.getConfig();
  const sinceIso = new Date(Date.now() - options.lookbackMinutes * 60 * 1000).toISOString();
  const buildsResult = await ado.listBuilds({
    minTime: sinceIso,
    top: options.maxBuilds,
    statusFilter: 'completed',
    resultFilter: 'failed'
  });

  if (!buildsResult.ok) {
    return {
      ok: false,
      error: 'ADO build query failed: HTTP ' + buildsResult.status,
      checkedBuilds: 0,
      sent: 0,
      skipped: 0,
      rows: []
    };
  }

  const builds = buildsResult.body && Array.isArray(buildsResult.body.value)
    ? buildsResult.body.value
    : [];
  const candidates = builds.filter(build => isStagingBuild(build, options));
  const rows = [];
  let sent = 0;
  let skipped = 0;

  for (const build of candidates) {
    const notifyResult = options.dryRun
      ? { skipped: true, reason: 'dry_run', eventKey: 'teams:build-failed:' + build.id }
      : await notifyBuildFailureOnce(context, cfg, build);
    if (notifyResult && notifyResult.ok) sent += 1;
    else skipped += 1;
    rows.push({
      buildId: build.id,
      buildNumber: build.buildNumber || '',
      pipeline: build.definition && build.definition.name || '',
      repository: build.repository && build.repository.name || '',
      branch: build.sourceBranch || '',
      result: build.result || '',
      finishTime: build.finishTime || '',
      notification: notifyResult
    });
  }

  return {
    ok: true,
    source: 'ADO REST Build Failure Scan',
    lookbackMinutes: options.lookbackMinutes,
    dryRun: options.dryRun,
    checkedBuilds: builds.length,
    matchedBuilds: candidates.length,
    sent: sent,
    skipped: skipped,
    rows: rows
  };
}

async function notifyBuildFailureOnce(context, cfg, build) {
  if (!process.env.TEAMS_WEBHOOK_URL) {
    return { skipped: true, reason: 'teams_disabled' };
  }
  if (process.env.TEAMS_EXCEPTION_NOTIFICATIONS === 'false') {
    return { skipped: true, reason: 'exception_notifications_disabled' };
  }

  const buildId = build && build.id;
  if (!buildId) return { skipped: true, reason: 'missing_build_id' };

  const eventKey = 'teams:build-failed:' + buildId;
  try {
    const existing = await sp.getLogByEventKey(eventKey);
    const existingItems = existing.ok && existing.body && Array.isArray(existing.body.value)
      ? existing.body.value
      : [];
    if (existingItems.length > 0) {
      return { skipped: true, reason: 'duplicate', eventKey: eventKey };
    }

    const message = buildTeamsMessage(cfg, build);
    const teamsResult = await teams.notifyTeams(process.env.TEAMS_WEBHOOK_URL, message);
    if (!teamsResult.ok) {
      if (context && context.log && context.log.warn) {
        context.log.warn('Build failure Teams notification failed: HTTP ' + teamsResult.status);
      }
      return { ok: false, status: teamsResult.status, eventKey: eventKey };
    }

    const buildUrl = getBuildUrl(build);
    const pipelineName = build.definition && build.definition.name || '';
    const repoName = build.repository && build.repository.name || '';
    await sp.addLogItem(sp.buildLogFields({
      prId: 0,
      action: 'Build Failed Alert',
      user: build.requestedFor && build.requestedFor.displayName || 'System',
      repository: repoName,
      prTitle: 'Build Failed Alert: ' + pipelineName + ' - ' + (build.buildNumber || buildId),
      targetBranch: build.sourceBranch || '',
      result: 'Alert Sent',
      reason: 'Auto Teams notification sent for build ' + buildId + ' from ADO REST polling.',
      source: 'ADO REST Build Failure Scan',
      eventKey: eventKey,
      buildStatus: build.status || '',
      buildResult: build.result || '',
      lastCheckedAt: new Date().toISOString(),
      adoBuildUrl: buildUrl
    }));

    return { ok: true, eventKey: eventKey };
  } catch (e) {
    if (context && context.log && context.log.warn) {
      context.log.warn('Build failure notification skipped/failed: ' + e.message);
    }
    return { ok: false, error: e.message, eventKey: eventKey };
  }
}

function buildTeamsMessage(cfg, build) {
  const buildId = build.id || '';
  const buildNumber = build.buildNumber || '';
  const pipelineName = build.definition && build.definition.name || '';
  const repoName = build.repository && build.repository.name || '';
  const branch = build.sourceBranch || '';
  const requestedBy = build.requestedFor && build.requestedFor.displayName || '';
  const buildUrl = getBuildUrl(build) || build.url || '';
  const commit = build.sourceVersion || '';
  const finished = build.finishTime || '';
  const diagnosticsUrl = process.env.WEBSITE_HOSTNAME
    ? 'https://' + process.env.WEBSITE_HOSTNAME + '/build-diagnostics.html?buildId=' + encodeURIComponent(String(buildId))
    : '';

  const lines = [
    '## 🚨 Build Failed Detected',
    '',
    '| Field | Value |',
    '|---|---|',
    '| **Pipeline** | ' + safe(pipelineName) + ' |',
    '| **Build Number** | ' + (buildUrl ? '[' + safe(buildNumber || buildId) + '](' + buildUrl + ')' : safe(buildNumber || buildId)) + ' |',
    '| **Repository** | ' + safe(repoName) + ' |',
    '| **Branch** | `' + safe(branch) + '` |',
    '| **Result** | ' + safe(build.result || '-') + ' |',
    '| **Finished** | ' + safe(finished || '-') + ' |'
  ];
  if (requestedBy) lines.push('| **Triggered by** | ' + safe(requestedBy) + ' |');
  if (commit) lines.push('| **Commit** | `' + safe(commit.substring(0, 12)) + '` |');
  if (diagnosticsUrl) lines.push('', '🔗 **[เปิดดูหน้าวิเคราะห์บน Dashboard](' + diagnosticsUrl + ')**');
  if (!diagnosticsUrl && buildUrl) lines.push('', '🔗 **[Open Build in Azure DevOps](' + buildUrl + ')**');
  if (cfg && cfg.project) lines.push('', '_Source: ADO REST polling_');
  return lines.join('\n');
}

function parseOptions(body) {
  const payload = body && typeof body === 'object' ? body : {};
  return {
    lookbackMinutes: Math.min(Math.max(Number(payload.lookbackMinutes || process.env.BUILD_FAILURE_SCAN_LOOKBACK_MINUTES || 30), 5), 1440),
    maxBuilds: Math.min(Math.max(Number(payload.maxBuilds || process.env.BUILD_FAILURE_SCAN_LIMIT || 100), 10), 1000),
    branchPrefix: String(payload.branchPrefix || process.env.BUILD_FAILURE_SCAN_BRANCH_PREFIX || 'refs/heads/staging').toLowerCase(),
    pipelineKeyword: String(payload.pipelineKeyword || process.env.BUILD_FAILURE_SCAN_PIPELINE_KEYWORD || 'stg').toLowerCase(),
    dryRun: payload.dryRun === true || String(payload.dryRun || '').toLowerCase() === 'true'
  };
}

function isStagingBuild(build, options) {
  const pipelineName = String(build && build.definition && build.definition.name || '').toLowerCase();
  const branch = String(build && build.sourceBranch || '').toLowerCase();
  if (pipelineName.includes('schedule') || pipelineName.includes('scripts')) return false;
  if (options.pipelineKeyword && !pipelineName.includes(options.pipelineKeyword)) return false;
  if (options.branchPrefix && !branch.startsWith(options.branchPrefix)) return false;
  return true;
}

function getBuildUrl(build) {
  return build && build._links && build._links.web && build._links.web.href || '';
}

function getHeader(req, name) {
  const headers = req && req.headers || {};
  return headers[name] || headers[String(name || '').toLowerCase()] || headers[String(name || '').toUpperCase()];
}

function safe(value) {
  return String(value || '-').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

module.exports.scanBuildFailures = scanBuildFailures;
