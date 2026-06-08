/**
 * GET /api/logs
 *
 * คืน SharePoint audit log ล่าสุด หรือ log ของ PR ID ที่ระบุ
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

    const query = req.query || {};
    const prId = parseInt(query.prId, 10);
    const top = Math.max(1, Math.min(parseInt(query.top, 10) || 100, 100));
    const action = normalizeFilter(query.action);
    const source = normalizeFilter(query.source);
    const q = normalizeFilter(query.q);

    let sp;
    try { sp = require('../shared/sharepoint-client'); }
    catch (e) {
      jsonResponse(500, { ok: false, error: 'Failed to load sharepoint-client', detail: e.message });
      return;
    }

    let result;
    try {
      result = Number.isFinite(prId) && prId > 0
        ? await sp.getLogForPR(prId)
        : await sp.getRecentLogItems(top);
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

    const allItems = (result.body.value || []).map(normalizeLogItem);
    const items = allItems.filter(item => {
      if (action && !matchesAction(item, action)) return false;
      if (source && !String(item.source || '').toLowerCase().includes(source)) return false;
      if (q && !matchesKeyword(item, q)) return false;
      return true;
    }).sort(sortLogNewestFirst);

    jsonResponse(200, {
      ok: true,
      count: items.length,
      totalFetched: allItems.length,
      top: top,
      prId: Number.isFinite(prId) && prId > 0 ? prId : null,
      fetchedAt: new Date().toISOString(),
      stats: buildStats(items),
      items: items
    });
  } catch (err) {
    context.log.error('Unexpected error:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};

function normalizeLogItem(item) {
  const fields = item && item.fields || {};
  const buildText = [fields.Build_Status, fields.Build_Result].filter(Boolean).join(' / ');
  const prId = fields.PR_ID || 0;
  const repository = fields.Repository || '';
  return {
    id: item.id,
    createdAt: item.createdDateTime,
    lastModifiedAt: item.lastModifiedDateTime,
    prId: prId,
    action: fields.Action || '',
    user: fields.User || '',
    repository: repository,
    prTitle: fields.PR_Title || '',
    targetBranch: fields.Target_Branch || '',
    result: fields.Result || '',
    reason: fields.Reason || '',
    source: fields.Log_Source || fields.Source || 'Dashboard',
    eventKey: fields.Event_Key || '',
    build: buildText,
    buildStatus: fields.Build_Status || '',
    buildResult: fields.Build_Result || '',
    policyStatus: fields.Policy_Status || '',
    mergeStatus: fields.Merge_Status || '',
    autoCompleteStatus: fields.AutoComplete_Status || '',
    lastCheckedAt: fields.Last_Checked_At || '',
    adoBuildUrl: fields.ADO_Build_URL || '',
    adoPrUrl: fields.ADO_PR_URL || buildAdoPrUrl(repository, prId)
  };
}

function sortLogNewestFirst(a, b) {
  const timeB = Date.parse(b && b.createdAt);
  const timeA = Date.parse(a && a.createdAt);
  if (Number.isFinite(timeB) && Number.isFinite(timeA) && timeB !== timeA) {
    return timeB - timeA;
  }
  const modifiedB = Date.parse(b && b.lastModifiedAt);
  const modifiedA = Date.parse(a && a.lastModifiedAt);
  if (Number.isFinite(modifiedB) && Number.isFinite(modifiedA) && modifiedB !== modifiedA) {
    return modifiedB - modifiedA;
  }
  return (parseInt(b && b.id, 10) || 0) - (parseInt(a && a.id, 10) || 0);
}

function buildAdoPrUrl(repository, prId) {
  const org = process.env.ADO_ORGANIZATION;
  const project = process.env.ADO_PROJECT;
  const id = parseInt(prId, 10);
  if (!org || !project || !repository || !Number.isFinite(id) || id <= 0) return '';
  return 'https://dev.azure.com/' + org + '/' + project +
    '/_git/' + encodeURIComponent(repository) + '/pullrequest/' + id;
}

function buildStats(items) {
  const rows = Array.isArray(items) ? items : [];
  return {
    total: rows.length,
    approved: rows.filter(item => String(item.action || '').toLowerCase().includes('approved')).length,
    rejected: rows.filter(item => String(item.action || '').toLowerCase().includes('rejected')).length,
    notifications: rows.filter(item => String(item.action || '').toLowerCase().includes('notification')).length,
    failed: rows.filter(item => {
      const text = [
        item.action,
        item.result,
        item.reason,
        item.buildResult,
        item.policyStatus
      ].join(' ').toLowerCase();
      return text.includes('fail') || text.includes('error');
    }).length
  };
}

function normalizeFilter(value) {
  const text = String(value || '').trim().toLowerCase();
  return text === 'all' ? '' : text;
}

function matchesAction(item, action) {
  const text = [
    item.action,
    item.result,
    item.reason,
    item.source,
    item.buildResult,
    item.policyStatus
  ].join(' ').toLowerCase();
  if (action === 'failed') return text.includes('fail') || text.includes('error');
  if (action === 'build-failed') {
    const buildText = [item.buildResult, item.buildStatus, item.build, item.result, item.reason].join(' ').toLowerCase();
    return buildText.includes('failed') || buildText.includes('error');
  }
  if (action === 'policy-pending') {
    return String(item.policyStatus || '').toLowerCase() === 'pending' ||
      text.includes('policy pending') ||
      text.includes('policy: pending');
  }
  if (action === 'dashboard-approved') {
    return String(item.action || '').toLowerCase() === 'approved' &&
      String(item.source || '').toLowerCase().includes('dashboard');
  }
  if (action === 'external-approved') {
    return String(item.action || '').toLowerCase().includes('external approved') ||
      String(item.source || '').toLowerCase().includes('azure devops sync');
  }
  return String(item.action || '').toLowerCase().includes(action);
}

function matchesKeyword(item, keyword) {
  const haystack = [
    item.prId,
    item.action,
    item.user,
    item.repository,
    item.prTitle,
    item.targetBranch,
    item.result,
    item.reason,
    item.source,
    item.eventKey,
    item.build,
    item.policyStatus,
    item.mergeStatus
  ].join(' ').toLowerCase();
  return haystack.includes(keyword);
}
