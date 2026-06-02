/**
 * ============================================
 * Azure DevOps REST API Client
 * ============================================
 *
 * Helpers สำหรับเรียก ADO REST API (Phase 3.1)
 */

const https = require('https');
let cachedProjectId = null;

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
 * ดึง PR statuses เช่น build validation / policy checks
 */
async function getPullRequestStatuses(repositoryId, prId) {
  const { org, project } = getConfig();
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${repositoryId}/pullRequests/${prId}/statuses?api-version=7.0`;
  return adoRequest('GET', path);
}

async function getBuildsForBranch(repositoryId, branchName, top) {
  const { org, project } = getConfig();
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/build/builds?repositoryId=${encodeURIComponent(repositoryId)}&repositoryType=TfsGit&branchName=${encodeURIComponent(branchName)}&queryOrder=queueTimeDescending&$top=${top || 10}&api-version=7.0`;
  return adoRequest('GET', path);
}

async function getProjectId() {
  if (cachedProjectId) return cachedProjectId;
  const { org, project } = getConfig();
  const result = await adoRequest('GET', `/${encodeURIComponent(org)}/_apis/projects/${encodeURIComponent(project)}?api-version=7.0`);
  if (!result.ok || !result.body || !result.body.id) {
    throw new Error('Cannot resolve ADO project id');
  }
  cachedProjectId = result.body.id;
  return cachedProjectId;
}

async function getPolicyEvaluations(prId) {
  const { org, project } = getConfig();
  const projectId = await getProjectId();
  const artifactId = `vstfs:///CodeReview/CodeReviewId/${projectId}/${prId}`;
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/policy/evaluations?artifactId=${encodeURIComponent(artifactId)}&api-version=7.1-preview.1`;
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
  const path = `/${encodeURIComponent(org)}/_apis/connectionData`;
  return adoRequest('GET', path);
}

/**
 * ดึง Branch Policy Configurations สำหรับ branch ที่ระบุ
 *
 * @param {string} repositoryId - GUID ของ repo
 * @param {string} refName - เช่น "refs/heads/staging"
 */
async function getBranchPolicies(repositoryId, refName) {
  const { org, project } = getConfig();
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/policy/configurations?repositoryId=${encodeURIComponent(repositoryId)}&refName=${encodeURIComponent(refName)}&api-version=7.0`;
  return adoRequest('GET', path);
}

/**
 * หา Policy Config ID ของ "Release Notes" status check
 * Strategy:
 *   - statusName / statusGenre / displayName / type.displayName
 *     contain "release note" / "release-note"
 */
function findReleaseNotesPolicyIds(policies) {
  if (!Array.isArray(policies)) return [];
  const matches = [];
  const isReleaseNotes = (text) => {
    if (!text) return false;
    const t = String(text).toLowerCase().trim();
    return t.includes('release note') || t.includes('release-note') || t === 'release_notes';
  };

  for (const p of policies) {
    if (!p || !p.id) continue;
    const settings = p.settings || {};
    const typeDisplay = p.type && p.type.displayName;

    if (isReleaseNotes(settings.statusName) ||
        isReleaseNotes(settings.statusGenre) ||
        isReleaseNotes(settings.displayName) ||
        isReleaseNotes(typeDisplay) ||
        isReleaseNotes(p.displayName)) {
      matches.push(p.id);
    }
  }
  return matches;
}

/**
 * หา minimumApproverCount ของ "Minimum number of reviewers" policy
 * Type GUID: fa4e907d-c16b-4a4c-9dfa-4906e5d171dd
 */
function findMinimumApproverCount(policies) {
  if (!Array.isArray(policies)) return 0;
  const MIN_REVIEWER_TYPE_ID = 'fa4e907d-c16b-4a4c-9dfa-4906e5d171dd';
  for (const p of policies) {
    if (!p || !p.type) continue;
    const typeId = (p.type.id || '').toLowerCase();
    if (typeId === MIN_REVIEWER_TYPE_ID && p.settings && p.settings.minimumApproverCount) {
      return Number(p.settings.minimumApproverCount) || 0;
    }
  }
  return 0;
}

function summarizeStatusSnapshot(pr, statuses, autoCompleteOk, policyEvaluations, buildRuns) {
  const values = Array.isArray(statuses) ? statuses : [];
  const evaluations = Array.isArray(policyEvaluations) ? policyEvaluations : [];
  const buildStatuses = values.filter(isBuildStatus);

  const summarizeStates = (items) => {
    if (!items.length) return { status: 'no_status', result: 'unknown' };
    const states = items.map(s => String(s.state || '').toLowerCase());
    if (states.some(s => s === 'failed' || s === 'error')) {
      return { status: 'completed', result: 'failed' };
    }
    if (states.some(s => s === 'pending' || s === 'notset' || s === 'not_applicable')) {
      return { status: 'in_progress', result: 'pending' };
    }
    if (states.every(s => s === 'succeeded' || s === 'success')) {
      return { status: 'completed', result: 'succeeded' };
    }
    return { status: 'unknown', result: states.join(',') || 'unknown' };
  };

  const branchBuild = summarizeBuildRuns(pr, buildRuns);
  const build = buildStatuses.length ? summarizeStates(buildStatuses) : branchBuild;
  const policy = summarizePolicyEvaluations(evaluations, values);
  const buildWithUrl = buildStatuses.find(s => s && s.targetUrl);

  return {
    buildStatus: build.status,
    buildResult: build.result,
    policyStatus: policy.result,
    policyStatusDetail: policy.status,
    mergeStatus: (pr && pr.mergeStatus) || '',
    autoCompleteStatus: autoCompleteOk === true
      ? 'enabled'
      : autoCompleteOk === false
      ? 'failed'
      : 'not_applicable',
    lastCheckedAt: new Date().toISOString(),
    adoBuildUrl: buildWithUrl ? buildWithUrl.targetUrl : branchBuild.url,
    statusCount: values.length,
    buildStatusCount: buildStatuses.length || branchBuild.count,
    buildStatusSource: buildStatuses.length ? 'pr-status' : branchBuild.source,
    buildRunId: branchBuild.id,
    policyEvaluationCount: evaluations.length
  };
}

function isBuildStatus(status) {
  const context = status && status.context ? status.context : {};
  const text = [
    context.genre,
    context.name,
    status && status.description,
    status && status.targetUrl
  ].map(value => String(value || '').toLowerCase()).join(' ');
  return text.includes('build') ||
    text.includes('pipeline') ||
    text.includes('continuous-integration') ||
    text.includes('ci');
}

function summarizeBuildRuns(pr, buildRuns) {
  const values = Array.isArray(buildRuns) ? buildRuns : [];
  const openedAt = Date.parse(pr && pr.creationDate);
  const closedAt = Date.parse(pr && (pr.closedDate || pr.completionDate));
  const upperBound = Number.isFinite(closedAt) ? closedAt + 60 * 60 * 1000 : Date.now() + 60 * 60 * 1000;
  const relevant = values
    .filter(build => {
      const queuedAt = Date.parse(build && (build.queueTime || build.startTime || build.finishTime));
      return Number.isFinite(queuedAt) &&
        (!Number.isFinite(openedAt) || queuedAt >= openedAt) &&
        queuedAt <= upperBound;
    })
    .sort((a, b) =>
      Date.parse(b.queueTime || b.startTime || b.finishTime) -
      Date.parse(a.queueTime || a.startTime || a.finishTime));
  const latest = relevant[0];
  if (!latest) return { status: 'no_status', result: 'unknown', url: '', count: 0, source: '', id: '' };

  const status = String(latest.status || '').toLowerCase();
  const result = String(latest.result || '').toLowerCase();
  const url = latest._links && latest._links.web && latest._links.web.href || '';
  if (status !== 'completed') {
    return { status: 'in_progress', result: 'pending', url, count: relevant.length, source: 'branch-build', id: latest.id || '' };
  }
  if (result === 'failed' || result === 'error') {
    return { status: 'completed', result: 'failed', url, count: relevant.length, source: 'branch-build', id: latest.id || '' };
  }
  if (result === 'succeeded' || result === 'success') {
    return { status: 'completed', result: 'succeeded', url, count: relevant.length, source: 'branch-build', id: latest.id || '' };
  }
  return { status: 'completed', result: result || 'unknown', url, count: relevant.length, source: 'branch-build', id: latest.id || '' };
}

function summarizePolicyEvaluations(evaluations, statuses) {
  const policyItems = evaluations.length > 0 ? evaluations : statuses;
  if (!policyItems.length) return { status: 'no_policy_status', result: 'unknown' };
  const states = policyItems.map(item => String(item.status || item.state || '').toLowerCase());
  if (states.some(s => s === 'rejected' || s === 'failed' || s === 'error' || s === 'broken')) {
    return { status: 'completed', result: 'failed' };
  }
  if (states.some(s => s === 'queued' || s === 'running' || s === 'pending' || s === 'notset')) {
    return { status: 'in_progress', result: 'pending' };
  }
  if (states.every(s => s === 'approved' || s === 'succeeded' || s === 'success')) {
    return { status: 'completed', result: 'approved' };
  }
  return { status: 'unknown', result: states.join(',') || 'unknown' };
}

/**
 * Vote = 10 (Approved) สำหรับ bot user บน PR นี้
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
 *
 * ★ บังคับเสมอ:
 *   - transitionWorkItems = false (ห้ามแตะ Worklist)
 *   - bypassPolicy = false (เคารพ branch policy)
 *
 * Strategy "Merge & Preserve":
 *   - รับ existingOptions แล้ว merge ของเราเข้าไป
 *   - เพิ่ม releaseNotesIgnoreIds เข้า autoCompleteIgnoreConfigIds
 */
async function setAutoComplete(prId, repositoryId, botUserId, options) {
  const { org, project } = getConfig();
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${repositoryId}/pullRequests/${prId}?api-version=7.0`;

  options = options || {};
  const existing = options.existingOptions || {};
  const ignoreIds = Array.isArray(options.releaseNotesIgnoreIds) ? options.releaseNotesIgnoreIds.slice() : [];

  const existingIgnore = Array.isArray(existing.autoCompleteIgnoreConfigIds)
    ? existing.autoCompleteIgnoreConfigIds : [];
  const mergedIgnore = Array.from(new Set([...existingIgnore, ...ignoreIds]));

  const completionOptions = {
    ...existing,
    bypassPolicy: false,
    transitionWorkItems: false,
    deleteSourceBranch: existing.deleteSourceBranch === true ? true : false,
    mergeStrategy: 'noFastForward',
    autoCompleteIgnoreConfigIds: mergedIgnore
  };

  return adoRequest('PATCH', path, {
    autoCompleteSetBy: { id: botUserId },
    completionOptions: completionOptions
  });
}

/**
 * Add comment ใน PR thread
 */
async function addComment(prId, repositoryId, commentText) {
  const { org, project } = getConfig();
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${repositoryId}/pullRequests/${prId}/threads?api-version=7.0`;
  return adoRequest('POST', path, {
    comments: [{
      parentCommentId: 0,
      content: commentText,
      commentType: 1
    }],
    status: 1
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
  getPullRequestStatuses,
  getBuildsForBranch,
  getPolicyEvaluations,
  listActivePRs,
  getConnectionData,
  approvePR,
  rejectPR,
  setAutoComplete,
  addComment,
  hasReviewerGroup,
  getBranchPolicies,
  findReleaseNotesPolicyIds,
  findMinimumApproverCount,
  isBuildStatus,
  summarizeStatusSnapshot
};
