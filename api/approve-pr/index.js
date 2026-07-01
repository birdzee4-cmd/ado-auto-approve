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
  const responseHeaders = {};
  let approvalLock = null;
  let approvalLockStore = null;
  let approvalLockFinished = false;
  function jsonResponse(status, payload) {
    const headers = Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, responseHeaders);
    context.res = {
      status: status,
      headers: headers,
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
    const delegated = require('../shared/ado-user-token');
    const userToken = await delegated.getValidAccessToken(req, roleCheck.principal);
    if (!userToken.ok) {
      jsonResponse(userToken.status || 428, {
        ok: false,
        error: userToken.error || 'Azure DevOps connection required',
        hint: 'Connect Azure DevOps from Dashboard before approving as your own account.',
        connectUrl: '/api/ado-auth-start?returnTo=/dashboard.html'
      });
      return;
    }
    if (userToken.setCookie) responseHeaders['Set-Cookie'] = userToken.setCookie;
    const userAdoAuth = { accessToken: userToken.accessToken };

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

    let approverUserId;
    try {
      const conn = await ado.getConnectionData(userAdoAuth);
      if (!conn.ok || !conn.body.authenticatedUser) {
        throw new Error('Cannot get Azure DevOps user identity');
      }
      approverUserId = conn.body.authenticatedUser.id;
    } catch (e) {
      jsonResponse(500, { ok: false, error: 'Failed to identify Azure DevOps user', detail: e.message });
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

    const autoApprovedRequest = body && body.autoApproved === true;

    const existingReviewer = findReviewerById(pr.reviewers, approverUserId);
    const alreadyApprovedByUser = existingReviewer && Number(existingReviewer.vote) >= 10;
    const autoCompleteAlreadySet = !!(pr.autoCompleteSetBy && pr.autoCompleteSetBy.id);
    const reviewerGroup = process.env.ADO_REVIEWER_GROUP || 'IT Support Approve';
    const approvedGroupReviewer = findReviewerGroupByName(pr.reviewers, reviewerGroup);
    if (hasApprovalRole(roleCheck.principal) && approvedGroupReviewer && Number(approvedGroupReviewer.vote) >= 10) {
      jsonResponse(200, {
        ok: true,
        skipped: true,
        message: 'Reviewer group already approved this PR',
        prId: prId,
        user: userEmail,
        approvedBy: approvedGroupReviewer.displayName || reviewerGroup,
        autoComplete: autoCompleteAlreadySet,
        lockStatus: 'group-already-approved',
        timestamp: new Date().toISOString()
      });
      return;
    }
    if (alreadyApprovedByUser && autoCompleteAlreadySet) {
      jsonResponse(200, {
        ok: true,
        skipped: true,
        message: 'PR was already approved and auto-complete is already set',
        prId: prId,
        user: userEmail,
        approvedBy: existingReviewer.uniqueName || existingReviewer.displayName || userEmail,
        autoComplete: true,
        lockStatus: 'already-completed',
        timestamp: new Date().toISOString()
      });
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

    approvalLockStore = require('../shared/approval-lock-store');
    try {
      approvalLock = await approvalLockStore.acquireLock('approve-pr', prId, userEmail, {
        repositoryId: repositoryId,
        autoApproved: body && body.autoApproved === true
      });
    } catch (e) {
      context.log.error('Approval lock acquire failed:', e);
      jsonResponse(503, {
        ok: false,
        error: 'Approval lock is unavailable',
        detail: e.message,
        hint: 'Approval was not sent to Azure DevOps. Check Azure Table Storage configuration.'
      });
      return;
    }

    if (!approvalLock.acquired) {
      if (approvalLock.completed) {
        jsonResponse(200, Object.assign({
          prId: prId,
          user: userEmail,
          lockStatus: 'completed'
        }, approvalLock.response));
      } else {
        jsonResponse(409, Object.assign({
          prId: prId,
          user: userEmail,
          lockStatus: 'processing'
        }, approvalLock.response));
      }
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
    const acResult = await ado.setAutoComplete(prId, repositoryId, approverUserId, {
      existingOptions: existingOptions,
      releaseNotesIgnoreIds: releaseNotesIgnoreIds,
      requestOptions: userAdoAuth
    });
    const autoCompleteOk = acResult.ok;
    if (!autoCompleteOk) {
      context.log.warn('setAutoComplete failed: HTTP ' + acResult.status + ' ' + JSON.stringify(acResult.body).substring(0, 200));
    }

    // 4) Vote = 10
    const voteResult = await ado.approvePR(prId, repositoryId, approverUserId, userAdoAuth);
    if (!voteResult.ok) {
      await safeFailLock(context, approvalLockStore, approvalLock, {
        status: 'vote_failed',
        message: 'Vote failed: HTTP ' + voteResult.status
      });
      approvalLockFinished = true;
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
    const autoApproved = autoApprovedRequest;
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

    await safeCompleteLock(context, approvalLockStore, approvalLock, {
      status: 'approved',
      message: resultText,
      user: userEmail
    });
    approvalLockFinished = true;

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
      lockOperationId: approvalLock.operationId,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    if (approvalLock && approvalLock.acquired && !approvalLockFinished) {
      await safeFailLock(context, approvalLockStore, approvalLock, {
        status: 'unexpected_error',
        message: err.message
      });
    }
    context.log.error('Unexpected error:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};

function isMergeCodeBranch(refName) {
  return String(refName || '').toLowerCase().includes('mergecode');
}

function findReviewerById(reviewers, reviewerId) {
  const list = Array.isArray(reviewers) ? reviewers : [];
  const target = String(reviewerId || '').toLowerCase();
  if (!target) return null;
  return list.find(reviewer =>
    reviewer &&
    String(reviewer.id || '').toLowerCase() === target
  ) || null;
}

function findReviewerGroupByName(reviewers, groupName) {
  const list = Array.isArray(reviewers) ? reviewers : [];
  const target = String(groupName || '').toLowerCase().trim();
  if (!target) return null;
  return list.find(reviewer =>
    reviewer &&
    reviewer.isContainer === true &&
    String(reviewer.displayName || '').toLowerCase().includes(target)
  ) || null;
}

function hasApprovalRole(principal) {
  const roles = principal && Array.isArray(principal.userRoles) ? principal.userRoles : [];
  return roles.some(role => {
    const value = String(role || '').toLowerCase();
    return value === 'it_support_approve' || value === 'admin';
  });
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

async function safeCompleteLock(context, store, lock, result) {
  try {
    if (store && lock && lock.acquired) return await store.completeLock(lock, result);
  } catch (e) {
    context.log.warn('Approval lock complete failed:', e.message);
  }
  return { ok: false };
}

async function safeFailLock(context, store, lock, result) {
  try {
    if (store && lock && lock.acquired) return await store.failLock(lock, result);
  } catch (e) {
    context.log.warn('Approval lock fail update failed:', e.message);
  }
  return { ok: false };
}

function getPrUrl(pr) {
  const org = process.env.ADO_ORGANIZATION;
  const project = process.env.ADO_PROJECT;
  if (!org || !project || !pr || !pr.repository || !pr.repository.name || !pr.pullRequestId) return '';
  return 'https://dev.azure.com/' + org + '/' + project +
    '/_git/' + pr.repository.name + '/pullrequest/' + pr.pullRequestId;
}
