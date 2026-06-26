/**
 * POST /api/approve-release
 *
 * Body: { prId, approvalId, releaseId, repository, prTitle, releaseName, environmentName, releaseUrl }
 *
 * Approves an Azure DevOps Classic Release pre-deploy approval that already exists.
 * This does not create releases and does not affect PR approval flow.
 */

module.exports = async function (context, req) {
  const responseHeaders = {};
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
        hint: 'Connect Azure DevOps from Dashboard before approving release as your own account.',
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

    const prId = parseInt(body && body.prId, 10) || 0;
    const approvalId = body && body.approvalId;
    const releaseId = body && body.releaseId;
    if (!approvalId || !releaseId) {
      jsonResponse(400, { ok: false, error: 'Missing approvalId or releaseId in body' });
      return;
    }

    if (prId) {
      const holdState = await getApprovalHoldState(context, prId);
      if (holdState.active) {
        jsonResponse(423, {
          ok: false,
          error: 'PR is on Approval Hold',
          detail: holdState.reason || 'Unlock this PR before approving release from Dashboard',
          hold: holdState
        });
        return;
      }
    }

    const ado = require('../shared/ado-client');
    const releaseResult = await ado.getRelease(releaseId);
    if (!releaseResult.ok || !releaseResult.body) {
      jsonResponse(502, {
        ok: false,
        error: 'Cannot fetch release detail',
        detail: 'HTTP ' + releaseResult.status
      });
      return;
    }

    const current = ado.summarizeReleaseApproval(releaseResult.body, process.env.ADO_REVIEWER_GROUP || 'IT Support Approve');
    if (String(current.approvalId || '') !== String(approvalId)) {
      jsonResponse(409, {
        ok: false,
        error: 'Release approval no longer matches the current pending approval',
        detail: 'Refresh PR and try again',
        currentStatus: current.status,
        currentApprovalId: current.approvalId || ''
      });
      return;
    }
    if (current.status !== 'pending') {
      jsonResponse(409, {
        ok: false,
        error: 'Release approval is not pending',
        currentStatus: current.status,
        releaseName: current.releaseName || ''
      });
      return;
    }

    const comments = 'Approved from ADO Auto-Approve Dashboard by ' + userEmail +
      (prId ? ' for PR #' + prId : '');
    const approveResult = await ado.approveReleaseApproval(approvalId, comments, userAdoAuth);
    if (!approveResult.ok) {
      jsonResponse(502, {
        ok: false,
        error: 'Failed to approve release in Azure DevOps',
        detail: 'HTTP ' + approveResult.status + ': ' + JSON.stringify(approveResult.body).substring(0, 300)
      });
      await logToSharePoint(context, {
        prId: prId,
        action: 'Release Failed',
        user: userEmail,
        repository: body.repository || '',
        prTitle: body.prTitle || '',
        targetBranch: current.environmentName || body.environmentName || '',
        result: 'Release approval failed: HTTP ' + approveResult.status,
        reason: 'releaseId=' + releaseId + '; approvalId=' + approvalId,
        source: 'Dashboard',
        eventKey: 'release-approval-failed:' + releaseId + ':' + approvalId,
        adoPrUrl: body.adoPrUrl || '',
        adoBuildUrl: current.releaseUrl || body.releaseUrl || ''
      });
      return;
    }

    const logResult = await logToSharePoint(context, {
      prId: prId,
      action: 'Release Approved',
      user: userEmail,
      repository: body.repository || '',
      prTitle: body.prTitle || '',
      targetBranch: current.environmentName || body.environmentName || '',
      result: 'Release approval approved',
      reason: 'releaseId=' + releaseId + '; approvalId=' + approvalId,
      source: 'Dashboard',
      eventKey: 'release-approval:' + releaseId + ':' + approvalId,
      adoPrUrl: body.adoPrUrl || '',
      adoBuildUrl: current.releaseUrl || body.releaseUrl || ''
    });

    jsonResponse(200, {
      ok: true,
      prId: prId,
      releaseId: releaseId,
      approvalId: approvalId,
      releaseName: current.releaseName || body.releaseName || '',
      environmentName: current.environmentName || body.environmentName || '',
      releaseUrl: current.releaseUrl || body.releaseUrl || '',
      logStatus: logResult.ok ? 'logged' : 'failed: HTTP ' + logResult.status,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    context.log.error('Unexpected approve-release error:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};

async function logToSharePoint(context, opts) {
  try {
    const sp = require('../shared/sharepoint-client');
    const fields = sp.buildLogFields(opts);
    return await sp.addLogItem(fields);
  } catch (e) {
    context.log.warn('SharePoint release log failed:', e.message);
    return { ok: false, status: 0, body: e.message };
  }
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
