/**
 * POST /api/hourly-log-sync
 *
 * Background reconciliation endpoint for Azure Logic Apps Consumption.
 * Keeps SharePoint audit logs complete without requiring logs.html/dashboard
 * to be opened in a browser.
 */

const ado = require('../shared/ado-client');
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
    const expectedToken = process.env.HOURLY_SYNC_TOKEN || process.env.DAILY_SUMMARY_TOKEN || '';
    if (!expectedToken) {
      jsonResponse(500, { ok: false, error: 'HOURLY_SYNC_TOKEN or DAILY_SUMMARY_TOKEN is not configured' });
      return;
    }

    const suppliedToken = getHeader(req, 'x-hourly-sync-token') ||
      getHeader(req, 'x-daily-summary-token') ||
      (req.query && req.query.token);
    if (suppliedToken !== expectedToken) {
      jsonResponse(401, { ok: false, error: 'Unauthorized' });
      return;
    }

    const options = parseOptions(req.body);
    const result = await runHourlyLogSync(context, options);
    jsonResponse(result.ok ? 200 : 502, result);
  } catch (err) {
    context.log.error('Hourly log sync failed:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};

async function runHourlyLogSync(context, options) {
  const startedAt = new Date().toISOString();
  const cfg = ado.getConfig();
  if (process.env.ADO_EXTERNAL_LOG_SYNC === 'false') {
    return {
      ok: true,
      source: 'Hourly Log Sync',
      skipped: true,
      reason: 'ADO_EXTERNAL_LOG_SYNC is false',
      startedAt: startedAt,
      finishedAt: new Date().toISOString(),
      checkedPrs: 0,
      checkedVotes: 0,
      inserted: 0,
      errors: []
    };
  }

  const stagingPrefix = String(process.env.ADO_TARGET_BRANCH || 'refs/heads/staging').toLowerCase();
  const activePrResult = await listPullRequestsByStatus(cfg, 'active', options.maxPrs);
  if (!activePrResult.ok) {
    return {
      ok: false,
      source: 'Hourly Log Sync',
      error: 'ADO active PR query failed: HTTP ' + activePrResult.status,
      checkedPrs: 0,
      inserted: 0,
      skipped: 0,
      errors: []
    };
  }
  const completedPrResult = await listPullRequestsByStatus(cfg, 'completed', options.maxPrs);
  if (!completedPrResult.ok && context && context.log && context.log.warn) {
    context.log.warn('Hourly sync completed PR query returned HTTP ' + completedPrResult.status);
  }

  const activePrs = activePrResult.body && Array.isArray(activePrResult.body.value)
    ? activePrResult.body.value
    : [];
  const completedPrs = completedPrResult.ok && completedPrResult.body && Array.isArray(completedPrResult.body.value)
    ? completedPrResult.body.value
    : [];
  const allPrs = dedupePullRequests(activePrs.concat(filterRecentCompletedPrs(completedPrs, options.lookbackHours)));
  const targetPrs = allPrs
    .filter(pr => String(pr && pr.targetRefName || '').toLowerCase().startsWith(stagingPrefix))
    .slice(0, options.maxPrs);
  const botIdentities = await getBotIdentities(context);
  const branchBuildCache = {};
  const rows = [];
  let checkedVotes = 0;
  let inserted = 0;
  let skipped = 0;
  const errors = [];

  for (const pr of targetPrs) {
    try {
      const row = await buildPrAuditRow(context, cfg, pr, branchBuildCache);
      const existingResult = await sp.getLogForPR(row.id);
      const existing = existingResult.ok && existingResult.body && Array.isArray(existingResult.body.value)
        ? existingResult.body.value.map(item => item.fields || {})
        : [];
      if (!existingResult.ok) {
        errors.push('PR #' + row.id + ': SharePoint history HTTP ' + existingResult.status);
      }

      const voteEvents = buildExternalVoteEvents(row, botIdentities);
      let rowInserted = 0;
      let rowSkipped = 0;
      for (const event of voteEvents) {
        checkedVotes += 1;
        if (hasExistingVoteLog(existing, event)) {
          skipped += 1;
          rowSkipped += 1;
          continue;
        }

        if (options.dryRun) {
          skipped += 1;
          rowSkipped += 1;
          continue;
        }

        const fields = sp.buildLogFields({
          prId: row.id,
          action: event.action,
          user: event.user,
          repository: row.repository,
          prTitle: row.title,
          targetBranch: row.targetBranch,
          result: event.result,
          reason: 'Detected by hourly background sync from Azure DevOps reviewer vote',
          source: 'Hourly Log Sync',
          eventKey: event.eventKey,
          buildStatus: row.statusSnapshot.buildStatus,
          buildResult: row.statusSnapshot.buildResult,
          policyStatus: row.statusSnapshot.policyStatus,
          mergeStatus: row.statusSnapshot.mergeStatus || row.mergeStatus,
          autoCompleteStatus: row.statusSnapshot.autoCompleteStatus,
          lastCheckedAt: row.statusSnapshot.lastCheckedAt,
          adoBuildUrl: row.statusSnapshot.adoBuildUrl,
          adoPrUrl: row.url
        });
        const addResult = await sp.addLogItem(fields);
        if (addResult.ok) {
          inserted += 1;
          rowInserted += 1;
          existing.push(fields);
        } else {
          errors.push('PR #' + row.id + ' ' + event.action + ': HTTP ' + addResult.status);
        }
      }

      rows.push({
        prId: row.id,
        repository: row.repository,
        targetBranch: row.targetBranch,
        votes: voteEvents.length,
        inserted: rowInserted,
        skipped: rowSkipped,
        buildResult: row.statusSnapshot.buildResult,
        policyStatus: row.statusSnapshot.policyStatus
      });
    } catch (e) {
      errors.push('PR #' + (pr && pr.pullRequestId || '?') + ': ' + e.message);
    }
  }

  const finishedAt = new Date().toISOString();
  const result = {
    ok: errors.length === 0,
    source: 'Hourly Log Sync',
    dryRun: options.dryRun,
    startedAt: startedAt,
    finishedAt: finishedAt,
    lookbackHours: options.lookbackHours,
    targetBranchPrefix: stagingPrefix,
    totalActive: activePrs.length,
    totalCompletedFetched: completedPrs.length,
    checkedPrs: targetPrs.length,
    checkedVotes: checkedVotes,
    inserted: inserted,
    skipped: skipped,
    errors: errors.slice(0, 10),
    rows: rows
  };

  if (!options.dryRun) {
    await writeSummaryLog(context, result);
  }
  return result;
}

async function listPullRequestsByStatus(cfg, status, maxPrs) {
  const top = Math.max(1, Math.min(parseInt(maxPrs, 10) || 100, 200));
  const path = '/' + encodeURIComponent(cfg.org) + '/' + encodeURIComponent(cfg.project) +
    '/_apis/git/pullrequests?api-version=7.0&searchCriteria.status=' + encodeURIComponent(status || 'active') + '&$top=' + top;
  return ado.adoRequest('GET', path);
}

function filterRecentCompletedPrs(prs, lookbackHours) {
  const cutoff = Date.now() - (Math.max(1, Number(lookbackHours) || 48) * 60 * 60 * 1000);
  return (Array.isArray(prs) ? prs : []).filter(pr => {
    const closedAt = Date.parse(pr && (pr.closedDate || pr.completionDate || pr.lastMergeCommit && pr.lastMergeCommit.committer && pr.lastMergeCommit.committer.date));
    return Number.isFinite(closedAt) && closedAt >= cutoff;
  });
}

function dedupePullRequests(prs) {
  const seen = new Set();
  const rows = [];
  for (const pr of prs || []) {
    const id = pr && pr.pullRequestId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push(pr);
  }
  return rows;
}

async function buildPrAuditRow(context, cfg, pr, branchBuildCache) {
  const repositoryId = pr.repository && pr.repository.id || '';
  const statusSnapshot = await getStatusSnapshot(context, pr, repositoryId, branchBuildCache);
  return {
    id: pr.pullRequestId,
    title: pr.title || '',
    targetBranch: pr.targetRefName || '',
    repository: pr.repository && pr.repository.name || '',
    repositoryId: repositoryId,
    mergeStatus: pr.mergeStatus || '',
    reviewers: Array.isArray(pr.reviewers) ? pr.reviewers : [],
    statusSnapshot: statusSnapshot,
    url: buildAdoPrUrl(cfg, pr.repository && pr.repository.name, pr.pullRequestId)
  };
}

async function getStatusSnapshot(context, pr, repositoryId, branchBuildCache) {
  try {
    const statusesResult = repositoryId && pr && pr.pullRequestId
      ? await ado.getPullRequestStatuses(repositoryId, pr.pullRequestId)
      : { ok: true, body: { value: [] } };
    const statuses = statusesResult.ok && statusesResult.body && Array.isArray(statusesResult.body.value)
      ? statusesResult.body.value
      : [];

    const policyResult = pr && pr.pullRequestId
      ? await ado.getPolicyEvaluations(pr.pullRequestId)
      : { ok: true, body: { value: [] } };
    if (!policyResult.ok && context && context.log && context.log.warn) {
      context.log.warn('Hourly sync policy lookup returned HTTP ' + policyResult.status + ' for #' + pr.pullRequestId);
    }
    const policyEvaluations = policyResult.ok && policyResult.body && Array.isArray(policyResult.body.value)
      ? policyResult.body.value
      : [];

    let buildRuns = [];
    if (!statuses.some(ado.isBuildStatus) && repositoryId) {
      const buildsResult = await getCachedBuildsForBranch(branchBuildCache, repositoryId, pr.targetRefName);
      if (buildsResult.ok && buildsResult.body && Array.isArray(buildsResult.body.value)) {
        buildRuns = buildsResult.body.value;
      }
    }

    return ado.summarizeStatusSnapshot(pr, statuses, undefined, policyEvaluations, buildRuns);
  } catch (e) {
    if (context && context.log && context.log.warn) {
      context.log.warn('Hourly sync status snapshot failed for #' + (pr && pr.pullRequestId) + ': ' + e.message);
    }
    return ado.summarizeStatusSnapshot(pr, [], undefined);
  }
}

async function getCachedBuildsForBranch(cache, repositoryId, branchName) {
  const key = String(repositoryId || '') + '|' + String(branchName || '').toLowerCase();
  if (cache[key]) return cache[key];
  const result = await ado.getBuildsForBranch(repositoryId, branchName, 20);
  cache[key] = result;
  return result;
}

async function getBotIdentities(context) {
  try {
    const conn = await ado.getConnectionData();
    if (conn.ok && conn.body && conn.body.authenticatedUser) {
      const user = conn.body.authenticatedUser;
      return [
        user.id,
        user.uniqueName,
        user.displayName
      ].map(normalizeIdentity).filter(Boolean);
    }
  } catch (e) {
    if (context && context.log && context.log.warn) {
      context.log.warn('Hourly sync bot identity lookup failed: ' + e.message);
    }
  }
  return [];
}

function buildExternalVoteEvents(row, botIdentities) {
  const reviewers = Array.isArray(row.reviewers) ? row.reviewers : [];
  const botSet = new Set(Array.isArray(botIdentities) ? botIdentities : []);
  return reviewers
    .filter(r => r && r.isContainer !== true)
    .map(r => {
      const identity = normalizeIdentity(r.id || r.uniqueName || r.displayName || 'unknown');
      if (!identity || botSet.has(identity)) return null;
      const vote = Number(r.vote) || 0;
      const voteState = getVoteState(vote);
      if (!voteState) return null;
      return {
        action: voteState.action,
        result: voteState.result,
        user: r.uniqueName || r.displayName || r.id || 'Unknown',
        reviewerKey: identity,
        vote: vote,
        eventKey: 'ado-sync:vote:' + row.id + ':' + identity + ':' + vote
      };
    })
    .filter(Boolean);
}

function getVoteState(vote) {
  if (vote >= 10) return { action: 'External Approved', result: 'Approved in Azure DevOps' };
  if (vote === 5) return { action: 'External Approved with Suggestions', result: 'Approved with suggestions in Azure DevOps' };
  if (vote <= -10) return { action: 'External Rejected', result: 'Rejected in Azure DevOps' };
  if (vote === -5) return { action: 'External Waiting Author', result: 'Waiting for author in Azure DevOps' };
  return null;
}

function hasExistingVoteLog(existingLogs, event) {
  return (existingLogs || []).some(log => {
    if (log.Event_Key && log.Event_Key === event.eventKey) return true;
    const action = String(log.Action || '').toLowerCase();
    const user = normalizeIdentity(log.User);
    const sameAction =
      action === event.action.toLowerCase() ||
      (event.action === 'External Approved' && (action === 'approved' || action === 'auto approved')) ||
      (event.action === 'External Rejected' && action === 'rejected');
    return sameAction && user && (
      user === normalizeIdentity(event.user) ||
      user === event.reviewerKey
    );
  });
}

async function writeSummaryLog(context, result) {
  const hourKey = new Date(result.startedAt).toISOString().substring(0, 13);
  const eventKey = 'hourly-sync:summary:' + hourKey;
  try {
    const existing = await sp.getLogByEventKey(eventKey);
    const items = existing.ok && existing.body && Array.isArray(existing.body.value)
      ? existing.body.value
      : [];
    if (items.length > 0) return;

    const reason = [
      'Checked PRs ' + result.checkedPrs,
      'Checked votes ' + result.checkedVotes,
      'Inserted ' + result.inserted,
      'Skipped ' + result.skipped,
      'Errors ' + result.errors.length,
      'Lookback ' + result.lookbackHours + 'h',
      'Target ' + result.targetBranchPrefix
    ].join(' | ');

    await sp.addLogItem(sp.buildLogFields({
      prId: 0,
      action: 'Hourly Log Sync',
      user: 'System',
      repository: '',
      prTitle: 'Hourly background log reconciliation',
      targetBranch: result.targetBranchPrefix,
      result: result.ok ? 'Success' : 'Completed with errors',
      reason: reason,
      source: 'Logic Apps Hourly Sync',
      eventKey: eventKey,
      lastCheckedAt: result.finishedAt
    }));
  } catch (e) {
    if (context && context.log && context.log.warn) {
      context.log.warn('Hourly sync summary log failed: ' + e.message);
    }
  }
}

function parseOptions(body) {
  const payload = typeof body === 'string' ? safeJson(body) : (body || {});
  return {
    maxPrs: Math.max(1, Math.min(parseInt(payload.maxPrs, 10) || 100, 200)),
    lookbackHours: Math.max(1, Math.min(parseInt(payload.lookbackHours, 10) || 48, 168)),
    dryRun: String(payload.dryRun || '').toLowerCase() === 'true' || payload.dryRun === true
  };
}

function safeJson(text) {
  try { return JSON.parse(text || '{}'); } catch (e) { return {}; }
}

function getHeader(req, name) {
  const headers = req && req.headers || {};
  const lower = String(name || '').toLowerCase();
  return headers[lower] || headers[name] || headers[Object.keys(headers).find(k => String(k).toLowerCase() === lower)] || '';
}

function normalizeIdentity(value) {
  return String(value || '').trim().toLowerCase();
}

function buildAdoPrUrl(cfg, repository, prId) {
  if (!cfg.org || !cfg.project || !repository || !prId) return '';
  return 'https://dev.azure.com/' + cfg.org + '/' + cfg.project +
    '/_git/' + encodeURIComponent(repository) + '/pullrequest/' + encodeURIComponent(String(prId));
}
