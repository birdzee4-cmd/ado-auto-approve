/**
 * POST /api/reject-pr
 *
 * Body: { prId, repositoryId, reason }
 *
 * 1. Bot vote = -10 (Rejected)
 * 2. Add comment พร้อม reason + user
 * 3. Log SharePoint
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
    const principalHeader = req.headers && req.headers['x-ms-client-principal'];
    if (!principalHeader) {
      jsonResponse(401, { ok: false, error: 'Authentication required' });
      return;
    }

    let userEmail = 'Unknown User';
    try {
      const principal = JSON.parse(Buffer.from(principalHeader, 'base64').toString('utf-8'));
      userEmail = principal.userDetails || 'Unknown User';
    } catch (e) {}

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

    // Vote = -10
    const voteResult = await ado.rejectPR(prId, repositoryId, botUserId);
    if (!voteResult.ok) {
      jsonResponse(502, {
        ok: false,
        error: 'Failed to reject in ADO',
        detail: 'HTTP ' + voteResult.status
      });
      await logToSharePoint(context, {
        prId, action: 'Failed', user: userEmail, repository: pr.repository.name,
        prTitle: pr.title, targetBranch: pr.targetRefName,
        result: 'Reject vote failed: HTTP ' + voteResult.status, reason: reason
      });
      return;
    }

    // Comment พร้อม reason
    const time = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
    const commentText =
      `❌ **Rejected** by \`${userEmail}\` via ADO Auto-Approve System\n` +
      `Timestamp: ${time} (Bangkok)\n` +
      `**Reason:** ${reason}`;
    try {
      await ado.addComment(prId, repositoryId, commentText);
    } catch (e) {
      context.log.warn('addComment failed:', e.message);
    }

    // Log
    let logStatus = 'skipped';
    try {
      const logResult = await logToSharePoint(context, {
        prId, action: 'Rejected', user: userEmail, repository: pr.repository.name,
        prTitle: pr.title, targetBranch: pr.targetRefName,
        result: 'Success', reason: reason
      });
      logStatus = logResult.ok ? 'logged' : 'failed: HTTP ' + logResult.status;
    } catch (e) {
      logStatus = 'failed: ' + e.message;
    }

    jsonResponse(200, {
      ok: true,
      message: 'PR rejected successfully',
      prId, user: userEmail, reason: reason,
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
