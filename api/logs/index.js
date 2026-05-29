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
    });

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
  return {
    id: item.id,
    createdAt: item.createdDateTime,
    prId: fields.PR_ID || 0,
    action: fields.Action || '',
    user: fields.User || '',
    repository: fields.Repository || '',
    prTitle: fields.PR_Title || '',
    targetBranch: fields.Target_Branch || '',
    result: fields.Result || '',
    reason: fields.Reason || '',
    source: fields.Source || 'Dashboard',
    eventKey: fields.Event_Key || '',
    build: buildText,
    buildStatus: fields.Build_Status || '',
    buildResult: fields.Build_Result || '',
    policyStatus: fields.Policy_Status || '',
    mergeStatus: fields.Merge_Status || '',
    autoCompleteStatus: fields.AutoComplete_Status || '',
    lastCheckedAt: fields.Last_Checked_At || '',
    adoBuildUrl: fields.ADO_Build_URL || '',
    adoPrUrl: fields.ADO_PR_URL || ''
  };
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
  if (action === 'external') return text.includes('external') || text.includes('azure devops sync');
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
