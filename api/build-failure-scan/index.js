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
const diagnosticsCatalog = require('../shared/build-diagnostics-catalog');

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
      ? await buildDryRunResult(context, build)
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
      notification: notifyResult,
      diagnostics: notifyResult && notifyResult.diagnostics || null
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

    const prInfo = await getBuildPullRequestInfo(context, cfg, build);
    const diagnosticInfo = await getBuildDiagnosticsForBuild(context, buildId);
    const message = buildTeamsMessage(cfg, build, diagnosticInfo, prInfo);
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
      prId: prInfo.prId || 0,
      action: 'Build Failed Alert',
      user: build.requestedFor && build.requestedFor.displayName || 'System',
      repository: repoName,
      prTitle: prInfo.prTitle || ('Build Failed Alert: ' + pipelineName + ' - ' + (build.buildNumber || buildId)),
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

    return {
      ok: true,
      eventKey: eventKey,
      pr: summarizePrInfoForResponse(prInfo),
      diagnostics: summarizeDiagnosticsForResponse(diagnosticInfo)
    };
  } catch (e) {
    if (context && context.log && context.log.warn) {
      context.log.warn('Build failure notification skipped/failed: ' + e.message);
    }
    return { ok: false, error: e.message, eventKey: eventKey };
  }
}

async function buildDryRunResult(context, build) {
  const buildId = build && build.id;
  const eventKey = 'teams:build-failed:' + buildId;
  const diagnosticInfo = buildId
    ? await getBuildDiagnosticsForBuild(context, buildId)
    : { ok: false, reason: 'missing_build_id' };
  const prInfo = buildId
    ? await getBuildPullRequestInfo(context, ado.getConfig(), build)
    : { prId: '' };
  return {
    skipped: true,
    reason: 'dry_run',
    eventKey: eventKey,
    pr: summarizePrInfoForResponse(prInfo),
    diagnostics: summarizeDiagnosticsForResponse(diagnosticInfo)
  };
}

async function getBuildDiagnosticsForBuild(context, buildId) {
  try {
    const timelineResult = await ado.getBuildTimeline(buildId);
    if (!timelineResult.ok) {
      return {
        ok: false,
        reason: 'timeline_fetch_failed',
        status: timelineResult.status
      };
    }

    const records = timelineResult.body && Array.isArray(timelineResult.body.records)
      ? timelineResult.body.records
      : [];
    let failedTask = records.find(r => r && r.type === 'Task' && r.state === 'completed' && r.result === 'failed' && r.log);
    if (!failedTask) {
      failedTask = records.find(r => r && r.state === 'completed' && r.result === 'failed' && r.log);
    }
    if (!failedTask || !failedTask.log || !failedTask.log.id) {
      return {
        ok: false,
        reason: 'failed_task_log_not_found'
      };
    }

    const logResult = await ado.getBuildLog(buildId, failedTask.log.id);
    if (!logResult.ok) {
      return {
        ok: false,
        reason: 'log_fetch_failed',
        status: logResult.status,
        failedTask: summarizeFailedTask(failedTask)
      };
    }

    const rawLogText = normalizeLogBody(logResult.body);
    const diagnostics = diagnosticsCatalog.diagnoseLog(rawLogText);
    return {
      ok: true,
      failedTask: summarizeFailedTask(failedTask),
      diagnostics: diagnostics
    };
  } catch (e) {
    if (context && context.log && context.log.warn) {
      context.log.warn('Build diagnostics enrichment failed for build ' + buildId + ': ' + e.message);
    }
    return {
      ok: false,
      reason: 'diagnostics_exception',
      error: e.message
    };
  }
}

function normalizeLogBody(body) {
  if (typeof body === 'string') return body;
  if (body && Array.isArray(body.value)) return body.value.join('\n');
  return JSON.stringify(body || '');
}

function summarizeFailedTask(task) {
  return {
    id: task && task.id || '',
    name: task && task.name || '',
    type: task && task.type || '',
    startTime: task && task.startTime || '',
    finishTime: task && task.finishTime || ''
  };
}

function summarizeDiagnosticsForResponse(diagnosticInfo) {
  if (!diagnosticInfo || !diagnosticInfo.ok || !diagnosticInfo.diagnostics) {
    return diagnosticInfo ? {
      ok: false,
      reason: diagnosticInfo.reason || 'not_available',
      status: diagnosticInfo.status || undefined,
      error: diagnosticInfo.error || undefined
    } : null;
  }
  const diagnostics = diagnosticInfo.diagnostics;
  return {
    ok: true,
    failedTask: diagnosticInfo.failedTask || null,
    errorKey: diagnostics.errorKey,
    failureLayer: diagnostics.failureLayer,
    rootCauseSummary: diagnostics.rootCauseSummary,
    exactError: diagnostics.exactError
  };
}

function buildTeamsMessage(cfg, build, diagnosticInfo, prInfo) {
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
  if (prInfo && prInfo.prId) {
    const prLabel = '#' + safe(prInfo.prId);
    lines.push('| **PR ID** | ' + (prInfo.prUrl ? '[' + prLabel + '](' + prInfo.prUrl + ')' : prLabel) + ' |');
    if (prInfo.prTitle) lines.push('| **PR Title** | ' + safe(prInfo.prTitle) + ' |');
    if (prInfo.prAuthor) lines.push('| **PR Author** | ' + safe(prInfo.prAuthor) + ' |');
  }
  if (requestedBy) lines.push('| **Triggered by** | ' + safe(requestedBy) + ' |');
  if (commit) lines.push('| **Commit** | `' + safe(commit.substring(0, 12)) + '` |');

  appendDiagnosticsSection(lines, diagnosticInfo);

  if (diagnosticsUrl) lines.push('', '🔗 **[เปิดดูหน้าวิเคราะห์บน Dashboard](' + diagnosticsUrl + ')**');
  if (!diagnosticsUrl && buildUrl) lines.push('', '🔗 **[Open Build in Azure DevOps](' + buildUrl + ')**');
  if (cfg && cfg.project) lines.push('', '_Source: ADO REST polling_');
  return lines.join('\n');
}

async function getBuildPullRequestInfo(context, cfg, build) {
  const buildPrId = getBuildPrId(build);
  let prInfo = buildPrId ? { prId: buildPrId } : { prId: '' };

  if (!prInfo.prId && build && build.sourceVersion) {
    prInfo = await findPullRequestByCommit(context, cfg, build);
  }

  if (!prInfo.prId) return prInfo;
  return enrichPullRequestInfo(context, cfg, build, prInfo.prId);
}

function getBuildPrId(build) {
  const triggerInfo = build && build.triggerInfo || {};
  const direct = triggerInfo['pr.number'] ||
    triggerInfo['pr.id'] ||
    triggerInfo['MSTFS.PullRequestId'] ||
    extractPrId(triggerInfo['ci.message']) ||
    extractPrId(triggerInfo['wip.message']) ||
    extractPrId(build && build.sourceBranch) ||
    extractPrId(build && build.buildNumber);
  return direct ? String(direct) : '';
}

async function findPullRequestByCommit(context, cfg, build) {
  const commit = String(build && build.sourceVersion || '').toLowerCase();
  if (!commit) return { prId: '' };
  const statuses = ['active', 'completed'];
  for (const status of statuses) {
    try {
      const path = '/' + encodeURIComponent(cfg.org) + '/' + encodeURIComponent(cfg.project) +
        '/_apis/git/pullrequests?api-version=7.0' +
        '&searchCriteria.status=' + encodeURIComponent(status) +
        '&$top=200';
      const result = await ado.adoRequest('GET', path);
      const prs = result.ok && result.body && Array.isArray(result.body.value)
        ? result.body.value
        : [];
      const matched = prs.find(pr => pullRequestMatchesBuild(pr, build, commit));
      if (matched) {
        return {
          prId: String(matched.pullRequestId || matched.codeReviewId || ''),
          prTitle: matched.title || '',
          prAuthor: matched.createdBy && matched.createdBy.displayName || '',
          repositoryName: matched.repository && matched.repository.name || ''
        };
      }
    } catch (e) {
      if (context && context.log && context.log.warn) {
        context.log.warn('Build PR lookup failed for status ' + status + ': ' + e.message);
      }
    }
  }
  return { prId: '' };
}

function pullRequestMatchesBuild(pr, build, commit) {
  if (!pr || !commit) return false;
  const repoName = String(build && build.repository && build.repository.name || '').toLowerCase();
  const prRepoName = String(pr.repository && pr.repository.name || '').toLowerCase();
  if (repoName && prRepoName && repoName !== prRepoName) return false;

  const targetRef = String(pr.targetRefName || '').toLowerCase();
  const buildBranch = String(build && build.sourceBranch || '').toLowerCase();
  if (targetRef && buildBranch && targetRef !== buildBranch) return false;

  const commitCandidates = [
    pr.lastMergeSourceCommit && pr.lastMergeSourceCommit.commitId,
    pr.lastMergeTargetCommit && pr.lastMergeTargetCommit.commitId,
    pr.lastMergeCommit && pr.lastMergeCommit.commitId
  ].map(value => String(value || '').toLowerCase()).filter(Boolean);

  return commitCandidates.some(value => value === commit || value.startsWith(commit) || commit.startsWith(value));
}

async function enrichPullRequestInfo(context, cfg, build, prId) {
  const repoName = build && build.repository && build.repository.name || '';
  const fallbackUrl = buildPrUrl(cfg, repoName, prId);
  try {
    const prResult = await ado.getPullRequest(prId);
    if (prResult.ok && prResult.body) {
      const pr = prResult.body;
      const resolvedRepo = repoName || pr.repository && pr.repository.name || '';
      return {
        prId: String(prId),
        prTitle: pr.title || '',
        prAuthor: pr.createdBy && pr.createdBy.displayName || '',
        prUrl: buildPrUrl(cfg, resolvedRepo, prId) || fallbackUrl
      };
    }
  } catch (e) {
    if (context && context.log && context.log.warn) {
      context.log.warn('Build PR enrichment failed for PR #' + prId + ': ' + e.message);
    }
  }
  return {
    prId: String(prId),
    prUrl: fallbackUrl
  };
}

function buildPrUrl(cfg, repoName, prId) {
  if (!cfg || !cfg.org || !cfg.project || !repoName || !prId) return '';
  return 'https://dev.azure.com/' + encodeURIComponent(cfg.org) + '/' + encodeURIComponent(cfg.project) +
    '/_git/' + encodeURIComponent(repoName) + '/pullrequest/' + encodeURIComponent(String(prId));
}

function summarizePrInfoForResponse(prInfo) {
  if (!prInfo || !prInfo.prId) return null;
  return {
    prId: prInfo.prId,
    prTitle: prInfo.prTitle || '',
    prAuthor: prInfo.prAuthor || '',
    prUrl: prInfo.prUrl || ''
  };
}

function extractPrId(value) {
  const text = String(value || '');
  const patterns = [
    /pullrequest\/(\d+)/i,
    /pull request[^\d]*(\d+)/i,
    /\bpr[ #:_-]*(\d+)\b/i,
    /refs\/pull\/(\d+)\//i,
    /refs\/pull\/(\d+)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return '';
}

function appendDiagnosticsSection(lines, diagnosticInfo) {
  if (!diagnosticInfo || !diagnosticInfo.ok || !diagnosticInfo.diagnostics) {
    if (diagnosticInfo && diagnosticInfo.reason) {
      lines.push('', '### 🔍 วิเคราะห์สาเหตุหลัก', 'ไม่สามารถดึง log เพื่อวิเคราะห์ root cause ได้ในรอบ polling นี้: `' + safe(diagnosticInfo.reason) + '`');
    }
    return;
  }

  const diagnostics = diagnosticInfo.diagnostics;
  const exactError = diagnostics.exactError || {};
  const exactLocation = formatLocation(exactError);
  const failedCommand = exactError.command || '';
  const failedStep = diagnosticInfo.failedTask && diagnosticInfo.failedTask.name || '';

  lines.push('', '### 🔍 วิเคราะห์สาเหตุหลัก');
  lines.push(diagnostics.rootCauseSummary || diagnostics.description || diagnostics.title || 'พบ build failure แต่ไม่พบรายละเอียด root cause เพิ่มเติม');
  lines.push('', '| Field | Value |', '|---|---|');
  if (failedStep) lines.push('| Failed Step | ' + safe(failedStep) + ' |');
  lines.push('| Root Cause Key | ' + safe(diagnostics.errorKey || '-') + ' |');
  if (diagnostics.failureLayer) lines.push('| Failure Layer | ' + safe(diagnostics.failureLayer) + ' |');
  if (failedCommand) lines.push('| Failed Command | `' + safe(failedCommand) + '` |');
  if (exactLocation) lines.push('| File | `' + safe(exactLocation) + '` |');
  if (exactError.message) lines.push('| Message | ' + safe(exactError.message) + ' |');

  const impactChain = Array.isArray(diagnostics.impactChain) ? diagnostics.impactChain : [];
  if (impactChain.length) {
    lines.push('', '### ผลกระทบต่อเนื่อง');
    impactChain.forEach(item => lines.push('- ' + safe(item)));
  }

  const warnings = Array.isArray(diagnostics.warnings) ? diagnostics.warnings : [];
  if (warnings.length) {
    lines.push('', '### คำเตือนที่ไม่ใช่สาเหตุหลัก');
    warnings.forEach(item => lines.push('- ' + safe(item)));
  }

  const solutions = Array.isArray(diagnostics.solutions) ? diagnostics.solutions : [];
  if (solutions.length) {
    lines.push('', '### แนวทางแก้ไข');
    solutions.forEach(sol => {
      lines.push('* **' + safe(sol.title) + '**');
      if (sol.details) lines.push(safe(sol.details), '');
    });
  }
}

function formatLocation(exactError) {
  if (!exactError || !exactError.file) return '';
  let location = exactError.file;
  if (exactError.line) {
    location += ':' + exactError.line;
    if (exactError.column) location += ':' + exactError.column;
  }
  return location;
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
