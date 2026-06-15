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
const ado = require('../shared/ado-client');
const attentionUtil = require('../shared/attention');
const mergePipelineMap = require('../shared/merge-pipeline-map');
const approvalHold = require('../shared/approval-hold');

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
    const currentUser = getCurrentUser(req.headers['x-ms-client-principal']);
    const org = process.env.ADO_ORGANIZATION;
    const project = process.env.ADO_PROJECT;
    const pat = process.env.ADO_PAT;

    // [แก้ไข] เปลี่ยนจาก exact match → prefix match (case-insensitive)
    // รองรับ: staging, Staging/VN, Staging/api, refs/heads/Staging/TH ฯลฯ
    const stagingPrefix = (process.env.ADO_TARGET_BRANCH || 'refs/heads/staging').toLowerCase();
    const reviewerGroup = process.env.ADO_REVIEWER_GROUP || 'IT Support Approve';
    const completedLookbackHours = Number(process.env.COMPLETED_PR_LOOKBACK_HOURS) || 24;
    const completedDisplayLimit = Math.min(Math.max(Number(process.env.COMPLETED_PR_DISPLAY_LIMIT) || 10, 1), 100);
    const approvedLookupLimit = Math.min(Math.max(Number(process.env.APPROVED_PR_LOOKUP_LIMIT) || 100, 1), 200);
    const includeActivity = req.query && String(req.query.includeActivity || '').toLowerCase() === 'true';
    const activityPage = Math.max(Number(req.query && req.query.activityPage) || 0, 0);
    const activityPageSize = Math.min(Math.max(Number(req.query && req.query.activityPageSize) || completedDisplayLimit, 1), 25);
    const activityStatus = normalizeFilter(req.query && req.query.activityStatus);
    const activitySource = normalizeFilter(req.query && req.query.activitySource);
    const branchBuildCache = {};
    const releaseLookupCache = {};

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
      .filter(pr => {
        const targetRef = (pr.targetRefName || '').toLowerCase();
        return targetRef.startsWith(stagingPrefix) || isMergeCodeBranch(targetRef);
      });
    const prs = [];
    const hiddenActionCompletePrs = [];
    if (!includeActivity) {
      const candidateRows = [];
      for (const pr of targetPrs
        .filter(pr => hasReviewerGroup(pr, reviewerGroup))
      ) {
        const row = await buildPrRow(context, pr, currentUser, org, project, branchBuildCache, releaseLookupCache, reviewerGroup);
        candidateRows.push(row);
      }
      await attachApprovalHoldStates(context, candidateRows);
      for (const row of candidateRows) {
        if (shouldShowActivePr(row)) {
          prs.push(row);
        } else {
          hiddenActionCompletePrs.push(row);
        }
      }
      prs.sort(attentionUtil.sortByAttention);

      // Fetch all direct pending release approvals for the reviewer group
      try {
        const directApprovals = await ado.getPendingReleaseApprovals(reviewerGroup);
        context.log('Fetched direct pending release approvals:', directApprovals.length);
        for (const app of directApprovals) {
          const alreadyMapped = prs.some(p => p.releaseApproval && String(p.releaseApproval.approvalId) === String(app.id));
          if (alreadyMapped) continue;

          context.log('Building virtual release row for approval ID:', app.id);
          const vRow = await buildVirtualReleaseRow(context, app, pat, org, project);
          const targetRef = (vRow.targetBranch || '').toLowerCase();
          if (targetRef.startsWith(stagingPrefix) || isMergeCodeBranch(targetRef)) {
            prs.push(vRow);
          } else {
            context.log('Filtered out virtual release row with non-staging branch:', vRow.targetBranch);
          }
        }
      } catch (e) {
        context.log.warn('Failed to merge direct pending release approvals:', e.message);
      }
    }



    const approvedLookup = includeActivity
      ? await buildRecentlyApprovedRows(context, {
        currentUser: currentUser,
        org: org,
        project: project,
        stagingPrefix: stagingPrefix,
        reviewerGroup: reviewerGroup,
        lookbackHours: completedLookbackHours,
        maxRows: approvedLookupLimit,
        page: activityPage,
        pageSize: activityPageSize,
        statusFilter: activityStatus,
        sourceFilter: activitySource,
        branchBuildCache: branchBuildCache,
        releaseLookupCache: releaseLookupCache
      })
      : {
        rows: [],
        meta: {
          ok: true,
          source: 'Skipped',
          skipped: true,
          reason: 'Activity lookup is disabled for dashboard requests'
        }
      };
    const recentlyApprovedPrs = approvedLookup.rows;
    const completedPrs = recentlyApprovedPrs;

    const activeNotificationResult = includeActivity
      ? { ok: true, checked: 0, sent: 0, skipped: true, reason: 'Skipped on activity page request' }
      : await syncExceptionNotifications(context, prs, { scope: 'active' });
    const completedNotificationResult = includeActivity
      ? { ok: true, checked: 0, sent: 0, skipped: true, reason: 'Skipped on activity page request' }
      : await syncExceptionNotifications(context, completedPrs, { scope: 'recently-completed' });
    const syncResult = includeActivity
      ? { ok: true, checked: 0, logged: 0, skipped: true, reason: 'Skipped on activity page request' }
      : await syncExternalVoteLogs(context, prs.concat(completedPrs), currentUser);

    jsonResponse(200, {
      ok: true,
      count: prs.length,
      totalActive: allActivePrs.length,
      totalTargetBranch: targetPrs.length,
      hiddenActionCompleteCount: hiddenActionCompletePrs.length,
      organization: org,
      project: project,
      targetBranch: stagingPrefix,
      reviewerGroup: reviewerGroup,
      completedLookbackHours: completedLookbackHours,
      fetchedAt: new Date().toISOString(),
      prs: prs,
      attentionSummary: attentionUtil.buildAttentionSummary(prs),
      completedCount: recentlyApprovedPrs.length,
      completedTotalMatched: approvedLookup.meta && Number.isFinite(Number(approvedLookup.meta.uniquePrs))
        ? approvedLookup.meta.uniquePrs
        : recentlyApprovedPrs.length,
      completedDisplayLimit: includeActivity ? activityPageSize : completedDisplayLimit,
      approvedLookback: approvedLookup.meta,
      activityFilters: {
        status: activityStatus,
        source: activitySource
      },
      exceptionNotifications: {
        ok: activeNotificationResult.ok && completedNotificationResult.ok,
        active: activeNotificationResult,
        recentlyCompleted: completedNotificationResult,
        checked: (activeNotificationResult.checked || 0) + (completedNotificationResult.checked || 0),
        sent: (activeNotificationResult.sent || 0) + (completedNotificationResult.sent || 0)
      },
      externalLogSync: syncResult,
      completedPrs: recentlyApprovedPrs
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

function isMergeCodeBranch(refName) {
  return String(refName || '').toLowerCase().includes('mergecode');
}

async function buildRecentlyApprovedRows(context, options) {
  const meta = {
    ok: true,
    source: 'SharePoint Log',
    checked: 0,
    matchedLogs: 0,
    uniquePrs: 0,
    skipped: 0
  };
  const currentUser = options.currentUser || {};
  const identities = Array.isArray(currentUser.identities) ? currentUser.identities : [];
  if (identities.length === 0) {
    meta.ok = false;
    meta.error = 'Current user identity is not available';
    return { rows: [], meta: meta };
  }

  let sp;
  try {
    sp = require('../shared/sharepoint-client');
  } catch (e) {
    meta.ok = false;
    meta.error = 'Failed to load sharepoint-client: ' + e.message;
    return { rows: [], meta: meta };
  }

  const since = new Date(Date.now() - options.lookbackHours * 60 * 60 * 1000).toISOString();
  let result;
  try {
    result = await sp.getLogItemsSince(since, Math.max(options.maxRows * 5, 100));
  } catch (e) {
    meta.ok = false;
    meta.error = 'Failed to query approved logs: ' + e.message;
    return { rows: [], meta: meta };
  }

  if (!result.ok) {
    meta.ok = false;
    meta.error = 'SharePoint returned ' + result.status;
    return { rows: [], meta: meta };
  }

  const logs = result.body && Array.isArray(result.body.value) ? result.body.value : [];
  meta.checked = logs.length;
  const approvedByPr = new Map();
  const sinceTime = Date.parse(since);

  for (const item of logs) {
    const fields = item && item.fields || {};
    const prId = parseInt(fields.PR_ID, 10);
    if (!Number.isFinite(prId) || prId <= 0) continue;
    if (!isApprovedLogAction(fields.Action)) continue;
    if (!identityMatches(fields.User, identities)) continue;

    const createdAt = item.createdDateTime || item.lastModifiedDateTime || fields.Last_Checked_At || '';
    const createdTime = Date.parse(createdAt);
    if (Number.isFinite(sinceTime) && (!Number.isFinite(createdTime) || createdTime < sinceTime)) continue;
    const existing = approvedByPr.get(prId);
    if (!existing || compareDateDesc({ approvedAt: createdAt }, { approvedAt: existing.approvedAt }) < 0) {
      approvedByPr.set(prId, {
        prId: prId,
        approvedAt: createdAt,
        action: fields.Action || '',
        user: fields.User || '',
        source: fields.Log_Source || fields.Source || '',
        logId: item.id || ''
      });
    }
  }

  const approvals = Array.from(approvedByPr.values())
    .sort(compareDateDesc)
    .filter(log => matchesActivitySource(log, options.sourceFilter))
    .slice(0, options.maxRows);
  meta.matchedLogs = approvals.length;
  meta.page = Math.max(Number(options.page) || 0, 0);
  meta.pageSize = Math.min(Math.max(Number(options.pageSize) || 10, 1), 25);
  meta.filters = {
    status: options.statusFilter || '',
    source: options.sourceFilter || ''
  };
  meta.requiresFullEnrich = !!options.statusFilter;
  const pageStart = meta.page * meta.pageSize;
  const pageApprovals = meta.requiresFullEnrich
    ? approvals
    : approvals.slice(pageStart, pageStart + meta.pageSize);

  const prObjectsMap = new Map();
  const rows = [];
  const batchSize = 15;
  for (let i = 0; i < pageApprovals.length; i += batchSize) {
    const batch = pageApprovals.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(async (approvalLog) => {
      try {
        const prResult = await ado.getPullRequest(approvalLog.prId);
        if (!prResult.ok || !prResult.body) {
          meta.skipped += 1;
          return null;
        }
        const pr = prResult.body;
        const targetRef = String(pr.targetRefName || '').toLowerCase();
        if (!(targetRef.startsWith(options.stagingPrefix) || isMergeCodeBranch(targetRef))) {
          meta.skipped += 1;
          return null;
        }
        if (!hasReviewerGroup(pr, options.reviewerGroup)) {
          meta.skipped += 1;
          return null;
        }
        prObjectsMap.set(pr.pullRequestId, pr);
        const row = await buildPrRow(
          context,
          pr,
          options.currentUser,
          options.org,
          options.project,
          options.branchBuildCache,
          options.releaseLookupCache,
          options.reviewerGroup,
          true // skipRelease = true
        );
        row.approvedAt = approvalLog.approvedAt;
        row.approvedAction = approvalLog.action;
        row.approvedSource = approvalLog.source;
        if (matchesActivityStatus(row, options.statusFilter)) {
          return row;
        }
      } catch (e) {
        meta.skipped += 1;
        if (context && context.log && context.log.warn) {
          context.log.warn('Failed to enrich approved PR #' + approvalLog.prId + ': ' + e.message);
        }
      }
      return null;
    }));
    for (const r of batchResults) {
      if (r) rows.push(r);
    }
  }

  rows.sort(compareApprovedRows);
  meta.uniquePrs = meta.requiresFullEnrich ? rows.length : approvals.length;
  meta.totalPages = Math.max(1, Math.ceil(meta.uniquePrs / meta.pageSize));
  const pageRows = meta.requiresFullEnrich
    ? rows.slice(pageStart, pageStart + meta.pageSize)
    : rows;

  // Enrich only the final pageRows with release approval snapshots in parallel!
  await Promise.all(pageRows.map(async (row) => {
    const pr = prObjectsMap.get(row.id);
    if (pr) {
      row.releaseApproval = await getReleaseApprovalSnapshot(
        context,
        pr,
        row.statusSnapshot,
        options.releaseLookupCache,
        options.reviewerGroup
      );
    }
  }));

  return { rows: pageRows, meta: meta };
}

function normalizeFilter(value) {
  const text = String(value || '').trim().toLowerCase();
  return text === 'all' ? '' : text;
}

function matchesActivitySource(log, sourceFilter) {
  if (!sourceFilter) return true;
  const action = String(log && log.action || '').toLowerCase();
  const source = String(log && log.source || '').toLowerCase();
  if (sourceFilter === 'dashboard') {
    return action === 'approved' && (source.includes('dashboard') || !source);
  }
  if (sourceFilter === 'external') {
    return action.includes('external') || source.includes('azure devops sync');
  }
  return source.includes(sourceFilter) || action.includes(sourceFilter);
}

function matchesActivityStatus(row, statusFilter) {
  if (!statusFilter) return true;
  const snapshot = row && row.statusSnapshot || {};
  const buildResult = String(snapshot.buildResult || '').toLowerCase();
  const buildStatus = String(snapshot.buildStatus || '').toLowerCase();
  const policyStatus = String(snapshot.policyStatus || '').toLowerCase();
  const prStatus = String(row && row.status || '').toLowerCase();
  const mergeStatus = String(snapshot.mergeStatus || row && row.mergeStatus || '').toLowerCase();

  if (statusFilter === 'build-failed') {
    return buildResult === 'failed' || buildResult === 'error';
  }
  if (statusFilter === 'policy-pending') {
    return policyStatus === 'pending';
  }
  if (statusFilter === 'completed') {
    return prStatus === 'completed' || mergeStatus === 'succeeded' || mergeStatus === 'completed';
  }
  if (statusFilter === 'active-pending') {
    return prStatus !== 'completed' &&
      (policyStatus === 'pending' || buildStatus === 'in_progress' || buildResult === 'pending');
  }
  return true;
}

function isApprovedLogAction(action) {
  const text = String(action || '').toLowerCase();
  return text.includes('approved');
}

function identityMatches(value, identities) {
  const normalized = normalizeIdentity(value);
  if (!normalized) return false;
  return identities.some(identity => identity === normalized);
}

function compareApprovedRows(a, b) {
  return compareDateDesc(
    { approvedAt: a && a.approvedAt || a && a.closedDate || a && a.creationDate },
    { approvedAt: b && b.approvedAt || b && b.closedDate || b && b.creationDate }
  );
}

function compareDateDesc(a, b) {
  const timeB = Date.parse(b && b.approvedAt);
  const timeA = Date.parse(a && a.approvedAt);
  if (Number.isFinite(timeB) && Number.isFinite(timeA) && timeB !== timeA) return timeB - timeA;
  return 0;
}

async function syncExternalVoteLogs(context, prRows, currentUser) {
  const rows = Array.isArray(prRows) ? prRows.slice(0, 25) : [];
  if (!rows.length || process.env.ADO_EXTERNAL_LOG_SYNC === 'false') {
    return { ok: true, checked: 0, logged: 0, skipped: true };
  }

  let sp;
  let notifications = null;
  try {
    sp = require('../shared/sharepoint-client');
    notifications = require('../shared/notification-service');
  } catch (e) {
    context.log.warn('External vote log sync skipped: cannot load sync dependencies: ' + e.message);
    return { ok: false, checked: 0, logged: 0, error: e.message };
  }

  // Get bot identities
  let botIdentities = [];
  try {
    const conn = await ado.getConnectionData();
    if (conn.ok && conn.body && conn.body.authenticatedUser) {
      const user = conn.body.authenticatedUser;
      botIdentities = [
        user.id,
        user.uniqueName,
        user.displayName
      ].map(v => String(v || '').trim().toLowerCase()).filter(Boolean);
    }
  } catch (e) {
    context.log.warn('Failed to fetch bot connection data for external vote log sync: ' + e.message);
  }

  // Get current user identities
  const userIdentities = currentUser && Array.isArray(currentUser.identities)
    ? currentUser.identities
    : [];

  const allowedVoters = [...botIdentities, ...userIdentities];

  let checked = 0;
  let logged = 0;
  const errors = [];

  for (const pr of rows) {
    try {
      const history = await sp.getLogForPR(pr.id);
      const existing = history.ok && history.body && Array.isArray(history.body.value)
        ? history.body.value.map(item => item.fields || {})
        : [];

      const voteEvents = buildExternalVoteEvents(pr, allowedVoters);
      for (const event of voteEvents) {
        checked += 1;
        if (hasExistingVoteLog(existing, event)) continue;

        const s = pr.statusSnapshot || {};
        const fields = sp.buildLogFields({
          prId: pr.id,
          action: event.action,
          user: event.user,
          repository: pr.repository,
          prTitle: pr.title,
          targetBranch: pr.targetBranch,
          result: event.result,
          reason: event.reason,
          source: 'Azure DevOps Sync',
          eventKey: event.eventKey,
          buildStatus: s.buildStatus,
          buildResult: s.buildResult,
          policyStatus: s.policyStatus,
          mergeStatus: s.mergeStatus || pr.mergeStatus,
          autoCompleteStatus: s.autoCompleteStatus,
          lastCheckedAt: s.lastCheckedAt,
          adoBuildUrl: s.adoBuildUrl,
          adoPrUrl: pr.url
        });
        const addResult = await sp.addLogItem(fields);
        if (addResult.ok) {
          logged += 1;
          if (event.action === 'External Rejected' && notifications) {
            await notifications.notifyRejected(context, {
              prId: pr.id,
              user: event.user,
              repository: pr.repository,
              prTitle: pr.title,
              targetBranch: pr.targetBranch,
              reason: event.reason,
              statusSnapshot: s,
              adoPrUrl: pr.url
            });
          }
        } else {
          errors.push('PR #' + pr.id + ' ' + event.action + ': HTTP ' + addResult.status);
        }
      }
    } catch (e) {
      errors.push('PR #' + (pr && pr.id) + ': ' + e.message);
    }
  }

  if (errors.length) {
    context.log.warn('External vote log sync completed with errors: ' + errors.slice(0, 3).join(' | '));
  }
  return { ok: errors.length === 0, checked: checked, logged: logged, errors: errors.slice(0, 5) };
}

async function syncExceptionNotifications(context, prRows, options) {
  const rows = Array.isArray(prRows) ? prRows.slice(0, 25) : [];
  if (!rows.length || process.env.TEAMS_EXCEPTION_NOTIFICATIONS === 'false') {
    return { ok: true, checked: 0, sent: 0, skipped: true };
  }

  let notifications;
  try {
    notifications = require('../shared/notification-service');
  } catch (e) {
    context.log.warn('Exception notification sync skipped: cannot load notification service: ' + e.message);
    return { ok: false, checked: 0, sent: 0, error: e.message };
  }

  let checked = 0;
  let sent = 0;
  const errors = [];
  for (const pr of rows) {
    try {
      checked += 1;
      const result = await notifications.notifyPrIssueIfNeeded(context, pr, options);
      if (result && result.ok) sent += 1;
      if (result && result.ok === false && result.error) errors.push('PR #' + pr.id + ': ' + result.error);
    } catch (e) {
      errors.push('PR #' + (pr && pr.id) + ': ' + e.message);
    }
  }

  if (errors.length) {
    context.log.warn('Exception notification sync completed with errors: ' + errors.slice(0, 3).join(' | '));
  }
  return { ok: errors.length === 0, checked: checked, sent: sent, errors: errors.slice(0, 5) };
}

function buildExternalVoteEvents(pr, allowedVoters) {
  const reviewers = Array.isArray(pr.reviewers) ? pr.reviewers : [];
  const allowed = Array.isArray(allowedVoters) ? allowedVoters : [];
  return reviewers
    .filter(r => r && r.isContainer !== true)
    .filter(r => {
      if (allowed.length === 0) return true;
      const reviewerValues = [
        r.id,
        r.uniqueName,
        r.displayName
      ].map(v => String(v || '').trim().toLowerCase()).filter(Boolean);
      return reviewerValues.some(val => allowed.includes(val));
    })
    .map(r => {
      const vote = Number(r.vote) || 0;
      const voteState = getVoteState(vote);
      if (!voteState) return null;
      const identity = normalizeIdentity(r.id || r.uniqueName || r.displayName || 'unknown');
      return {
        action: voteState.action,
        result: voteState.result,
        reason: 'Detected from Azure DevOps reviewer vote during dashboard refresh',
        user: r.uniqueName || r.displayName || r.id || 'Unknown',
        reviewerKey: identity,
        vote: vote,
        eventKey: 'ado-sync:vote:' + pr.id + ':' + identity + ':' + vote
      };
    })
    .filter(Boolean);
}

function getVoteState(vote) {
  if (vote >= 10) return { action: 'External Approved', result: 'Approved in Azure DevOps' };
  if (vote === 5) return { action: 'External Approved with Suggestions', result: 'Approved with suggestions in Azure DevOps' };
  if (vote <= -10) return { action: 'External Rejected', result: 'Rejected in Azure DevOps' };
  if (vote === -5) return { action: 'External Waiting Author', result: 'Waiting for author in Azure DevOps' };
  return null;
}

function hasExistingVoteLog(existingLogs, event) {
  return existingLogs.some(log => {
    if (log.Event_Key && log.Event_Key === event.eventKey) return true;
    const action = String(log.Action || '').toLowerCase();
    const user = normalizeIdentity(log.User);
    const sameAction =
      action === event.action.toLowerCase() ||
      (event.action === 'External Approved' && action === 'approved') ||
      (event.action === 'External Rejected' && action === 'rejected');
    return sameAction && user && (
      user === normalizeIdentity(event.user) ||
      user === event.reviewerKey
    );
  });
}

async function getStatusSnapshot(context, adoClient, pr, repositoryId, isMergeCodeTarget, branchBuildCache) {
  try {
    if (!repositoryId || !pr || !pr.pullRequestId) {
      return adoClient.summarizeStatusSnapshot(pr, [], isMergeCodeTarget ? null : undefined);
    }
    const result = await adoClient.getPullRequestStatuses(repositoryId, pr.pullRequestId);
    const statuses = result.ok && result.body && Array.isArray(result.body.value)
      ? result.body.value
      : [];
    const policyResult = await adoClient.getPolicyEvaluations(pr.pullRequestId);
    if (!policyResult.ok && context && context.log && context.log.warn) {
      context.log.warn('Policy evaluation lookup returned HTTP ' + policyResult.status + ' for #' + pr.pullRequestId);
    }
    const policyEvaluations = policyResult.ok && policyResult.body && Array.isArray(policyResult.body.value)
      ? policyResult.body.value
      : [];
    let buildRuns = [];
    if (!statuses.some(adoClient.isBuildStatus)) {
      const buildsResult = await getCachedBuildsForBranch(branchBuildCache, adoClient, repositoryId, pr.targetRefName);
      if (!buildsResult.ok && context && context.log && context.log.warn) {
        context.log.warn('Branch build lookup returned HTTP ' + buildsResult.status + ' for #' + pr.pullRequestId);
      }
      buildRuns = buildsResult.ok && buildsResult.body && Array.isArray(buildsResult.body.value)
        ? buildsResult.body.value
        : [];
    }
    return adoClient.summarizeStatusSnapshot(pr, statuses, isMergeCodeTarget ? null : undefined, policyEvaluations, buildRuns);
  } catch (e) {
    if (context && context.log && context.log.warn) {
      context.log.warn('Failed to get PR status snapshot for #' + (pr && pr.pullRequestId) + ': ' + e.message);
    }
    return adoClient.summarizeStatusSnapshot(pr, [], isMergeCodeTarget ? null : undefined);
  }
}

async function getCachedBuildsForBranch(cache, adoClient, repositoryId, branchName) {
  const key = String(repositoryId || '') + '|' + String(branchName || '').toLowerCase();
  const requestCache = cache || {};
  if (requestCache[key]) return requestCache[key];
  const result = await adoClient.getBuildsForBranch(repositoryId, branchName, 20);
  requestCache[key] = result;
  return result;
}

async function buildPrRow(context, pr, currentUser, org, project, branchBuildCache, releaseLookupCache, reviewerGroup, skipRelease = false) {
  const reviewers = Array.isArray(pr.reviewers) ? pr.reviewers : [];
  const repositoryId = pr.repository && pr.repository.id;
  const isMergeCodeTarget = isMergeCodeBranch(pr.targetRefName);
  const approval = buildApprovalSummary(reviewers);
  const myApproval = buildMyApprovalSummary(reviewers, currentUser, approval, isMergeCodeTarget);
  const statusSnapshot = await getStatusSnapshot(context, ado, pr, repositoryId, isMergeCodeTarget, branchBuildCache);
  const releaseApproval = skipRelease
    ? { status: 'skipped', label: 'Release skipped' }
    : await getReleaseApprovalSnapshot(context, pr, statusSnapshot, releaseLookupCache, reviewerGroup);
  const attention = attentionUtil.buildAttention(pr, approval, statusSnapshot, isMergeCodeTarget);
  return {
    id: pr.pullRequestId,
    title: pr.title,
    createdBy: pr.createdBy && pr.createdBy.displayName,
    sourceBranch: pr.sourceRefName,
    targetBranch: pr.targetRefName,
    repository: pr.repository && pr.repository.name,
    repositoryId: repositoryId,
    status: pr.status,
    isDraft: pr.isDraft,
    creationDate: pr.creationDate,
    closedDate: pr.closedDate || pr.completionDate || null,
    mergeStatus: pr.mergeStatus,
    reviewers: reviewers.map(mapReviewer),
    approval: approval,
    myApproval: myApproval,
    statusSnapshot: statusSnapshot,
    releaseApproval: releaseApproval,
    attention: attention,
    policyFetched: false,
    isMergeCodeTarget: isMergeCodeTarget,
    actionMode: isMergeCodeTarget ? 'manual-azure-devops' : 'auto-approve',
    url: pr.repository && pr.repository.project
      ? 'https://dev.azure.com/' + org + '/' + project +
        '/_git/' + pr.repository.name + '/pullrequest/' + pr.pullRequestId
      : null
  };
}

function shouldShowActivePr(row) {
  if (!row) return false;
  if (row.approvalHold && row.approvalHold.active) return true;
  if (row.isMergeCodeTarget) return true;

  const approvalStatus = String(row.approval && row.approval.status || '').toLowerCase();
  if (approvalStatus !== 'complete') return true;

  const releaseStatus = String(row.releaseApproval && row.releaseApproval.status || '').toLowerCase();
  if (releaseStatus === 'pending') return true;

  const snapshot = row.statusSnapshot || {};
  const buildResult = String(snapshot.buildResult || '').toLowerCase();
  const buildStatus = String(snapshot.buildStatus || '').toLowerCase();
  const policyStatus = String(snapshot.policyStatus || '').toLowerCase();
  const mergeStatus = String(snapshot.mergeStatus || row.mergeStatus || '').toLowerCase();

  if (buildResult === 'failed' || buildResult === 'error') return true;
  if (buildResult === 'pending' || buildStatus === 'in_progress') return true;
  if (policyStatus === 'failed' || policyStatus === 'rejected' || policyStatus === 'pending') return true;

  const policyDone = policyStatus === 'approved';
  const mergeReady = mergeStatus === 'succeeded' || mergeStatus === 'completed';

  return !(policyDone || mergeReady);
}

async function attachApprovalHoldStates(context, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return;
  try {
    const states = await approvalHold.getHoldStatesFromRecent(
      list.map(row => row.id),
      Number(process.env.APPROVAL_HOLD_LOOKBACK_DAYS) || 180,
      Number(process.env.APPROVAL_HOLD_LOG_LOOKUP_LIMIT) || 1000
    );
    for (const row of list) {
      row.approvalHold = states[row.id] || { active: false };
    }
  } catch (e) {
    if (context && context.log && context.log.warn) {
      context.log.warn('Approval Hold lookup skipped: ' + e.message);
    }
    for (const row of list) {
      row.approvalHold = { active: false, error: e.message };
    }
  }
}

async function getReleaseApprovalSnapshot(context, pr, statusSnapshot, releaseLookupCache, reviewerGroup) {
  const snapshot = statusSnapshot || {};
  const buildId = getBuildIdFromSnapshot(snapshot);
  const expected = getExpectedReleaseMapping(pr);
  if (!buildId) {
    if (expected && expected.cdName) {
      return {
        status: 'expected',
        label: 'Release expected',
        ciName: expected.ciName || '',
        cdName: expected.cdName || '',
        source: expected.source || 'mapping',
        confidence: expected.confidence || 'possible'
      };
    }
    return { status: 'not_found', label: 'No release yet' };
  }

  const cache = releaseLookupCache || {};
  if (!cache[buildId]) {
    cache[buildId] = ado.getLatestReleaseApprovalForBuild(buildId, reviewerGroup)
      .catch(e => {
        if (context && context.log && context.log.warn) {
          context.log.warn('Release lookup failed for build ' + buildId + ': ' + e.message);
        }
        return { status: 'lookup_failed', label: 'Release lookup failed', detail: e.message };
      });
  }
  const actual = await cache[buildId];
  if (actual && actual.status && actual.status !== 'not_found') {
    return Object.assign({}, actual, {
      buildId: buildId,
      expectedCiName: expected && expected.ciName || '',
      expectedCdName: expected && expected.cdName || ''
    });
  }

  if (expected && expected.cdName) {
    return {
      status: 'expected',
      label: 'Release expected',
      buildId: buildId,
      ciName: expected.ciName || '',
      cdName: expected.cdName || '',
      source: expected.source || 'mapping',
      confidence: expected.confidence || 'possible',
      detail: actual && actual.detail || ''
    };
  }
  return Object.assign({ buildId: buildId }, actual || { status: 'not_found', label: 'No release yet' });
}

async function buildVirtualReleaseRow(context, approval, pat, org, project) {
  const releaseId = approval.release.id;
  const releaseName = approval.release.name;
  const definitionName = approval.releaseDefinition.name;
  const envName = approval.releaseEnvironment.name;
  const envId = approval.releaseEnvironment.id;
  const approvalId = approval.id;

  let buildId = null;
  let branchName = null;
  let repoName = null;
  let repoId = null;
  let createdBy = 'System';

  try {
    const relResult = await callAdoApi('vsrm.dev.azure.com', `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/release/releases/${releaseId}?api-version=7.1`, pat);
    if (relResult.ok && relResult.body) {
      const rel = JSON.parse(relResult.body);
      createdBy = rel.createdBy && rel.createdBy.displayName || createdBy;
      if (Array.isArray(rel.artifacts) && rel.artifacts.length > 0) {
        const art = rel.artifacts[0];
        const ref = art.definitionReference;
        if (ref) {
          buildId = ref.version && ref.version.id || null;
          branchName = ref.branch && ref.branch.name || null;
          repoName = ref.repository && ref.repository.name || null;
          repoId = ref.repository && ref.repository.id || null;
        }
      }
    }
  } catch (e) {
    context.log.warn('Failed to fetch full release details for R' + releaseId + ': ' + e.message);
  }

  let prId = null;
  let prTitle = null;
  let prCreator = null;
  let prUrl = null;

  if (buildId) {
    try {
      const buildResult = await callAdoApi('dev.azure.com', `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/build/builds/${buildId}?api-version=6.0`, pat);
      if (buildResult.ok && buildResult.body) {
        const build = JSON.parse(buildResult.body);
        if (build.triggerInfo && build.triggerInfo['pr.number']) {
          prId = build.triggerInfo['pr.number'];
        }
      }
    } catch (e) {
      context.log.warn('Failed to fetch build details for ' + buildId + ': ' + e.message);
    }
  }

  let prFetched = false;
  if (prId) {
    try {
      const prResult = await callAdoApi('dev.azure.com', `/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/pullrequests/${prId}?api-version=7.0`, pat);
      if (prResult.ok && prResult.body) {
        const pr = JSON.parse(prResult.body);
        prTitle = pr.title;
        prCreator = pr.createdBy && pr.createdBy.displayName;
        repoName = pr.repository && pr.repository.name || repoName;
        repoId = pr.repository && pr.repository.id || repoId;
        branchName = pr.targetRefName || branchName;
        prUrl = 'https://dev.azure.com/' + org + '/' + project + '/_git/' + repoName + '/pullrequest/' + prId;
        prFetched = true;
      }
    } catch (e) {
      context.log.warn('Failed to fetch pull request ' + prId + ': ' + e.message);
    }
  }

  const rowId = prId ? parseInt(prId, 10) : 'R' + releaseId;
  const title = prTitle || releaseName;
  const creator = prCreator || createdBy;
  const releaseUrl = 'https://dev.azure.com/' + org + '/' + project + '/_releaseProgress?_a=release-pipeline-progress&releaseId=' + releaseId;

  const snapshot = {
    buildStatus: 'completed',
    buildResult: 'succeeded',
    policyStatus: 'approved',
    mergeStatus: 'succeeded',
    adoBuildUrl: buildId ? 'https://dev.azure.com/' + org + '/' + project + '/_build/results?buildId=' + buildId : ''
  };

  const releaseApproval = {
    status: 'pending',
    label: 'Release approval pending',
    releaseId: releaseId,
    releaseName: releaseName,
    releaseDefinitionId: approval.releaseDefinition.id,
    releaseDefinitionName: definitionName,
    cdName: definitionName,
    environmentId: envId,
    environmentName: envName,
    approvalId: approvalId,
    approver: approval.approver && approval.approver.displayName || '',
    releaseUrl: releaseUrl
  };

  return {
    id: rowId,
    title: title,
    createdBy: creator,
    sourceBranch: null,
    targetBranch: branchName || 'refs/heads/staging',
    repository: repoName || '-',
    repositoryId: repoId || '',
    status: prFetched ? 'completed' : 'active',
    isDraft: false,
    creationDate: approval.createdOn,
    closedDate: approval.createdOn,
    mergeStatus: 'succeeded',
    reviewers: [],
    approval: { status: 'complete', approvedCount: 0, requiredCount: 0 },
    myApproval: { status: 'not-reviewer', label: '—' },
    statusSnapshot: snapshot,
    releaseApproval: releaseApproval,
    attention: { status: 'normal', label: 'Release Pending' },
    policyFetched: false,
    isMergeCodeTarget: false,
    actionMode: 'auto-approve',
    url: prUrl || releaseUrl
  };
}

function getBuildIdFromSnapshot(snapshot) {
  if (snapshot && snapshot.buildRunId) return String(snapshot.buildRunId);
  const url = String(snapshot && snapshot.adoBuildUrl || '');
  const match = url.match(/[?&]buildId=(\d+)/i) || url.match(/\/build\/results\?buildId=(\d+)/i);
  return match ? match[1] : '';
}

function getExpectedReleaseMapping(pr) {
  const direct = mergePipelineMap.findMergePipelineRule(pr);
  if (direct && direct.cd && direct.cd.name) {
    return {
      ciName: direct.ci && direct.ci.name || '',
      cdName: direct.cd && direct.cd.name || '',
      source: 'branch-rule',
      confidence: direct.confidence || 'high'
    };
  }
  const possible = mergePipelineMap.findPossibleStagingPipelineMapping(pr);
  if (!possible) return null;
  return {
    ciName: possible.ciName || '',
    cdName: possible.cdName || '',
    ciId: possible.ciId || '',
    cdId: possible.cdId || '',
    source: possible.source || 'staging-csv',
    confidence: possible.confidence || 'possible'
  };
}

function getCurrentUser(encodedPrincipal) {
  const user = {
    userDetails: '',
    userId: '',
    identities: []
  };
  try {
    const principal = JSON.parse(Buffer.from(encodedPrincipal, 'base64').toString('utf-8'));
    user.userDetails = principal.userDetails || '';
    user.userId = principal.userId || '';
    user.roles = Array.isArray(principal.userRoles) ? principal.userRoles : [];
    user.identities = collectPrincipalIdentities(principal);
  } catch (e) {}
  return user;
}

function collectPrincipalIdentities(principal) {
  const values = [
    principal.userDetails,
    principal.userId
  ];
  const claims = Array.isArray(principal.claims) ? principal.claims : [];
  for (const claim of claims) {
    if (!claim) continue;
    const typ = String(claim.typ || claim.type || '').toLowerCase();
    if (typ.includes('email') ||
        typ.includes('upn') ||
        typ.includes('nameidentifier') ||
        typ.endsWith('/name')) {
      values.push(claim.val || claim.value);
    }
  }
  return values.map(normalizeIdentity).filter(Boolean);
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

function buildMyApprovalSummary(reviewers, currentUser, approval, isMergeCodeTarget) {
  if (isMergeCodeTarget) {
    return {
      status: 'manual',
      label: 'Manual in ADO',
      detail: 'Open Azure DevOps',
      vote: null,
      matched: false,
      waitingOthers: Math.max((approval.requiredCount || 0) - (approval.approvedCount || 0), 0)
    };
  }

  const myReviewer = findCurrentUserReviewer(reviewers, currentUser);
  const vote = myReviewer ? Number(myReviewer.vote) || 0 : 0;
  const waitingOthers = Math.max((approval.requiredCount || 0) - (approval.approvedCount || 0), 0);
  const canApproveAsGroup = hasApprovalRole(currentUser);

  if (vote >= 10) {
    return {
      status: 'approved',
      label: 'You approved',
      detail: waitingOthers > 0 ? 'Waiting others: ' + waitingOthers : 'All required approved',
      vote: vote,
      matched: true,
      waitingOthers: waitingOthers
    };
  }
  if (vote === 5) {
    return {
      status: 'suggestions',
      label: 'Approved with suggestions',
      detail: waitingOthers > 0 ? 'Waiting others: ' + waitingOthers : 'All required approved',
      vote: vote,
      matched: true,
      waitingOthers: waitingOthers
    };
  }
  if (vote <= -10) {
    return {
      status: 'rejected',
      label: 'You rejected',
      detail: 'Review needed',
      vote: vote,
      matched: true,
      waitingOthers: waitingOthers
    };
  }
  if (vote === -5) {
    return {
      status: 'waiting-author',
      label: 'Waiting for author',
      detail: 'You requested changes',
      vote: vote,
      matched: true,
      waitingOthers: waitingOthers
    };
  }

  return {
    status: myReviewer || canApproveAsGroup ? 'not-approved' : 'not-reviewer',
    label: myReviewer || canApproveAsGroup ? 'Awaiting your approval' : 'Awaiting group approval',
    detail: 'Waiting: ' + (approval.approvedCount || 0) + '/' + (approval.requiredCount || 0),
    vote: vote,
    matched: !!myReviewer,
    waitingOthers: waitingOthers
  };
}

function hasApprovalRole(currentUser) {
  const roles = currentUser && Array.isArray(currentUser.roles) ? currentUser.roles : [];
  return roles.some(role => String(role || '').toLowerCase() === 'it_support_approve');
}

function findCurrentUserReviewer(reviewers, currentUser) {
  const identities = currentUser && Array.isArray(currentUser.identities)
    ? currentUser.identities
    : [];
  if (identities.length === 0) return null;
  return reviewers.find(reviewer => {
    if (!reviewer || reviewer.isContainer === true) return false;
    const reviewerValues = [
      reviewer.uniqueName,
      reviewer.displayName,
      reviewer.id
    ].map(normalizeIdentity).filter(Boolean);
    return reviewerValues.some(value => identities.includes(value));
  }) || null;
}

function normalizeIdentity(value) {
  return String(value || '').trim().toLowerCase();
}

function buildApprovalSummary(reviewers) {
  const people = reviewers.filter(r => r && r.isContainer !== true);
  const required = reviewers.filter(r => r && r.isRequired === true);
  const rejectedCount = people.filter(r => Number(r.vote) <= -10).length;
  const hasRequiredReviewers = required.length > 0;
  const reviewersToCount = hasRequiredReviewers ? required : people;
  const approvedReviewers = reviewersToCount.filter(r => Number(r.vote) >= 10);
  const rejectedRequiredReviewers = required.filter(r => Number(r.vote) <= -10);
  const pendingRequiredReviewers = required.filter(r => {
    const vote = Number(r.vote) || 0;
    return vote < 10 && vote > -10;
  });
  const approvedCount = approvedReviewers.length;
  const requiredApprovedCount = required.filter(r => Number(r.vote) >= 10).length;
  const requiredCount = reviewersToCount.length;

  let status = 'pending';
  if (rejectedCount > 0 || rejectedRequiredReviewers.length > 0) {
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
    requiredApprovedNames: required
      .filter(r => Number(r.vote) >= 10)
      .map(r => r.displayName || r.uniqueName || r.id || 'Unknown'),
    requiredPendingNames: pendingRequiredReviewers.map(r => r.displayName || r.uniqueName || r.id || 'Unknown'),
    requiredRejectedNames: rejectedRequiredReviewers.map(r => r.displayName || r.uniqueName || r.id || 'Unknown'),
    minApproversFromPolicy: 0,
    rejectedCount: rejectedCount
  };
}
