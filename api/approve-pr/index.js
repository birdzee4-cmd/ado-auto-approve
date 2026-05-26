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
 *   5. Add comment ระบุ user
 *   6. Log SharePoint
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

    const expectedBranch = process.env.ADO_TARGET_BRANCH || 'refs/heads/staging';
    if (pr.targetRefName !== expectedBranch) {
      jsonResponse(403, {
        ok: false,
        error: 'PR target is not Staging - refuse to approve',
        actual: pr.targetRefName,
        expected: expectedBranch
      });
      await logToSharePoint(context, {
        prId, action: 'Failed', user: userEmail, repository: pr.repository.name,
        prTitle: pr.title, targetBranch: pr.targetRefName,
        result: 'Refused: target not staging'
      });
      return;
    }

    if (pr.status !== 'active') {
      jsonResponse(409, { ok: false, error: 'PR status is not active', status: pr.status });
      return;
    }

    // 2) ดึง Branch Policies เพื่อหา Release Notes
    let releaseNotesIgnoreIds = [];
    let policiesFetched = false;
    try {
      const polResult = await ado.getBranchPolicies(repositoryId, expectedBranch);
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
      await logToSharePoint(context, {
        prId, action: 'Failed', user: userEmail, repository: pr.repository.name,
        prTitle: pr.title, targetBranch: pr.targetRefName,
        result: 'Vote failed: HTTP ' + voteResult.status
      });
      return;
    }

    // 5) Add comment ระบุ user
    const time = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
    const ignoreInfo = releaseNotesIgnoreIds.length > 0
      ? '\nIgnored optional check(s): Release Notes (' + releaseNotesIgnoreIds.length + ' policy ID)'
      : '\nNo "Release Notes" policy detected for this branch';
    const commentText =
      '✅ **Approved** by `' + userEmail + '` via ADO Auto-Approve System\n' +
      'Timestamp: ' + time + ' (Bangkok)\n' +
      'Auto-Complete: ' + (autoCompleteOk ? 'enabled (waits for branch policy)' : 'failed to set') +
      ignoreInfo +
      '\n_Note: transitionWorkItems = false (Work Items not touched)_';
    try {
      await ado.addComment(prId, repositoryId, commentText);
    } catch (e) {
      context.log.warn('addComment failed:', e.message);
    }

    // 6) Log SharePoint
    let logStatus = 'skipped';
    const resultText = (autoCompleteOk ? 'Success (auto-complete enabled' : 'Vote OK (auto-complete failed') +
      (releaseNotesIgnoreIds.length > 0 ? ', Release Notes ignored)' : ')');
    try {
      const logResult = await logToSharePoint(context, {
        prId, action: 'Approved', user: userEmail, repository: pr.repository.name,
        prTitle: pr.title, targetBranch: pr.targetRefName,
        result: resultText
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
      logStatus: logStatus,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    context.log.error('Unexpected error:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};

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
