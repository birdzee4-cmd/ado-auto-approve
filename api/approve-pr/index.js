/**
 * POST /api/approve-pr
 *
 * Body: { prId, repositoryId }
 *
 * ลำดับ Phase 3.1:
 *   1. GET PR detail + reviewers
 *   2. GET Branch Policies (เพื่อหา Release Notes policy ID)
 *   3. Set Auto-Complete (merge existing options + uncheck Release Notes)
 *   4. Vote = 10 (Approved)
 *   5. Log SharePoint
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
    const auth = require('../shared/auth');
    const roleCheck = auth.requireRole(context, req);
    if (!roleCheck.ok) {
      jsonResponse(roleCheck.status, roleCheck.body);
      return;
    }

    const userEmail = auth.getUserEmail(roleCheck.principal);

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    const prId = body && body.prId;
    const repositoryId = body && body.repositoryId;
    if (!prId || !repositoryId) {
      jsonResponse(400, { ok: false, error: 'Missing prId or repositoryId in body' });
      return;
    }

    const ado = require('../shared/ado-client');

    let botUserId;
    try {
      const conn = await ado.getConnectionData();
      if (!conn.ok || !conn.body.authenticatedUser) {
        throw new Error('Cannot get bot user identity');
      }
      botUserId = conn.body.authenticatedUser.id;
    } catch (e) {
      jsonResponse(500, { ok: false, error: 'Failed to identify bot user', detail: e.message });
      return;
    }

    // 1) ดึง PR detail
    const prResult = await ado.getPullRequest(prId);
    if (!prResult.ok) {
      jsonResponse(502, { ok: false, error: 'Cannot fetch PR', detail: 'HTTP ' + prResult.status });
      return;
    }
    const pr = prResult.body;

    const expectedBranchPrefix = (process.env.ADO_TARGET_BRANCH || 'refs/heads/staging').toLowerCase();
    const actualTargetBranch = pr.targetRefName || '';
    if (isMergeCodeBranch(actualTargetBranch)) {
      jsonResponse(409, {
        ok: false,
        error: 'MergeCode PR requires manual approval in Azure DevOps',
        hint: 'Open the pull request in Azure DevOps and approve or complete it manually.',
        targetBranch: actualTargetBranch
      });
      return;
    }
    if (!actualTargetBranch.toLowerCase().startsWith(expectedBranchPrefix)) {
      jsonResponse(403, {
        ok: false,
        error: 'PR target is not Staging - refuse to approve',
        actual: actualTargetBranch,
        expected: expectedBranchPrefix + '*'
      });
      const statusSnapshot = await getStatusSnapshot(context, ado, pr, repositoryId, prId, false);
      await logToSharePoint(context, {
        prId, action: 'Failed', user: userEmail, repository: pr.repository.name,
        prTitle: pr.title, targetBranch: actualTargetBranch,
        result: 'Refused: target not staging',
        adoPrUrl: getPrUrl(pr),
        ...statusSnapshot
      });
      return;
    }

    if (pr.status !== 'active') {
      jsonResponse(409, { ok: false, error: 'PR status is not active', status: pr.status });
      return;
    }

    const holdState = await getApprovalHoldState(context, prId);
    if (holdState.active) {
      jsonResponse(423, {
        ok: false,
        error: 'PR is on Approval Hold',
        detail: holdState.reason || 'Unlock this PR before approving from Dashboard',
        hold: holdState
      });
      return;
    }

    // 2) ดึง Branch Policies เพื่อหา Release Notes
    let releaseNotesIgnoreIds = [];
    let policiesFetched = false;
    try {
      const polResult = await ado.getBranchPolicies(repositoryId, actualTargetBranch);
      if (polResult.ok && polResult.body && Array.isArray(polResult.body.value)) {
        policiesFetched = true;
        releaseNotesIgnoreIds = ado.findReleaseNotesPolicyIds(polResult.body.value);
        context.log('Release Notes policy IDs to ignore:', releaseNotesIgnoreIds);
      } else {
        context.log.warn('getBranchPolicies returned HTTP ' + polResult.status);
      }
    } catch (e) {
      context.log.warn('Failed to fetch branch policies:', e.message);
    }

    // 3) Set Auto-Complete (merge existing options + uncheck Release Notes)
    const existingOptions = pr.completionOptions || {};
    const acResult = await ado.setAutoComplete(prId, repositoryId, botUserId, {
      existingOptions: existingOptions,
      releaseNotesIgnoreIds: releaseNotesIgnoreIds
    });
    const autoCompleteOk = acResult.ok;
    if (!autoCompleteOk) {
      context.log.warn('setAutoComplete failed: HTTP ' + acResult.status + ' ' + JSON.stringify(acResult.body).substring(0, 200));
    }

    // 4) Vote = 10
    const voteResult = await ado.approvePR(prId, repositoryId, botUserId);
    if (!voteResult.ok) {
      jsonResponse(502, {
        ok: false,
        error: 'Failed to approve in ADO',
        detail: 'HTTP ' + voteResult.status + ': ' + JSON.stringify(voteResult.body).substring(0, 300),
        autoCompleteOk: autoCompleteOk
      });
      const statusSnapshot = await getStatusSnapshot(context, ado, pr, repositoryId, prId, autoCompleteOk);
      await logToSharePoint(context, {
        prId, action: 'Failed', user: userEmail, repository: pr.repository.name,
        prTitle: pr.title, targetBranch: pr.targetRefName,
        result: 'Vote failed: HTTP ' + voteResult.status,
        adoPrUrl: getPrUrl(pr),
        ...statusSnapshot
      });
      await notifyOperationFailed(context, {
        operation: 'Approve',
        prId: prId,
        user: userEmail,
        repository: pr.repository.name,
        prTitle: pr.title,
        targetBranch: pr.targetRefName,
        error: 'Vote failed: HTTP ' + voteResult.status,
        statusSnapshot: statusSnapshot,
        adoPrUrl: getPrUrl(pr)
      });
      return;
    }

    // 5) Log SharePoint
    const autoApproved = body && body.autoApproved === true;
    const actionName = autoApproved ? 'Auto Approved' : 'Approved';
    let logStatus = 'skipped';
    const resultText = (autoCompleteOk ? 'Success (auto-complete enabled' : 'Vote OK (auto-complete failed') +
      (releaseNotesIgnoreIds.length > 0 ? ', Release Notes ignored)' : ')');
    const statusSnapshot = await getStatusSnapshot(context, ado, pr, repositoryId, prId, autoCompleteOk);
    try {
      const logResult = await logToSharePoint(context, {
        prId, action: actionName, user: userEmail, repository: pr.repository.name,
        prTitle: pr.title, targetBranch: pr.targetRefName,
        result: resultText,
        adoPrUrl: getPrUrl(pr),
        ...statusSnapshot
      });
      logStatus = logResult.ok ? 'logged' : 'failed: HTTP ' + logResult.status;
    } catch (e) {
      logStatus = 'failed: ' + e.message;
    }

    jsonResponse(200, {
      ok: true,
      message: 'PR approved successfully',
      prId,
      user: userEmail,
      autoComplete: autoCompleteOk,
      policiesFetched: policiesFetched,
      releaseNotesIgnored: releaseNotesIgnoreIds.length,
      statusSnapshot: statusSnapshot,
      logStatus: logStatus,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    context.log.error('Unexpected error:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};

function isMergeCodeBranch(refName) {
  return String(refName || '').toLowerCase().includes('mergecode');
}

async function getApprovalHoldState(context, prId) {
  try {
    const hold = require('../shared/approval-hold');
    const result = await hold.getHoldState(prId);
    return result.state || { active: false };
  } catch (e) {
    context.log.warn('Approval Hold check failed:', e.message);
    return { active: false, error: e.message };
  }
}

async function getStatusSnapshot(context, ado, pr, repositoryId, prId, autoCompleteOk) {
  try {
    const result = await ado.getPullRequestStatuses(repositoryId, prId);
    const statuses = result.ok && result.body && Array.isArray(result.body.value)
      ? result.body.value
      : [];
    const policyResult = await ado.getPolicyEvaluations(prId);
    const policyEvaluations = policyResult.ok && policyResult.body && Array.isArray(policyResult.body.value)
      ? policyResult.body.value
      : [];
    return ado.summarizeStatusSnapshot(pr, statuses, autoCompleteOk, policyEvaluations);
  } catch (e) {
    context.log.warn('Failed to get PR status snapshot:', e.message);
    return ado.summarizeStatusSnapshot(pr, [], autoCompleteOk);
  }
}

async function logToSharePoint(context, opts) {
  try {
    const sp = require('../shared/sharepoint-client');
    const fields = sp.buildLogFields(opts);
    return await sp.addLogItem(fields);
  } catch (e) {
    context.log.warn('SharePoint log failed:', e.message);
    return { ok: false, status: 0, body: e.message };
  }
}

async function notifyOperationFailed(context, opts) {
  try {
    const notifications = require('../shared/notification-service');
    return await notifications.notifyOperationFailed(context, opts);
  } catch (e) {
    context.log.warn('Teams failure notification skipped:', e.message);
    return { ok: false, error: e.message };
  }
}

function getPrUrl(pr) {
  const org = process.env.ADO_ORGANIZATION;
  const project = process.env.ADO_PROJECT;
  if (!org || !project || !pr || !pr.repository || !pr.repository.name || !pr.pullRequestId) return '';
  return 'https://dev.azure.com/' + org + '/' + project +
    '/_git/' + pr.repository.name + '/pullrequest/' + pr.pullRequestId;
}
