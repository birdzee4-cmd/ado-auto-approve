/**
 * GET /api/list-prs
 *
 * ดึง active Pull Requests ที่ target = staging branch จาก Azure DevOps
 * โดยใช้ Personal Access Token (PAT)
 *
 * Environment variables:
 *   ADO_ORGANIZATION  =  ชื่อ organization (จาก URL: dev.azure.com/<org>)
 *   ADO_PROJECT       =  ชื่อ project
 *   ADO_PAT           =  Personal Access Token (scope: Code Read)
 *   ADO_TARGET_BRANCH =  (optional) default: refs/heads/staging
 *                        ใช้เป็น prefix match — รองรับ Staging/VN, Staging/api ฯลฯ
 *
 * รับประกัน: ตอบ JSON เสมอ มี Content-Type ชัดเจน ชัวร์ว่าไม่ล่มกลางทาง
 * และมี error handling ครอบคลุมทุกขั้นตอน
 */

const https = require('https');

module.exports = async function (context, req) {
  function jsonResponse(status, payload) {
    context.res = {
      status: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    };
  }

  try {
    // ---- 1) ตรวจ auth ----
    if (!req.headers || !req.headers['x-ms-client-principal']) {
      jsonResponse(401, {
        ok: false,
        error: 'Authentication required',
        hint: 'Refresh หน้า dashboard แล้วลองใหม่'
      });
      return;
    }

    // ---- 2) ตรวจ env vars ----
    const org = process.env.ADO_ORGANIZATION;
    const project = process.env.ADO_PROJECT;
    const pat = process.env.ADO_PAT;

    // [แก้ไข] เปลี่ยนจาก exact match → prefix match (case-insensitive)
    // รองรับ: staging, Staging/VN, Staging/api, refs/heads/Staging/TH ฯลฯ
    const stagingPrefix = (process.env.ADO_TARGET_BRANCH || 'refs/heads/staging').toLowerCase();
    const reviewerGroup = process.env.ADO_REVIEWER_GROUP || 'IT Support Approve';

    const missing = [];
    if (!org)     missing.push('ADO_ORGANIZATION');
    if (!project) missing.push('ADO_PROJECT');
    if (!pat)     missing.push('ADO_PAT');
    if (missing.length > 0) {
      jsonResponse(500, {
        ok: false,
        error: 'Missing environment variables: ' + missing.join(', '),
        hint: 'เพิ่ม env vars ใน Azure Portal → Static Web App → Configuration'
      });
      return;
    }

    // ---- 3) เรียก ADO REST API ----
    // [แก้ไข] ลบ searchCriteria.targetRefName ออก — ดึงทุก active PR มาก่อน
    // แล้วค่อย filter ด้วย prefix ใน step 4 แทน
    const apiPath = '/' + encodeURIComponent(org) + '/' + encodeURIComponent(project) +
      '/_apis/git/pullrequests?api-version=7.0' +
      '&searchCriteria.status=active' +
      '&$top=100';

    const result = await callAdoApi('dev.azure.com', apiPath, pat);

    if (!result.ok) {
      jsonResponse(result.status === 401 ? 401 : 502, {
        ok: false,
        error: 'ADO API returned ' + result.status,
        detail: (result.body || '').substring(0, 500),
        hint: result.status === 401
          ? 'PAT ไม่ถูกต้องหรือหมดอายุ — สร้างใหม่และอัปเดต ADO_PAT'
          : result.status === 404
          ? 'ตรวจ ADO_ORGANIZATION และ ADO_PROJECT ว่าสะกดถูก'
          : 'ดู detail ด้านบนเพื่อหาสาเหตุ'
      });
      return;
    }

    // ---- 4) Parse และ map ข้อมูล ----
    let data;
    try {
      data = JSON.parse(result.body);
    } catch (e) {
      jsonResponse(502, {
        ok: false,
        error: 'ADO API returned non-JSON',
        detail: (result.body || '').substring(0, 300)
      });
      return;
    }

    // [แก้ไข] เพิ่ม .filter() ก่อน .map()
    // เก็บเฉพาะ PR ที่ targetRefName ขึ้นต้นด้วย stagingPrefix (case-insensitive)
    const allActivePrs = data.value || [];
    const targetPrs = allActivePrs
      .filter(pr => (pr.targetRefName || '').toLowerCase().startsWith(stagingPrefix));
    const prs = targetPrs
      .filter(pr => hasReviewerGroup(pr, reviewerGroup))
      .map(pr => {
        const reviewers = Array.isArray(pr.reviewers) ? pr.reviewers : [];
        const approval = buildApprovalSummary(reviewers);
        return {
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
        reviewers: reviewers.map(mapReviewer),
        approval: approval,
        policyFetched: false,
        url: pr.repository && pr.repository.project
          ? 'https://dev.azure.com/' + org + '/' + project +
            '/_git/' + pr.repository.name + '/pullrequest/' + pr.pullRequestId
          : null
        };
      });

    jsonResponse(200, {
      ok: true,
      count: prs.length,
      totalActive: allActivePrs.length,
      totalTargetBranch: targetPrs.length,
      organization: org,
      project: project,
      targetBranch: stagingPrefix,
      reviewerGroup: reviewerGroup,
      fetchedAt: new Date().toISOString(),
      prs: prs
    });

  } catch (err) {
    context.log.error('Unexpected error:', err);
    jsonResponse(500, {
      ok: false,
      error: 'Unexpected server error',
      detail: err && err.message ? err.message : String(err)
    });
  }
};

/**
 * เรียก ADO REST API ด้วย Basic Auth (PAT)
 */
function callAdoApi(hostname, path, pat) {
  return new Promise((resolve, reject) => {
    const auth = 'Basic ' + Buffer.from(':' + pat).toString('base64');

    const options = {
      hostname: hostname,
      port: 443,
      path: path,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': auth
      },
      timeout: 15000
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: body
        });
      });
    });

    req.on('error', err => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('ADO API request timeout (15s)'));
    });

    req.end();
  });
}

function hasReviewerGroup(pr, groupName) {
  const reviewers = Array.isArray(pr.reviewers) ? pr.reviewers : [];
  const target = String(groupName || '').toLowerCase().trim();
  if (!target) return true;
  if (reviewers.length === 0) return true;
  return reviewers.some(reviewer =>
    reviewer &&
    reviewer.isContainer === true &&
    String(reviewer.displayName || '').toLowerCase().includes(target)
  );
}

function mapReviewer(reviewer) {
  return {
    id: reviewer.id,
    displayName: reviewer.displayName,
    uniqueName: reviewer.uniqueName,
    vote: reviewer.vote,
    isRequired: reviewer.isRequired === true,
    isContainer: reviewer.isContainer === true
  };
}

function buildApprovalSummary(reviewers) {
  const people = reviewers.filter(r => r && r.isContainer !== true);
  const required = people.filter(r => r.isRequired === true);
  const rejectedCount = people.filter(r => Number(r.vote) <= -10).length;
  const approvedCount = people.filter(r => Number(r.vote) >= 10).length;
  const requiredApprovedCount = required.filter(r => Number(r.vote) >= 10).length;
  const requiredCount = required.length || people.length;

  let status = 'pending';
  if (rejectedCount > 0) {
    status = 'rejected';
  } else if (requiredCount > 0 && approvedCount >= requiredCount) {
    status = 'complete';
  }

  return {
    status: status,
    approvedCount: approvedCount,
    requiredCount: requiredCount,
    requiredReviewerApproved: requiredApprovedCount,
    requiredReviewerTotal: required.length,
    minApproversFromPolicy: 0,
    rejectedCount: rejectedCount
  };
}
