/**
 * GET /api/pr-history/{prId}
 *
 * คืน log จาก SharePoint สำหรับ PR ID นี้
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

    jsonResponse(200, { ok: true, prId: prId, count: items.length, items: items });

  } catch (err) {
    context.log.error('Unexpected error:', err);
    jsonResponse(500, { ok: false, error: 'Unexpected server error', detail: err.message });
  }
};
