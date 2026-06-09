/**
 * POST /api/approval-hold
 *
 * Body: { prId, action: "hold" | "release", reason }
 *
 * Adds Approval Hold events to SharePoint Log. This blocks Dashboard actions only;
 * Azure DevOps direct approval remains governed by ADO permissions.
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

    const prId = parseInt(body && body.prId, 10) || 0;
    const action = String(body && body.action || '').trim().toLowerCase();
    const reason = String(body && body.reason || '').trim();
    if (!prId || !['hold', 'release'].includes(action)) {
      jsonResponse(400, { ok: false, error: 'Missing prId or invalid action' });
      return;
    }
    if (action === 'hold' && reason.length < 3) {
      jsonResponse(400, { ok: false, error: 'Reason is required for Approval Hold (at least 3 chars)' });
      return;
    }

    const ado = require('../shared/ado-client');
    const hold = require('../shared/approval-hold');
    const prResult = await ado.getPullRequest(prId);
    if (!prResult.ok || !prResult.body) {
      jsonResponse(502, { ok: false, error: 'Cannot fetch PR', detail: 'HTTP ' + prResult.status });
      return;
    }

    const pr = prResult.body;
    const targetBranch = pr.targetRefName || '';
    const expectedBranchPrefix = (process.env.ADO_TARGET_BRANCH || 'refs/heads/staging').toLowerCase();
    if (!targetBranch.toLowerCase().startsWith(expectedBranchPrefix) && !isMergeCodeBranch(targetBranch)) {
      jsonResponse(403, {
        ok: false,
        error: 'PR target is not eligible for Approval Hold',
        actual: targetBranch,
        expected: expectedBranchPrefix + '*'
      });
      return;
    }
    if (!hasReviewerGroup(pr, process.env.ADO_REVIEWER_GROUP || 'IT Support Approve')) {
      jsonResponse(403, {
        ok: false,
        error: 'PR does not include IT Support Approve reviewer group'
      });
      return;
    }

    const current = await hold.getHoldState(prId);
    const currentState = current.state || { active: false };
    if (action === 'hold' && currentState.active) {
      jsonResponse(409, { ok: false, error: 'PR is already on Approval Hold', hold: currentState });
      return;
    }
    if (action === 'release' && !currentState.active) {
      jsonResponse(409, { ok: false, error: 'PR is not on Approval Hold', hold: currentState });
      return;
    }

    const now = new Date().toISOString();
    const logResult = await hold.addHoldLog({
      prId: prId,
      action: action === 'hold' ? hold.HOLD_ACTION : hold.RELEASE_ACTION,
      user: userEmail,
      repository: pr.repository && pr.repository.name || '',
      prTitle: pr.title || '',
      targetBranch: targetBranch,
      result: action === 'hold' ? 'On Hold' : 'Released',
      reason: reason || (action === 'release' ? 'Approval Hold released' : ''),
      eventKey: 'approval-hold:' + action + ':' + prId + ':' + Date.now(),
      adoPrUrl: getPrUrl(pr)
    });

    jsonResponse(200, {
      ok: true,
      prId: prId,
      action: action,
      hold: action === 'hold'
        ? { active: true, reason: reason, heldBy: userEmail, heldAt: now, result: 'On Hold' }
        : { active: false, reason: reason, releasedBy: userEmail, releasedAt: now, result: 'Released' },
      logStatus: logResult.ok ? 'logged' : 'failed: HTTP ' + logResult.status,
      timestamp: now
    });
  } catch (err) {
    context.log.error('Unexpected approval-hold error:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};

function isMergeCodeBranch(refName) {
  return String(refName || '').toLowerCase().includes('mergecode');
}

function hasReviewerGroup(pr, groupName) {
  const reviewers = Array.isArray(pr && pr.reviewers) ? pr.reviewers : [];
  const target = String(groupName || '').toLowerCase().trim();
  if (!target) return true;
  return reviewers.some(reviewer =>
    reviewer &&
    reviewer.isContainer === true &&
    String(reviewer.displayName || '').toLowerCase().includes(target)
  );
}

function getPrUrl(pr) {
  const org = process.env.ADO_ORGANIZATION;
  const project = process.env.ADO_PROJECT;
  if (!org || !project || !pr || !pr.repository || !pr.repository.name || !pr.pullRequestId) return '';
  return 'https://dev.azure.com/' + org + '/' + project +
    '/_git/' + pr.repository.name + '/pullrequest/' + pr.pullRequestId;
}
