/**
 * POST /api/reject-pr
 *
 * Body: { prId, repositoryId, reason }
 *
 * 1. Bot vote = -10 (Rejected)
 * 2. Log SharePoint
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
    const reason = (body && body.reason) ? String(body.reason).trim() : '';

    if (!prId || !repositoryId) {
      jsonResponse(400, { ok: false, error: 'Missing prId or repositoryId in body' });
      return;
    }
    if (!reason || reason.length < 3) {
      jsonResponse(400, { ok: false, error: 'Reason is required for reject (at least 3 chars)' });
      return;
    }

    const ado = require('../shared/ado-client');

    // bot identity
    let botUserId;
    try {
      const conn = await ado.getConnectionData();
      botUserId = conn.body.authenticatedUser.id;
    } catch (e) {
      jsonResponse(500, { ok: false, error: 'Failed to identify bot user', detail: e.message });
      return;
    }

    // PR detail (security: ตรวจ target branch)
    const prResult = await ado.getPullRequest(prId);
    if (!prResult.ok) {
      jsonResponse(502, { ok: false, error: 'Cannot fetch PR' });
      return;
    }
    const pr = prResult.body;
    const expectedBranchPrefix = (process.env.ADO_TARGET_BRANCH || 'refs/heads/staging').toLowerCase();
    const actualTargetBranch = pr.targetRefName || '';
    if (isMergeCodeBranch(actualTargetBranch)) {
      jsonResponse(409, {
        ok: false,
        error: 'MergeCode PR requires manual review in Azure DevOps',
        hint: 'Open the pull request in Azure DevOps and approve, reject, or complete it manually.',
        targetBranch: actualTargetBranch
      });
      return;
    }
    if (!actualTargetBranch.toLowerCase().startsWith(expectedBranchPrefix)) {
      jsonResponse(403, {
        ok: false,
        error: 'PR target is not Staging - refuse to reject',
        actual: actualTargetBranch,
        expected: expectedBranchPrefix + '*'
      });
      return;
    }

    const holdState = await getApprovalHoldState(context, prId);
    if (holdState.active) {
      jsonResponse(423, {
        ok: false,
        error: 'PR is on Approval Hold',
        detail: holdState.reason || 'Unlock this PR before rejecting from Dashboard',
        hold: holdState
      });
      return;
    }

    // Vote = -10
    const voteResult = await ado.rejectPR(prId, repositoryId, botUserId);
    if (!voteResult.ok) {
      jsonResponse(502, {
        ok: false,
        error: 'Failed to reject in ADO',
        detail: 'HTTP ' + voteResult.status
      });
      const statusSnapshot = await getStatusSnapshot(context, ado, pr, repositoryId, prId, null);
      await logToSharePoint(context, {
        prId, action: 'Failed', user: userEmail, repository: pr.repository.name,
        prTitle: pr.title, targetBranch: pr.targetRefName,
        result: 'Reject vote failed: HTTP ' + voteResult.status, reason: reason,
        ...statusSnapshot
      });
      await notifyOperationFailed(context, {
        operation: 'Reject',
        prId: prId,
        user: userEmail,
        repository: pr.repository.name,
        prTitle: pr.title,
        targetBranch: pr.targetRefName,
        error: 'Reject vote failed: HTTP ' + voteResult.status,
        statusSnapshot: statusSnapshot,
        adoPrUrl: getPrUrl(pr)
      });
      return;
    }

    // Log
    let logStatus = 'skipped';
    const statusSnapshot = await getStatusSnapshot(context, ado, pr, repositoryId, prId, null);
    try {
      const logResult = await logToSharePoint(context, {
        prId, action: 'Rejected', user: userEmail, repository: pr.repository.name,
        prTitle: pr.title, targetBranch: pr.targetRefName,
        result: 'Success', reason: reason,
        ...statusSnapshot
      });
      logStatus = logResult.ok ? 'logged' : 'failed: HTTP ' + logResult.status;
    } catch (e) {
      logStatus = 'failed: ' + e.message;
    }
    const notificationStatus = await notifyRejected(context, {
      prId: prId,
      user: userEmail,
      repository: pr.repository.name,
      prTitle: pr.title,
      targetBranch: pr.targetRefName,
      reason: reason,
      statusSnapshot: statusSnapshot,
      adoPrUrl: getPrUrl(pr)
    });

    jsonResponse(200, {
      ok: true,
      message: 'PR rejected successfully',
      prId, user: userEmail, reason: reason,
      logStatus: logStatus,
      notificationStatus: notificationStatus,
      statusSnapshot: statusSnapshot,
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

async function notifyRejected(context, opts) {
  try {
    const notifications = require('../shared/notification-service');
    return await notifications.notifyRejected(context, opts);
  } catch (e) {
    context.log.warn('Teams reject notification skipped:', e.message);
    return { ok: false, error: e.message };
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
