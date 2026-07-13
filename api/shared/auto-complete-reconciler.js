const ado = require('./ado-client');
const sp = require('./sharepoint-client');
const approvalHold = require('./approval-hold');

const DEFAULT_SKIP_LABELS = ['no-auto-complete', 'manual-complete', 'hold'];

async function runAutoCompleteReconcile(context, options) {
  const startedAt = new Date().toISOString();
  const opts = normalizeOptions(options);
  const settings = await sp.getAutoApproveSettings();
  const mode = normalizeMode(settings.autoMode);
  const dryRun = opts.dryRun || mode === 'dry-run' || isTrue(process.env.AUTO_COMPLETE_RECONCILE_DRY_RUN);

  if (mode === 'normal') {
    const skipped = buildResult({
      ok: true,
      skipped: true,
      reason: 'Auto-Approve mode is normal',
      mode,
      dryRun,
      startedAt,
      finishedAt: new Date().toISOString()
    });
    logSummary(context, skipped);
    return skipped;
  }

  const cfg = getReconcileConfig();
  const identityResult = await ado.getConnectionData();
  if (!identityResult.ok || !identityResult.body || !identityResult.body.authenticatedUser) {
    return buildResult({
      ok: false,
      error: 'Cannot resolve service account identity: HTTP ' + identityResult.status,
      mode,
      dryRun,
      startedAt,
      finishedAt: new Date().toISOString()
    });
  }

  const serviceUser = identityResult.body.authenticatedUser;
  const serviceUserId = serviceUser.id;
  const listResult = await ado.listPullRequestsByStatus('active', {
    top: cfg.pageSize,
    maxPages: cfg.maxPages
  });
  if (!listResult.ok) {
    return buildResult({
      ok: false,
      error: 'ADO active PR query failed: HTTP ' + listResult.status,
      mode,
      dryRun,
      startedAt,
      finishedAt: new Date().toISOString()
    });
  }

  const activePrs = listResult.body && Array.isArray(listResult.body.value)
    ? listResult.body.value
    : [];
  const targetPrs = activePrs.filter(pr => isPotentialTarget(pr, cfg));
  const holdStates = await getHoldStates(context, targetPrs);
  const rows = [];
  const errors = [];
  let candidates = 0;
  let fixed = 0;
  let skipped = 0;

  for (const pr of targetPrs) {
    const prId = pr.pullRequestId;
    const repoName = pr.repository && pr.repository.name || '';
    const targetBranch = pr.targetRefName || '';
    try {
      const eligibility = await getResetEligibility(pr, cfg, holdStates[prId]);
      if (!eligibility.eligible) {
        skipped += 1;
        rows.push(buildRow(pr, 'skipped', eligibility.reason));
        continue;
      }

      candidates += 1;
      if (dryRun) {
        skipped += 1;
        const message = `DRY RUN: would restore auto-complete for PR #${prId} repo=${repoName} target=${targetBranch}`;
        logInfo(context, message);
        rows.push(buildRow(pr, 'dry-run', 'would restore auto-complete'));
        continue;
      }

      const patchResult = await ado.setAutoComplete(prId, getRepositoryId(pr), serviceUserId, {
        existingOptions: pr.completionOptions || {}
      });
      if (patchResult.ok) {
        fixed += 1;
        const message = `Auto-complete restored: PR #${prId} repo=${repoName} target=${targetBranch}`;
        logInfo(context, message);
        rows.push(buildRow(pr, 'fixed', 'auto-complete restored'));
      } else {
        const error = `PR #${prId} HTTP ${patchResult.status}`;
        errors.push(error);
        logWarn(context, `Auto-complete restore failed: ${error} ${safeDetail(patchResult.body)}`);
        rows.push(buildRow(pr, 'error', error));
      }
    } catch (e) {
      const error = `PR #${prId}: ${e.message}`;
      errors.push(error);
      logWarn(context, 'Auto-complete restore failed: ' + error);
      rows.push(buildRow(pr, 'error', e.message));
    }
  }

  const result = buildResult({
    ok: errors.length === 0,
    source: 'Auto-Complete Reconciler',
    mode,
    dryRun,
    startedAt,
    finishedAt: new Date().toISOString(),
    totalActive: activePrs.length,
    pagesFetched: listResult.pagesFetched || 1,
    checked: targetPrs.length,
    candidates,
    fixed,
    skipped,
    errors: errors.slice(0, 10),
    targetBranchPatterns: cfg.targetPatterns,
    repoAllowlist: cfg.repoAllowlist,
    reviewerGroup: cfg.reviewerGroup,
    rows
  });

  logSummary(context, result);
  if (!dryRun && (fixed > 0 || errors.length > 0)) {
    await writeSummaryLog(context, result, serviceUser);
  }
  return result;
}

function normalizeOptions(options) {
  const payload = options && typeof options === 'object' ? options : {};
  return {
    dryRun: payload.dryRun === true || String(payload.dryRun || '').toLowerCase() === 'true'
  };
}

function getReconcileConfig() {
  return {
    targetPatterns: splitList(process.env.AUTO_COMPLETE_RECONCILE_TARGETS)
      .concat(splitList(process.env.ADO_TARGET_BRANCH))
      .filter(Boolean),
    repoAllowlist: splitList(process.env.AUTO_COMPLETE_RECONCILE_REPOS),
    skipLabels: splitList(process.env.AUTO_COMPLETE_RECONCILE_SKIP_LABELS, DEFAULT_SKIP_LABELS),
    reviewerGroup: process.env.ADO_REVIEWER_GROUP || 'IT Support Approve',
    pageSize: clampNumber(process.env.AUTO_COMPLETE_RECONCILE_PAGE_SIZE, 25, 500, 100),
    maxPages: clampNumber(process.env.AUTO_COMPLETE_RECONCILE_MAX_PAGES, 1, 50, 10),
    holdLookbackDays: clampNumber(process.env.APPROVAL_HOLD_LOOKBACK_DAYS, 1, 365, 180),
    holdLogLimit: clampNumber(process.env.APPROVAL_HOLD_LOG_LOOKUP_LIMIT, 100, 5000, 1000)
  };
}

function isPotentialTarget(pr, cfg) {
  if (!pr || String(pr.status || '').toLowerCase() !== 'active') return false;
  const repoName = pr.repository && pr.repository.name || '';
  if (cfg.repoAllowlist.length && !cfg.repoAllowlist.includes(repoName)) return false;
  return matchesAnyBranchPattern(pr.targetRefName || '', cfg.targetPatterns);
}

async function getResetEligibility(pr, cfg, holdState) {
  if (!pr) return { eligible: false, reason: 'missing PR' };
  if (String(pr.status || '').toLowerCase() !== 'active') return { eligible: false, reason: 'status is not active' };
  if (pr.isDraft === true) return { eligible: false, reason: 'PR is draft' };
  if (isMergeCodeBranch(pr.targetRefName)) return { eligible: false, reason: 'MergeCode branch requires manual approval' };
  if (!matchesAnyBranchPattern(pr.targetRefName || '', cfg.targetPatterns)) return { eligible: false, reason: 'target branch is out of scope' };
  if (cfg.repoAllowlist.length && !cfg.repoAllowlist.includes(pr.repository && pr.repository.name || '')) {
    return { eligible: false, reason: 'repo is out of scope' };
  }
  if (holdState && holdState.active) return { eligible: false, reason: 'Approval Hold is active' };
  if (hasSkipLabel(pr, cfg.skipLabels)) return { eligible: false, reason: 'skip label is present' };
  if (pr.autoCompleteSetBy && pr.autoCompleteSetBy.id) return { eligible: false, reason: 'auto-complete already set' };
  if (!hasReviewerGroup(pr, cfg.reviewerGroup)) return { eligible: false, reason: 'reviewer group is missing' };

  const prior = await hasPriorAutoApprovedLog(pr.pullRequestId);
  if (!prior) return { eligible: false, reason: 'no prior Auto Approved log' };
  return { eligible: true, reason: 'ready' };
}

async function hasPriorAutoApprovedLog(prId) {
  const result = await sp.getLogForPR(prId);
  if (!result.ok) return false;
  const items = result.body && Array.isArray(result.body.value) ? result.body.value : [];
  return items.some(item => {
    const fields = item && item.fields || {};
    return String(fields.Action || '').trim().toLowerCase() === 'auto approved';
  });
}

async function getHoldStates(context, prs) {
  try {
    const cfg = getReconcileConfig();
    return await approvalHold.getHoldStatesFromRecent(
      prs.map(pr => pr.pullRequestId),
      cfg.holdLookbackDays,
      cfg.holdLogLimit
    );
  } catch (e) {
    logWarn(context, 'Auto-complete reconciler hold lookup skipped: ' + e.message);
    const states = {};
    for (const pr of prs) states[pr.pullRequestId] = { active: false, error: e.message };
    return states;
  }
}

async function writeSummaryLog(context, result, serviceUser) {
  try {
    const eventKey = 'auto-complete-reconcile:summary:' + new Date(result.startedAt).toISOString();
    const reason = [
      'Checked ' + result.checked,
      'Candidates ' + result.candidates,
      'Fixed ' + result.fixed,
      'Skipped ' + result.skipped,
      'Errors ' + result.errors.length,
      'Dry run ' + result.dryRun
    ].join(' | ');
    await sp.addLogItem(sp.buildLogFields({
      prId: 0,
      action: 'Auto-Complete Reconcile',
      user: serviceUser && (serviceUser.uniqueName || serviceUser.displayName) || 'System',
      repository: '',
      prTitle: 'Auto-complete background reconciliation',
      targetBranch: result.targetBranchPatterns.join(','),
      result: result.ok ? 'Success' : 'Completed with errors',
      reason,
      source: 'Logic Apps Auto-Complete Reconciler',
      eventKey,
      lastCheckedAt: result.finishedAt
    }));
  } catch (e) {
    logWarn(context, 'Auto-complete reconciler summary log failed: ' + e.message);
  }
}

function matchesAnyBranchPattern(branch, patterns) {
  const branchName = String(branch || '');
  const list = Array.isArray(patterns) && patterns.length ? patterns : ['refs/heads/staging'];
  return list.some(pattern => matchBranchPattern(branchName, pattern));
}

function matchBranchPattern(branch, pattern) {
  const source = String(branch || '').toLowerCase();
  const raw = String(pattern || '').trim();
  if (!raw) return false;
  const target = raw.toLowerCase();
  if (target.endsWith('*')) {
    return source.startsWith(target.slice(0, -1));
  }
  return source === target || source.startsWith(target.endsWith('/') ? target : target + '/');
}

function hasReviewerGroup(pr, groupName) {
  const reviewers = Array.isArray(pr && pr.reviewers) ? pr.reviewers : [];
  const target = String(groupName || '').toLowerCase().trim();
  if (!target) return true;
  if (reviewers.length === 0) return false;
  return reviewers.some(reviewer =>
    reviewer &&
    reviewer.isContainer === true &&
    String(reviewer.displayName || '').toLowerCase().includes(target)
  );
}

function hasSkipLabel(pr, skipLabels) {
  const skip = new Set((skipLabels || []).map(normalizeLabel).filter(Boolean));
  if (!skip.size) return false;
  const labels = Array.isArray(pr && pr.labels) ? pr.labels : [];
  return labels.some(label => {
    const name = normalizeLabel(label && (label.name || label.id) || label);
    return name && skip.has(name);
  });
}

function buildRow(pr, status, reason) {
  return {
    prId: pr && pr.pullRequestId,
    repository: pr && pr.repository && pr.repository.name || '',
    repositoryId: getRepositoryId(pr),
    targetBranch: pr && pr.targetRefName || '',
    title: pr && pr.title || '',
    status,
    reason
  };
}

function buildResult(result) {
  return Object.assign({
    ok: true,
    source: 'Auto-Complete Reconciler',
    checked: 0,
    candidates: 0,
    fixed: 0,
    skipped: 0,
    errors: []
  }, result);
}

function logSummary(context, result) {
  logInfo(context, `Auto-complete reconciler summary: checked=${result.checked || 0} candidates=${result.candidates || 0} fixed=${result.fixed || 0} skipped=${result.skipped || 0} errors=${(result.errors || []).length} dryRun=${result.dryRun === true}`);
}

function logInfo(context, message) {
  if (context && context.log) context.log(message);
}

function logWarn(context, message) {
  if (context && context.log && context.log.warn) context.log.warn(message);
  else logInfo(context, message);
}

function splitList(value, fallback) {
  const raw = value === undefined || value === null || value === ''
    ? (Array.isArray(fallback) ? fallback.join(',') : '')
    : String(value);
  return raw.split(',').map(item => item.trim()).filter(Boolean);
}

function clampNumber(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  const number = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(number, min), max);
}

function normalizeMode(mode) {
  const value = String(mode || 'normal').toLowerCase();
  return value === 'active' || value === 'dry-run' ? value : 'normal';
}

function isTrue(value) {
  return value === true || String(value || '').toLowerCase() === 'true';
}

function normalizeLabel(value) {
  return String(value || '').trim().toLowerCase();
}

function isMergeCodeBranch(refName) {
  return String(refName || '').toLowerCase().includes('mergecode');
}

function getRepositoryId(pr) {
  return pr && pr.repository && pr.repository.id || '';
}

function safeDetail(body) {
  try {
    return JSON.stringify(body || '').substring(0, 300);
  } catch (e) {
    return String(body || '').substring(0, 300);
  }
}

module.exports = {
  runAutoCompleteReconcile,
  getResetEligibility,
  hasPriorAutoApprovedLog,
  matchesAnyBranchPattern,
  matchBranchPattern,
  hasSkipLabel,
  hasReviewerGroup,
  getReconcileConfig
};
