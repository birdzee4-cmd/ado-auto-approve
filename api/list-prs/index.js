/**
 * GET /api/list-prs
 *
 * ดึง active PRs ใน Staging branch ที่มี group "IT Support Approve" เป็น reviewer
 * (Phase 3: เพิ่ม filter ตาม REVIEWER_GROUP_NAME)
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
    if (!req.headers || !req.headers['x-ms-client-principal']) {
      jsonResponse(401, { ok: false, error: 'Authentication required' });
      return;
    }

    let ado;
    try { ado = require('../shared/ado-client'); }
    catch (e) {
      jsonResponse(500, { ok: false, error: 'Failed to load ado-client', detail: e.message });
      return;
    }

    let cfg;
    try { cfg = ado.getConfig(); }
    catch (e) {
      jsonResponse(500, { ok: false, error: e.message, hint: 'ตั้ง ADO_ORGANIZATION/ADO_PROJECT/ADO_PAT ใน Configuration' });
      return;
    }

    const targetBranch = process.env.ADO_TARGET_BRANCH || 'refs/heads/staging';
    const reviewerGroup = process.env.REVIEWER_GROUP_NAME || 'IT Support Approve';

    const result = await ado.listActivePRs(targetBranch);
    if (!result.ok) {
      jsonResponse(result.status === 401 ? 401 : 502, {
        ok: false,
        error: 'ADO API returned ' + result.status,
        detail: JSON.stringify(result.body).substring(0, 500),
        hint: result.status === 401 ? 'PAT ไม่ถูกต้อง/หมดอายุ' : 'ตรวจ ADO_ORGANIZATION/ADO_PROJECT'
      });
      return;
    }

    const allPrs = result.body.value || [];

    // Filter: เฉพาะ PR ที่มี reviewer group ตรงกับ REVIEWER_GROUP_NAME
    const filtered = allPrs.filter(pr => ado.hasReviewerGroup(pr, reviewerGroup));

    const prs = filtered.map(pr => ({
      id: pr.pullRequestId,
      title: pr.title,
      createdBy: pr.createdBy && pr.createdBy.displayName,
      sourceBranch: pr.sourceRefName,
      targetBranch: pr.targetRefName,
      repository: pr.repository && pr.repository.name,
      repositoryId: pr.repository && pr.repository.id,
      status: pr.status,
      isDraft: pr.isDraft,
      creationDate: pr.creationDate,
      mergeStatus: pr.mergeStatus,
      // ตรวจว่าตัว bot (PAT user) vote ไปแล้วยัง
      reviewers: (pr.reviewers || []).map(r => ({
        displayName: r.displayName,
        vote: r.vote,
        isContainer: r.isContainer,
        id: r.id
      })),
      url: 'https://dev.azure.com/' + cfg.org + '/' + cfg.project +
           '/_git/' + (pr.repository && pr.repository.name) +
           '/pullrequest/' + pr.pullRequestId
    }));

    jsonResponse(200, {
      ok: true,
      count: prs.length,
      totalActive: allPrs.length,
      organization: cfg.org,
      project: cfg.project,
      targetBranch: targetBranch,
      reviewerGroup: reviewerGroup,
      fetchedAt: new Date().toISOString(),
      prs: prs
    });

  } catch (err) {
    context.log.error('Unexpected error:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};
