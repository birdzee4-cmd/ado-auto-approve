/**
 * ============================================
 * Azure DevOps REST API Client
 * ============================================
 *
 * Helpers สำหรับเรียก ADO REST API:
 *   - getPullRequest(id)
 *   - approvePR(id, botUserId)
 *   - rejectPR(id)
 *   - addComment(id, text)
 *   - setAutoComplete(id, botUserId)
 *
 * Env vars ที่ต้องการ:
 *   ADO_ORGANIZATION, ADO_PROJECT, ADO_PAT
 */

const https = require('https');

function getConfig() {
  const org = process.env.ADO_ORGANIZATION;
  const project = process.env.ADO_PROJECT;
  const pat = process.env.ADO_PAT;
  if (!org || !project || !pat) {
    throw new Error('Missing ADO_ORGANIZATION / ADO_PROJECT / ADO_PAT');
  }
  return { org, project, pat };
}

function adoRequest(method, path, body) {
  const { pat } = getConfig();
  const auth = 'Basic ' + Buffer.from(':' + pat).toString('base64');
  const data = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'dev.azure.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Accept': 'application/json',
        'Authorization': auth
      },
      timeout: 15000
    };
    if (data) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }

    const req = https.request(options, (res) => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = resBody ? JSON.parse(resBody) : null; } catch (e) {}
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: parsed || resBody
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ADO API timeout (15s)')); });
    if (data) req.write(data);
    req.end();
  });
}

/**
 * ดึง PR detail พร้อม reviewers
 */
async function getPullRequest(prId) {
  const { org, project } = getConfig();
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/pullrequests/${prId}?api-version=7.0&$expand=reviewers`;
  return adoRequest('GET', path);
}

/**
 * ดึง list active PRs ที่ target = staging
 */
async function listActivePRs(targetBranch) {
  const { org, project } = getConfig();
  const tb = targetBranch || 'refs/heads/staging';
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/pullrequests?api-version=7.0&searchCriteria.status=active&searchCriteria.targetRefName=${encodeURIComponent(tb)}&$top=100`;
  return adoRequest('GET', path);
}

/**
 * ดึง ID ของ bot user (จาก PAT) — ใช้สำหรับ vote
 */
async function getConnectionData() {
  const { org } = getConfig();
  const path = `/${encodeURIComponent(org)}/_apis/connectionData?api-version=7.0`;
  return adoRequest('GET', path);
}

/**
 * Vote = 10 (Approved) สำหรับ bot user บน PR นี้
 *  - ถ้า bot ยังไม่ใน reviewers list จะ add ก่อน
 */
async function approvePR(prId, repositoryId, botUserId) {
  const { org, project } = getConfig();
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${repositoryId}/pullRequests/${prId}/reviewers/${botUserId}?api-version=7.0`;
  return adoRequest('PUT', path, {
    vote: 10,
    isRequired: false
  });
}

/**
 * Vote = -10 (Rejected)
 */
async function rejectPR(prId, repositoryId, botUserId) {
  const { org, project } = getConfig();
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${repositoryId}/pullRequests/${prId}/reviewers/${botUserId}?api-version=7.0`;
  return adoRequest('PUT', path, {
    vote: -10,
    isRequired: false
  });
}

/**
 * Set Auto-Complete (merge เมื่อ policy ครบ)
 * สำคัญ: transitionWorkItems = false (ไม่แตะ Work Item ตามนโยบาย)
 */
async function setAutoComplete(prId, repositoryId, botUserId, mergeStrategy) {
  const { org, project } = getConfig();
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${repositoryId}/pullRequests/${prId}?api-version=7.0`;
  return adoRequest('PATCH', path, {
    autoCompleteSetBy: { id: botUserId },
    completionOptions: {
      deleteSourceBranch: false,
      mergeStrategy: mergeStrategy || 'noFastForward',
      bypassPolicy: false,
      transitionWorkItems: false  // ★ ห้ามแตะ Work Item / Worklist
    }
  });
}

/**
 * Add comment ใน PR thread (เพื่อระบุว่าใครเป็นคนสั่ง action)
 */
async function addComment(prId, repositoryId, commentText) {
  const { org, project } = getConfig();
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${repositoryId}/pullRequests/${prId}/threads?api-version=7.0`;
  return adoRequest('POST', path, {
    comments: [{
      parentCommentId: 0,
      content: commentText,
      commentType: 1   // = "text"
    }],
    status: 1   // = "active"
  });
}

/**
 * ตรวจว่ามี group "IT Support Approve" (หรือชื่ออื่น) อยู่ใน reviewers ของ PR ไหม
 */
function hasReviewerGroup(pr, groupName) {
  if (!pr || !Array.isArray(pr.reviewers)) return false;
  const target = (groupName || '').toLowerCase().trim();
  return pr.reviewers.some(r =>
    r.isContainer === true &&
    (r.displayName || '').toLowerCase().includes(target)
  );
}

module.exports = {
  getConfig,
  adoRequest,
  getPullRequest,
  listActivePRs,
  getConnectionData,
  approvePR,
  rejectPR,
  setAutoComplete,
  addComment,
  hasReviewerGroup
};
