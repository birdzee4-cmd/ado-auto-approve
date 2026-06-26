/**
 * GET /api/pr-history/{prId}
 *
 * คืน log จาก SharePoint สำหรับ PR ID นี้ และเติม reviewer vote สดจาก Azure DevOps
 * เพื่อให้ History สะท้อนจำนวน approve ปัจจุบันแม้ external vote ยังไม่ถูก sync ลง log
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

    const prId = (context.bindingData && context.bindingData.prId) ||
                 (req.params && req.params.prId);
    if (!prId) {
      jsonResponse(400, { ok: false, error: 'Missing prId' });
      return;
    }

    let sp;
    try { sp = require('../shared/sharepoint-client'); }
    catch (e) {
      jsonResponse(500, { ok: false, error: 'Failed to load sharepoint-client', detail: e.message });
      return;
    }

    let result;
    try {
      result = await sp.getLogForPR(prId);
    } catch (e) {
      jsonResponse(500, {
        ok: false,
        error: 'Failed to query SharePoint',
        detail: e.message,
        hint: 'ตรวจ SHAREPOINT_HOSTNAME / SHAREPOINT_SITE_PATH / Graph permission'
      });
      return;
    }

    if (!result.ok) {
      jsonResponse(502, {
        ok: false,
        error: 'SharePoint returned ' + result.status,
        detail: JSON.stringify(result.body).substring(0, 500)
      });
      return;
    }

    const items = (result.body.value || []).map(item => ({
      id: item.id,
      createdAt: item.createdDateTime,
      ...item.fields
    }));

    const liveResult = await getLiveReviewerVoteItems(context, prId, items);
    const mergedItems = items
      .concat(liveResult.items)
      .sort(compareHistoryItems);

    jsonResponse(200, {
      ok: true,
      prId: prId,
      count: mergedItems.length,
      persistedCount: items.length,
      liveVoteCount: liveResult.items.length,
      liveVoteStatus: liveResult.status,
      liveVoteError: liveResult.error || '',
      items: mergedItems
    });

  } catch (err) {
    context.log.error('Unexpected error:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};

async function getLiveReviewerVoteItems(context, prId, existingItems) {
  if (process.env.ADO_HISTORY_LIVE_VOTES === 'false') {
    return { status: 'disabled', items: [] };
  }

  let ado;
  try {
    ado = require('../shared/ado-client');
  } catch (e) {
    return { status: 'skipped', items: [], error: 'Failed to load ado-client: ' + e.message };
  }

  try {
    const prResult = await ado.getPullRequest(prId);
    if (!prResult.ok || !prResult.body) {
      return { status: 'lookup_failed', items: [], error: 'Azure DevOps returned HTTP ' + prResult.status };
    }

    const pr = prResult.body;
    const reviewers = Array.isArray(pr.reviewers) ? pr.reviewers : [];
    const existing = Array.isArray(existingItems) ? existingItems : [];
    const checkedAt = new Date().toISOString();
    const liveItems = reviewers
      .filter(reviewer => reviewer && reviewer.isContainer !== true)
      .map(reviewer => buildLiveVoteItem(pr, reviewer, checkedAt))
      .filter(Boolean)
      .filter(item => !hasExistingVoteLog(existing, item));

    return { status: 'ok', items: liveItems };
  } catch (e) {
    if (context && context.log && context.log.warn) {
      context.log.warn('Live reviewer vote lookup failed for PR #' + prId + ': ' + e.message);
    }
    return { status: 'lookup_failed', items: [], error: e.message };
  }
}

function buildLiveVoteItem(pr, reviewer, checkedAt) {
  const vote = Number(reviewer.vote) || 0;
  const state = getVoteState(vote);
  if (!state) return null;

  const user = reviewer.uniqueName || reviewer.displayName || reviewer.id || 'Unknown';
  const reviewerKey = normalizeIdentity(reviewer.id || reviewer.uniqueName || reviewer.displayName || 'unknown');
  return {
    id: 'ado-live-vote:' + pr.pullRequestId + ':' + reviewerKey + ':' + vote,
    createdAt: checkedAt,
    Title: state.action + ' PR #' + pr.pullRequestId,
    PR_ID: pr.pullRequestId,
    Action: state.action,
    User: user,
    Repository: pr.repository && pr.repository.name || '',
    PR_Title: pr.title || '',
    Target_Branch: pr.targetRefName || '',
    Result: state.result,
    Reason: 'Current Azure DevOps reviewer vote snapshot; not yet persisted in SharePoint log',
    Log_Source: 'Azure DevOps Live',
    Event_Key: 'ado-live:vote:' + pr.pullRequestId + ':' + reviewerKey + ':' + vote,
    ADO_PR_URL: buildPrUrl(pr),
    isLiveVote: true,
    reviewerKey: reviewerKey,
    vote: vote
  };
}

function getVoteState(vote) {
  if (vote >= 10) return { action: 'External Approved', result: 'Approved in Azure DevOps' };
  if (vote === 5) return { action: 'External Approved with Suggestions', result: 'Approved with suggestions in Azure DevOps' };
  if (vote <= -10) return { action: 'External Rejected', result: 'Rejected in Azure DevOps' };
  if (vote === -5) return { action: 'External Waiting Author', result: 'Waiting for author in Azure DevOps' };
  return null;
}

function hasExistingVoteLog(existingItems, liveItem) {
  const liveAction = String(liveItem.Action || '').toLowerCase();
  const liveUser = normalizeIdentity(liveItem.User);
  return existingItems.some(item => {
    if (!item) return false;
    if (item.Event_Key && item.Event_Key === liveItem.Event_Key) return true;

    const action = String(item.Action || '').toLowerCase();
    const user = normalizeIdentity(item.User);
    const sameAction =
      action === liveAction ||
      (liveAction === 'external approved' && (action === 'approved' || action === 'auto approved')) ||
      (liveAction === 'external rejected' && action === 'rejected');
    return sameAction && user && liveUser && user === liveUser;
  });
}

function buildPrUrl(pr) {
  const org = process.env.ADO_ORGANIZATION || '';
  const project = process.env.ADO_PROJECT || '';
  const repoName = pr && pr.repository && pr.repository.name || '';
  if (!org || !project || !repoName || !pr || !pr.pullRequestId) return '';
  return 'https://dev.azure.com/' + encodeURIComponent(org) + '/' + encodeURIComponent(project) +
    '/_git/' + encodeURIComponent(repoName) + '/pullrequest/' + encodeURIComponent(String(pr.pullRequestId));
}

function normalizeIdentity(value) {
  return String(value || '').trim().toLowerCase();
}

function compareHistoryItems(a, b) {
  const timeB = Date.parse(b && (b.createdAt || b.Last_Checked_At));
  const timeA = Date.parse(a && (a.createdAt || a.Last_Checked_At));
  if (Number.isFinite(timeB) && Number.isFinite(timeA) && timeB !== timeA) return timeB - timeA;
  if (Number.isFinite(timeB) && !Number.isFinite(timeA)) return 1;
  if (!Number.isFinite(timeB) && Number.isFinite(timeA)) return -1;
  return 0;
}
