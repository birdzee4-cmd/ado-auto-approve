/**
 * GET /api/list-prs
 *
 * ดึง active PRs ใน Staging branch ที่มี group "IT Support Approve" เป็น reviewer
 *
 * Phase 3.1 ที่เพิ่ม:
 *   - ดึง Branch Policies ของ staging (cache 1 ครั้ง / repo)
 *   - คำนวณ approvedCount / requiredCount จาก reviewers + minimumApproverCount
 *   - ส่ง reviewers list พร้อม vote / isRequired / isContainer
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
      jsonResponse(500, { ok: false, error: e.message, hint: 'ตั้ง ADO_ORGANIZATION/ADO_PROJECT/ADO_PAT' });
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
    const filtered = allPrs.filter(pr => ado.hasReviewerGroup(pr, reviewerGroup));

    // Cache policies ต่อ repo
    const policyCache = {};
    async function getPolicyInfo(repoId) {
      if (!repoId) return { minApprovers: 0, fetched: false };
      if (policyCache[repoId]) return policyCache[repoId];
      try {
        const r = await ado.getBranchPolicies(repoId, targetBranch);
        if (r.ok && r.body && Array.isArray(r.body.value)) {
          const info = {
            minApprovers: ado.findMinimumApproverCount(r.body.value),
            fetched: true
          };
          policyCache[repoId] = info;
          return info;
        }
      } catch (e) {
        context.log.warn('getBranchPolicies failed for repo ' + repoId + ': ' + e.message);
      }
      const fallback = { minApprovers: 0, fetched: false };
      policyCache[repoId] = fallback;
      return fallback;
    }

    function calcApprovalStatus(reviewers, minApprovers) {
      let approved = 0, rejected = 0, waiting = 0, noVote = 0;
      let requiredTotal = 0, requiredApproved = 0;
      const list = reviewers || [];
      const hasRejection = list.some(r => Number(r.vote) <= -10);
      for (const r of list) {
        const v = Number(r.vote) || 0;
        if (v >= 5) approved++;
        else if (v <= -10) rejected++;
        else if (v < 0) waiting++;
        else noVote++;

        if (r.isRequired === true) {
          requiredTotal++;
          if (v >= 5) requiredApproved++;
        }
      }
      const requiredCount = Math.max(requiredTotal, minApprovers || 0);
      const approvedCount = Math.max(requiredApproved, approved);
      let status = 'pending';
      if (hasRejection) status = 'rejected';
      else if (approvedCount >= requiredCount && requiredCount > 0) status = 'complete';
      return {
        approvedCount,
        requiredCount,
        rejectedCount: rejected,
        waitingCount: waiting,
        noVoteCount: noVote,
        requiredReviewerTotal: requiredTotal,
        requiredReviewerApproved: requiredApproved,
        minApproversFromPolicy: minApprovers || 0,
        status: status
      };
    }

    const prs = [];
    for (const pr of filtered) {
      const repoId = pr.repository && pr.repository.id;
      const polInfo = await getPolicyInfo(repoId);
      const approval = calcApprovalStatus(pr.reviewers, polInfo.minApprovers);

      prs.push({
        id: pr.pullRequestId,
        title: pr.title,
        createdBy: pr.createdBy && pr.createdBy.displayName,
        sourceBranch: pr.sourceRefName,
        targetBranch: pr.targetRefName,
        repository: pr.repository && pr.repository.name,
        repositoryId: repoId,
        status: pr.status,
        isDraft: pr.isDraft,
        creationDate: pr.creationDate,
        mergeStatus: pr.mergeStatus,
        approval: approval,
        policyFetched: polInfo.fetched,
        reviewers: (pr.reviewers || []).map(r => ({
          id: r.id,
          displayName: r.displayName,
          vote: r.vote,
          isContainer: r.isContainer === true,
          isRequired: r.isRequired === true
        })),
        url: 'https://dev.azure.com/' + cfg.org + '/' + cfg.project +
             '/_git/' + (pr.repository && pr.repository.name) +
             '/pullrequest/' + pr.pullRequestId
      });
    }

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
