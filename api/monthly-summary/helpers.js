const attentionUtil = require('../shared/attention');

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

function getBangkokMonthRange(reportMonth, nowValue) {
  let year;
  let monthIndex;
  if (reportMonth) {
    const match = String(reportMonth).trim().match(/^(\d{4})-(\d{2})$/);
    if (!match) throw new Error('reportMonth must use YYYY-MM format');
    year = Number(match[1]);
    monthIndex = Number(match[2]) - 1;
    if (monthIndex < 0 || monthIndex > 11) throw new Error('reportMonth is not a valid calendar month');
  } else {
    const now = nowValue instanceof Date ? nowValue : new Date(nowValue || Date.now());
    const bkkNow = new Date(now.getTime() + BANGKOK_OFFSET_MS);
    year = bkkNow.getUTCFullYear();
    monthIndex = bkkNow.getUTCMonth() - 1;
    if (monthIndex < 0) {
      year--;
      monthIndex = 11;
    }
  }
  return createMonthRange(year, monthIndex);
}

function createMonthRange(year, monthIndex) {
  const startUtcMs = Date.UTC(year, monthIndex, 1) - BANGKOK_OFFSET_MS;
  const endUtcMs = Date.UTC(year, monthIndex + 1, 1) - BANGKOK_OFFSET_MS;
  return {
    year,
    monthIndex,
    month: monthIndex + 1,
    monthKey: String(year).padStart(4, '0') + '-' + String(monthIndex + 1).padStart(2, '0'),
    monthLabel: new Date(startUtcMs).toLocaleDateString('th-TH', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: 'long'
    }),
    startUtcMs,
    endUtcMs,
    startIso: new Date(startUtcMs).toISOString(),
    endIso: new Date(endUtcMs).toISOString()
  };
}

function getPreviousMonthRange(range) {
  return createMonthRange(
    range.monthIndex === 0 ? range.year - 1 : range.year,
    range.monthIndex === 0 ? 11 : range.monthIndex - 1
  );
}

async function fetchAllPullRequests(ado, org, project) {
  const statuses = ['active', 'completed', 'abandoned'];
  const seen = new Map();
  for (const status of statuses) {
    let continuationToken = '';
    do {
      const params = [
        'api-version=7.0',
        'searchCriteria.status=' + encodeURIComponent(status),
        '$top=200'
      ];
      if (continuationToken) params.push('continuationToken=' + encodeURIComponent(continuationToken));
      const path = '/' + encodeURIComponent(org) + '/' + encodeURIComponent(project) +
        '/_apis/git/pullrequests?' + params.join('&');
      const result = await ado.adoRequest('GET', path);
      if (!result.ok || !result.body || !Array.isArray(result.body.value)) {
        throw new Error('ADO pull request lookup failed: HTTP ' + result.status);
      }
      result.body.value.forEach(pr => {
        if (pr && pr.pullRequestId) seen.set(String(pr.pullRequestId), pr);
      });
      continuationToken = getResponseHeader(result.headers, 'x-ms-continuationtoken');
      if (!result.body.value.length) continuationToken = '';
    } while (continuationToken);
  }
  return Array.from(seen.values());
}

function isRelevantPr(ado, pr, targetPrefix, reviewerGroup) {
  const targetRef = String(pr && pr.targetRefName || '').toLowerCase();
  return (targetRef.startsWith(targetPrefix) || isMergeCodeBranch(targetRef)) &&
    ado.hasReviewerGroup(pr, reviewerGroup);
}

function calculatePrStats(prs, range) {
  const createdItems = prs.filter(pr => isWithin(pr.creationDate, range.startUtcMs, range.endUtcMs));
  const completedItems = prs.filter(pr =>
    String(pr.status || '').toLowerCase() === 'completed' &&
    isWithin(getClosedDate(pr), range.startUtcMs, range.endUtcMs));
  const abandonedItems = prs.filter(pr =>
    String(pr.status || '').toLowerCase() === 'abandoned' &&
    isWithin(getClosedDate(pr), range.startUtcMs, range.endUtcMs));
  const completedCreatedThisMonth = createdItems.filter(pr =>
    String(pr.status || '').toLowerCase() === 'completed' &&
    isWithin(getClosedDate(pr), range.startUtcMs, range.endUtcMs));
  return {
    created: createdItems.length,
    completed: completedItems.length,
    abandoned: abandonedItems.length,
    completionRate: createdItems.length > 0
      ? roundPercent(completedCreatedThisMonth.length, createdItems.length)
      : 0,
    createdItems
  };
}

function calculateApprovalStats(items) {
  const uniquePrs = new Set();
  let totalActions = 0;
  let autoApproved = 0;
  let manualApproved = 0;
  let rejected = 0;
  let onHold = 0;
  for (const item of items || []) {
    const fields = item && item.fields || {};
    const prId = parseInt(fields.PR_ID, 10);
    if (!prId || Number.isNaN(prId)) continue;
    const action = String(fields.Action || '').toLowerCase();
    totalActions++;
    uniquePrs.add(String(prId));
    if (action.includes('auto approved') || action.includes('autoapproved')) autoApproved++;
    else if (action.includes('approved')) manualApproved++;
    else if (action.includes('reject')) rejected++;
    else if (action.includes('hold')) onHold++;
  }
  const totalApproved = autoApproved + manualApproved;
  return {
    uniquePrs: uniquePrs.size,
    totalActions,
    autoApproved,
    manualApproved,
    rejected,
    onHold,
    autoApproveRate: totalApproved > 0 ? roundPercent(autoApproved, totalApproved) : 0
  };
}

async function buildAttentionSnapshot(context, ado, cfg, activePrs) {
  const rows = [];
  const targets = activePrs.slice(0, 100);
  for (let i = 0; i < targets.length; i += 15) {
    const results = await Promise.all(
      targets.slice(i, i + 15).map(pr => buildAttentionRow(context, ado, cfg, pr))
    );
    rows.push(...results);
  }
  const attentionRows = rows
    .filter(row => row.attention && Number(row.attention.rank) >= 2)
    .sort(attentionUtil.sortByAttention);
  return {
    counts: {
      critical: attentionRows.filter(row => row.attention.status === 'critical').length,
      warning: attentionRows.filter(row => row.attention.status === 'warning').length,
      stale: attentionRows.filter(row => row.attention.status === 'stale').length,
      rejected: rows.filter(row => row.approvalStatus === 'rejected').length,
      failedOrPolicyFailed: rows.filter(row => row.issueType).length
    },
    items: attentionRows
  };
}

async function buildAttentionRow(context, ado, cfg, pr) {
  let snapshot = ado.summarizeStatusSnapshot(pr, [], null);
  try {
    const repoId = pr.repository && pr.repository.id;
    if (repoId && pr.pullRequestId) {
      const [statusesResult, policyResult] = await Promise.all([
        ado.getPullRequestStatuses(repoId, pr.pullRequestId),
        ado.getPolicyEvaluations(pr.pullRequestId)
      ]);
      const statuses = statusesResult.ok && statusesResult.body && Array.isArray(statusesResult.body.value)
        ? statusesResult.body.value : [];
      const policies = policyResult.ok && policyResult.body && Array.isArray(policyResult.body.value)
        ? policyResult.body.value : [];
      snapshot = ado.summarizeStatusSnapshot(pr, statuses, null, policies, []);
    }
  } catch (err) {
    context.log.warn('Monthly attention lookup failed for #' + pr.pullRequestId + ': ' + err.message);
  }
  const approvalStatus = getApprovalStatus(pr.reviewers || []);
  const buildResult = String(snapshot.buildResult || '').toLowerCase();
  const policyStatus = String(snapshot.policyStatus || '').toLowerCase();
  return {
    id: pr.pullRequestId,
    repository: pr.repository && pr.repository.name || '',
    title: pr.title || '',
    url: buildPrUrl(cfg, pr),
    approvalStatus,
    issueType: buildResult === 'failed' || buildResult === 'error' || policyStatus === 'failed',
    attention: attentionUtil.buildAttention(pr, { status: approvalStatus }, snapshot, isMergeCodeBranch(pr.targetRefName))
  };
}

function getApprovalStatus(reviewers) {
  const people = (Array.isArray(reviewers) ? reviewers : []).filter(r => r && r.isContainer !== true);
  const required = (Array.isArray(reviewers) ? reviewers : []).filter(r => r && r.isRequired === true);
  const scoped = required.length ? required : people;
  if (people.some(r => Number(r.vote) <= -10) || required.some(r => Number(r.vote) <= -10)) return 'rejected';
  const approved = scoped.filter(r => Number(r.vote) >= 10).length;
  return scoped.length > 0 && approved >= scoped.length ? 'complete' : 'pending';
}

async function loadDeploymentArchive(context, sp, range) {
  const filePath = 'deploy-history/stg-deployments-' + range.year + '.csv';
  const result = await sp.downloadArchiveFile(filePath);
  if (result.ok) return parseCsv(typeof result.body === 'string' ? result.body : String(result.body || ''));
  if (result.status !== 404) {
    context.log.warn('Monthly deployment archive returned HTTP ' + result.status + ': ' + filePath);
  }
  return [];
}

function calculateBuildStats(rows, range) {
  let total = 0;
  let succeeded = 0;
  let failed = 0;
  let inProgress = 0;
  const failedRepos = {};
  for (const row of rows || []) {
    const pipeline = String(row.PipelineName || '').toLowerCase();
    if (pipeline.includes('schedule') || pipeline.includes('scripts')) continue;
    if (!isStagingDeployment(row)) continue;
    const ts = Date.parse(row.FinishedTime || '');
    if (!Number.isFinite(ts) || ts < range.startUtcMs || ts >= range.endUtcMs) continue;
    total++;
    const status = String(row.Status || '').toLowerCase();
    if (status === 'succeeded') succeeded++;
    else if (isFailedStatus(status)) {
      failed++;
      const repo = getDeploymentRepo(row);
      if (repo !== 'Unknown') failedRepos[repo] = (failedRepos[repo] || 0) + 1;
    } else if (status === 'inprogress') inProgress++;
  }
  return {
    total,
    succeeded,
    failed,
    inProgress,
    successRate: total > 0 ? roundPercent(succeeded, total) : 0,
    topFailedRepos: Object.keys(failedRepos)
      .map(repo => ({ repo, count: failedRepos[repo] }))
      .sort((a, b) => b.count - a.count || a.repo.localeCompare(b.repo))
      .slice(0, 5)
  };
}

function buildComparison(current, previous) {
  const currentValue = Number(current) || 0;
  const previousValue = Number(previous) || 0;
  return {
    current: currentValue,
    previous: previousValue,
    delta: currentValue - previousValue,
    percent: previousValue > 0
      ? Number((((currentValue - previousValue) / previousValue) * 100).toFixed(1))
      : null
  };
}

function getTopRepositories(items, limit) {
  const counts = {};
  for (const pr of items || []) {
    const repo = pr.repository && pr.repository.name || 'Unknown';
    counts[repo] = (counts[repo] || 0) + 1;
  }
  return Object.keys(counts)
    .map(repo => ({ repo, count: counts[repo] }))
    .sort((a, b) => b.count - a.count || a.repo.localeCompare(b.repo))
    .slice(0, limit || 5);
}

function parseCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const lines = source.split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => { row[header] = values[index] || ''; });
    return row;
  });
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < String(line).length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      values.push(current);
      current = '';
    } else current += ch;
  }
  values.push(current);
  return values;
}

function isStagingDeployment(row) {
  const branch = String(row.Branch || '').toLowerCase().replace(/^refs\/heads\//, '');
  const pipeline = String(row.PipelineName || '').toLowerCase();
  return branch === 'staging' || branch.startsWith('staging/') ||
    pipeline.includes('staging') || pipeline.includes('-stg');
}

function isFailedStatus(status) {
  return ['failed', 'partiallysucceeded', 'canceled', 'cancelled']
    .includes(String(status || '').toLowerCase());
}

function getDeploymentRepo(row) {
  return String(row.RepoName || row.Repository || row.PipelineName || 'Unknown').trim() || 'Unknown';
}

function getClosedDate(pr) {
  return pr.closedDate || pr.completionDate ||
    (pr.lastMergeCommit && pr.lastMergeCommit.committer && pr.lastMergeCommit.committer.date) || '';
}

function isWithin(value, start, end) {
  const ts = Date.parse(value || '');
  return Number.isFinite(ts) && ts >= start && ts < end;
}

function isMergeCodeBranch(value) {
  return String(value || '').toLowerCase().includes('mergecode');
}

function buildPrUrl(cfg, pr) {
  const repo = pr.repository && pr.repository.name;
  return repo
    ? 'https://dev.azure.com/' + cfg.org + '/' + cfg.project + '/_git/' + repo + '/pullrequest/' + pr.pullRequestId
    : '';
}

function getResponseHeader(headers, name) {
  const source = headers || {};
  return String(source[String(name).toLowerCase()] || source[name] || '');
}

function roundPercent(value, total) {
  return Number(((Number(value) / Number(total)) * 100).toFixed(2));
}

module.exports = {
  getBangkokMonthRange,
  getPreviousMonthRange,
  fetchAllPullRequests,
  isRelevantPr,
  calculatePrStats,
  calculateApprovalStats,
  buildAttentionSnapshot,
  loadDeploymentArchive,
  calculateBuildStats,
  buildComparison,
  getTopRepositories,
  isMergeCodeBranch
};
