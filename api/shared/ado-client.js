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

function adoRequest(method, path, body, options) {
  return adoHostRequest('dev.azure.com', method, path, body, options);
}

function releaseRequest(method, path, body, options) {
  return adoHostRequest('vsrm.dev.azure.com', method, path, body, options);
}

async function executeWithRetry(requestFn, maxRetries = 3, initialDelay = 500) {
  let attempt = 0;
  while (true) {
    try {
      const result = await requestFn();
      if (!result.ok && (result.status === 429 || result.status >= 500) && attempt < maxRetries) {
        attempt++;
        const delay = initialDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      return result;
    } catch (error) {
      if (attempt < maxRetries) {
        attempt++;
        const delay = initialDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

function adoHostRequest(hostname, method, path, body, options) {
  return executeWithRetry(() => makeSingleAdoHostRequest(hostname, method, path, body, options));
}

function makeSingleAdoHostRequest(hostname, method, path, body, options) {
  const { pat } = getConfig();
  const auth = options && options.accessToken
    ? 'Bearer ' + options.accessToken
    : 'Basic ' + Buffer.from(':' + pat).toString('base64');
  const data = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: hostname,
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
        const headers = {};
        Object.keys(res.headers || {}).forEach(key => {
          const value = res.headers[key];
          headers[String(key).toLowerCase()] = Array.isArray(value) ? value.join(',') : String(value || '');
        });
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: parsed || resBody,
          headers: headers
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ADO API timeout (15s)')); });
    if (data) req.write(data);
    req.end();
  });
}


async function listReleasesByBuildId(buildId, top) {
  const { org, project } = getConfig();
  const params = [
    'artifactVersionId=' + encodeURIComponent(String(buildId || '')),
    '$top=' + encodeURIComponent(String(top || 5)),
    'queryOrder=descending',
    '$expand=environments,artifacts',
    'api-version=7.1'
  ].join('&');
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/release/releases?${params}`;
  return releaseRequest('GET', path);
}

async function getRelease(releaseId, options) {
  const { org, project } = getConfig();
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/release/releases/${encodeURIComponent(String(releaseId))}?api-version=7.1`;
  return releaseRequest('GET', path, null, options);
}

async function approveReleaseApproval(approvalId, comments, options) {
  const { org, project } = getConfig();
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/release/approvals/${encodeURIComponent(String(approvalId))}?api-version=7.1`;
  return releaseRequest('PATCH', path, {
    status: 'approved',
    comments: comments || 'Approved from ADO Auto-Approve Dashboard'
  }, options);
}

async function getLatestReleaseApprovalForBuild(buildId, reviewerGroup) {
  if (!buildId) return { status: 'not_found', label: 'No release yet' };
  const listResult = await listReleasesByBuildId(buildId, 5);
  if (!listResult.ok) {
    return {
      status: 'lookup_failed',
      label: 'Release lookup failed',
      detail: 'HTTP ' + listResult.status
    };
  }

  const releases = listResult.body && Array.isArray(listResult.body.value)
    ? listResult.body.value
    : [];
  if (!releases.length) {
    return { status: 'not_found', label: 'No release yet', buildId: buildId };
  }

  for (const releaseSummary of releases) {
    const releaseId = releaseSummary.id;
    const detailResult = await getRelease(releaseId);
    const release = detailResult.ok && detailResult.body ? detailResult.body : releaseSummary;
    const summary = summarizeReleaseApproval(release, reviewerGroup);
    if (summary.status !== 'not_found') return summary;
  }

  const first = releases[0];
  return {
    status: 'not_found',
    label: 'Release found',
    buildId: buildId,
    releaseId: first.id,
    releaseName: first.name || '',
    releaseUrl: first._links && first._links.web && first._links.web.href || ''
  };
}

function summarizeReleaseApproval(release, reviewerGroup) {
  const environments = Array.isArray(release && release.environments) ? release.environments : [];
  const groupText = String(reviewerGroup || '').toLowerCase();
  let best = null;

  for (const env of environments) {
    const envStatus = String(env && env.status || '').toLowerCase();
    const preApprovals = Array.isArray(env && env.preDeployApprovals) ? env.preDeployApprovals : [];
    const approvals = preApprovals.filter(approval => approval && approval.isAutomated !== true);
    const groupApprovals = approvals.filter(approval => {
      if (!groupText) return true;
      const approverName = approval.approver && approval.approver.displayName || '';
      return String(approverName).toLowerCase().includes(groupText);
    });
    const scopedApprovals = groupApprovals.length ? groupApprovals : approvals;

    const pending = scopedApprovals.find(approval => String(approval.status || '').toLowerCase() === 'pending');
    if (pending) {
      return buildReleaseApprovalSummary('pending', release, env, pending);
    }

    const approved = scopedApprovals.find(approval => String(approval.status || '').toLowerCase() === 'approved');
    if (approved && !best) {
      best = buildReleaseApprovalSummary(getReleaseEnvironmentStatus(envStatus), release, env, approved);
    }

    if (!best && envStatus) {
      best = buildReleaseApprovalSummary(getReleaseEnvironmentStatus(envStatus), release, env, null);
    }
  }

  return best || {
    status: 'not_found',
    label: 'No release approval',
    releaseId: release && release.id,
    releaseName: release && release.name || '',
    releaseUrl: release && release._links && release._links.web && release._links.web.href || ''
  };
}

function buildReleaseApprovalSummary(status, release, env, approval) {
  const definitionName = release && release.releaseDefinition && release.releaseDefinition.name || '';
  const releaseUrl = release && release._links && release._links.web && release._links.web.href ||
    env && env.release && env.release._links && env.release._links.web && env.release._links.web.href ||
    '';
  return {
    status: status,
    label: getReleaseLabel(status),
    releaseId: release && release.id,
    releaseName: release && release.name || '',
    releaseDefinitionId: release && release.releaseDefinition && release.releaseDefinition.id || '',
    releaseDefinitionName: definitionName,
    cdName: definitionName,
    environmentId: env && env.id,
    environmentName: env && env.name || '',
    environmentStatus: env && env.status || '',
    approvalId: approval && approval.id,
    approvalStatus: approval && approval.status || '',
    approver: approval && approval.approver && approval.approver.displayName || '',
    approvedBy: approval && approval.approvedBy && approval.approvedBy.displayName || '',
    createdOn: approval && approval.createdOn || '',
    modifiedOn: approval && approval.modifiedOn || '',
    releaseUrl: releaseUrl
  };
}

function getReleaseEnvironmentStatus(envStatus) {
  if (envStatus === 'succeeded') return 'succeeded';
  if (envStatus === 'failed' || envStatus === 'canceled' || envStatus === 'rejected') return 'failed';
  if (envStatus === 'inprogress' || envStatus === 'queued' || envStatus === 'scheduled') return 'deploying';
  if (envStatus === 'notstarted') return 'waiting';
  return envStatus || 'approved';
}

function getReleaseLabel(status) {
  const labels = {
    pending: 'Release approval pending',
    approved: 'Release approved',
    succeeded: 'Deploy succeeded',
    failed: 'Deploy failed',
    deploying: 'Deploying',
    waiting: 'Waiting for release'
  };
  return labels[status] || 'Release detected';
}

/**
 * ดึง PR detail พร้อม reviewers
 */
async function getPullRequest(prId, options) {
  const { org, project } = getConfig();
  const opts = options || {};
  const repositoryId = opts.repositoryId || opts.repoId || '';
  const authOptions = opts.accessToken
    ? { accessToken: opts.accessToken }
    : opts.requestOptions || undefined;
  const path = repositoryId
    ? `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullRequests/${prId}?api-version=7.0&$expand=reviewers`
    : `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/pullrequests/${prId}?api-version=7.0&$expand=reviewers`;
  return adoRequest('GET', path, null, authOptions);
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

async function listBuilds(options) {
  const { org, project } = getConfig();
  const opts = options || {};
  const params = [
    'queryOrder=finishTimeDescending',
    '$top=' + encodeURIComponent(String(opts.top || 100)),
    'api-version=7.0'
  ];
  if (opts.minTime) params.push('minTime=' + encodeURIComponent(opts.minTime));
  if (opts.maxTime) params.push('maxTime=' + encodeURIComponent(opts.maxTime));
  if (opts.statusFilter) params.push('statusFilter=' + encodeURIComponent(opts.statusFilter));
  if (opts.resultFilter) params.push('resultFilter=' + encodeURIComponent(opts.resultFilter));
  if (opts.branchName) params.push('branchName=' + encodeURIComponent(opts.branchName));
  if (opts.repositoryId) {
    params.push('repositoryId=' + encodeURIComponent(opts.repositoryId));
    params.push('repositoryType=' + encodeURIComponent(opts.repositoryType || 'TfsGit'));
  }

  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/build/builds?${params.join('&')}`;
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
 * ดึง PR ตาม status แบบแบ่งหน้า ใช้สำหรับ background scanners
 */
async function listPullRequestsByStatus(status, options) {
  const { org, project } = getConfig();
  const opts = options || {};
  const pageSize = Math.min(Math.max(Number(opts.top || opts.pageSize || 100), 25), 500);
  const maxPages = Math.min(Math.max(Number(opts.maxPages || 10), 1), 50);
  const values = [];
  let continuationToken = '';
  let pagesFetched = 0;
  let lastResult = null;

  for (let page = 0; page < maxPages; page++) {
    const params = [
      'api-version=7.0',
      'searchCriteria.status=' + encodeURIComponent(status || 'active'),
      '$top=' + encodeURIComponent(String(pageSize))
    ];
    if (continuationToken) {
      params.push('continuationToken=' + encodeURIComponent(continuationToken));
    }

    const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/pullrequests?${params.join('&')}`;
    const result = await adoRequest('GET', path);
    lastResult = result;
    if (!result.ok) return Object.assign({}, result, { pagesFetched });

    const pageValues = result.body && Array.isArray(result.body.value)
      ? result.body.value
      : [];
    values.push(...pageValues);
    pagesFetched += 1;

    continuationToken = getHeader(result.headers, 'x-ms-continuationtoken');
    if (!continuationToken || pageValues.length === 0) break;
  }

  return {
    ok: true,
    status: lastResult ? lastResult.status : 200,
    body: {
      count: values.length,
      value: values
    },
    pagesFetched: pagesFetched
  };
}

function getHeader(headers, name) {
  const source = headers || {};
  const target = String(name || '').toLowerCase();
  return source[target] || source[name] || '';
}

/**
 * ดึง identity ของ connection ปัจจุบัน
 * - ถ้าส่ง options.accessToken จะได้ Azure DevOps user identity ของผู้ใช้ที่ connect
 * - ถ้าไม่ส่ง options จะ fallback เป็น PAT/service account
 */
async function getConnectionData(options) {
  const { org } = getConfig();
  const path = `/${encodeURIComponent(org)}/_apis/connectionData`;
  return adoRequest('GET', path, null, options);
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
  const statusBuild = buildStatuses.length ? summarizeStates(buildStatuses) : null;
  const build = chooseBuildSummary(statusBuild, branchBuild);
  const policy = summarizePolicyEvaluations(evaluations, values);
  const buildWithUrl = buildStatuses.find(s => s && s.targetUrl);
  const buildFromBranch = build === branchBuild;

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
    adoBuildUrl: buildFromBranch ? branchBuild.url : (buildWithUrl ? buildWithUrl.targetUrl : branchBuild.url),
    statusCount: values.length,
    buildStatusCount: buildFromBranch ? branchBuild.count : (buildStatuses.length || branchBuild.count),
    buildStatusSource: buildFromBranch ? branchBuild.source : (buildStatuses.length ? 'pr-status' : branchBuild.source),
    buildRunId: buildFromBranch ? branchBuild.id : '',
    policyEvaluationCount: evaluations.length
  };
}

function chooseBuildSummary(statusBuild, branchBuild) {
  const status = statusBuild || null;
  const branch = branchBuild || { status: 'no_status', result: 'unknown', url: '', count: 0, source: '', id: '' };
  if (!status) return branch;

  const statusResult = String(status.result || '').toLowerCase();
  const branchResult = String(branch.result || '').toLowerCase();
  if (branchResult === 'failed' || branchResult === 'error') return branch;
  if (statusResult === 'failed' || statusResult === 'error') return status;
  if ((branchResult === 'succeeded' || branchResult === 'success') &&
      (statusResult === 'unknown' || statusResult === 'pending')) return branch;
  return status;
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
async function approvePR(prId, repositoryId, botUserId, options) {
  const { org, project } = getConfig();
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${repositoryId}/pullRequests/${prId}/reviewers/${botUserId}?api-version=7.0`;
  return adoRequest('PUT', path, {
    vote: 10,
    isRequired: false
  }, options);
}

/**
 * Vote = -10 (Rejected)
 */
async function rejectPR(prId, repositoryId, botUserId, options) {
  const { org, project } = getConfig();
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${repositoryId}/pullRequests/${prId}/reviewers/${botUserId}?api-version=7.0`;
  return adoRequest('PUT', path, {
    vote: -10,
    isRequired: false
  }, options);
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
  const requestOptions = options.requestOptions || {};
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
  }, requestOptions);
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

async function getPendingReleaseApprovals(reviewerGroup) {
  const { org, project } = getConfig();
  const params = [
    'status=pending',
    'type=preDeploy',
    'api-version=7.1'
  ].join('&');
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/release/approvals?${params}`;
  const result = await releaseRequest('GET', path);
  if (!result.ok || !result.body || !Array.isArray(result.body.value)) {
    return [];
  }

  const approvals = result.body.value;
  if (reviewerGroup) {
    const groupText = String(reviewerGroup).toLowerCase().trim();
    return approvals.filter(app => {
      const name = app.approver && app.approver.displayName || '';
      return name.toLowerCase().includes(groupText);
    });
  }
  return approvals;
}

async function listGitRefs(repositoryId, filterPrefix) {
  const { org, project } = getConfig();
  const filter = filterPrefix ? `&filter=${encodeURIComponent(filterPrefix)}` : '';
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/refs?api-version=7.0${filter}`;
  return adoRequest('GET', path);
}

async function getBuildTimeline(buildId) {
  const { org, project } = getConfig();
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/build/builds/${encodeURIComponent(String(buildId))}/timeline?api-version=6.0`;
  return adoRequest('GET', path);
}

async function getBuildLog(buildId, logId) {
  const { org, project } = getConfig();
  const path = `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/build/builds/${encodeURIComponent(String(buildId))}/logs/${encodeURIComponent(String(logId))}?api-version=6.0`;
  return adoRequest('GET', path);
}

module.exports = {
  getConfig,
  adoRequest,
  releaseRequest,
  getPullRequest,
  getPullRequestStatuses,
  getBuildsForBranch,
  listBuilds,
  getPolicyEvaluations,
  listActivePRs,
  listPullRequestsByStatus,
  getConnectionData,
  approvePR,
  rejectPR,
  setAutoComplete,
  hasReviewerGroup,
  getBranchPolicies,
  findReleaseNotesPolicyIds,
  findMinimumApproverCount,
  isBuildStatus,
  summarizeStatusSnapshot,
  listReleasesByBuildId,
  getRelease,
  approveReleaseApproval,
  getLatestReleaseApprovalForBuild,
  summarizeReleaseApproval,
  getPendingReleaseApprovals,
  listGitRefs,
  getBuildTimeline,
  getBuildLog
};

