/**
 * POST /api/approve-pr
 *
 * Body: { prId, repositoryId }
 *
 * 1. ดึง PR detail + รายการ reviewers
 * 2. Bot vote = 10 (Approved)
 * 3. Set Auto-Complete (transitionWorkItems: false)
 * 4. Add comment ระบุ user ที่กดปุ่ม
 * 5. Log ลง SharePoint
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
    // ตรวจ auth
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

    // Parse body
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

    // Load modules
    const ado = require('../shared/ado-client');

    // ดึง bot user ID (จาก PAT) — ใช้สำหรับ vote
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

    // ดึง PR detail
    const prResult = await ado.getPullRequest(prId);
    if (!prResult.ok) {
      jsonResponse(502, { ok: false, error: 'Cannot fetch PR', detail: 'HTTP ' + prResult.status });
      return;
    }
    const pr = prResult.body;

    // ตรวจว่า target branch = staging (security check)
    const expectedBranch = process.env.ADO_TARGET_BRANCH || 'refs/heads/staging';
    if (pr.targetRefName !== expectedBranch) {
      jsonResponse(403, {
        ok: false,
        error: 'PR target is not Staging — refuse to approve',
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

    // ตรวจว่า PR ยัง active
    if (pr.status !== 'active') {
      jsonResponse(409, { ok: false, error: 'PR status is not active', status: pr.status });
      return;
    }

    // 1) Vote = 10
    const voteResult = await ado.approvePR(prId, repositoryId, botUserId);
    if (!voteResult.ok) {
      jsonResponse(502, {
        ok: false,
        error: 'Failed to approve in ADO',
        detail: 'HTTP ' + voteResult.status + ': ' + JSON.stringify(voteResult.body).substring(0, 300)
      });
      await logToSharePoint(context, {
        prId, action: 'Failed', user: userEmail, repository: pr.repository.name,
        prTitle: pr.title, targetBranch: pr.targetRefName,
        result: 'Vote failed: HTTP ' + voteResult.status
      });
      return;
    }

    // 2) Set Auto-Complete (transitionWorkItems: false)
    const acResult = await ado.setAutoComplete(prId, repositoryId, botUserId);
    const autoCompleteOk = acResult.ok;

    // 3) Add comment ระบุ user
    const time = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
    const commentText =
      `✅ **Approved** by \`${userEmail}\` via ADO Auto-Approve System\n` +
      `Timestamp: ${time} (Bangkok)\n` +
      `Auto-Complete: ${autoCompleteOk ? 'enabled (merge when policy met)' : 'failed to set'}\n` +
      `_Note: transitionWorkItems = false (Work Items not touched)_`;
    try {
      await ado.addComment(prId, repositoryId, commentText);
    } catch (e) {
      context.log.warn('addComment failed:', e.message);
    }

    // 4) Log SharePoint
    let logStatus = 'skipped';
    try {
      const logResult = await logToSharePoint(context, {
        prId, action: 'Approved', user: userEmail, repository: pr.repository.name,
        prTitle: pr.title, targetBranch: pr.targetRefName,
        result: autoCompleteOk ? 'Success (with auto-complete)' : 'Success (auto-complete failed)'
      });
      logStatus = logResult.ok ? 'logged' : 'failed: HTTP ' + logResult.status;
    } catch (e) {
      logStatus = 'failed: ' + e.message;
    }

    jsonResponse(200, {
      ok: true,
      message: 'PR approved successfully',
      prId, user: userEmail,
      autoComplete: autoCompleteOk,
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
