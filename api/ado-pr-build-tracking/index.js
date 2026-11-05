const auth = require('../shared/auth');
const store = require('../shared/ado-deployment-event-store');
const { buildTracking } = require('../shared/pr-build-tracking');
const mappings = require('../shared/pr-build-project-map.json');

module.exports = async function (context, req) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' };
  const authorized = auth.requireAnyRole(context, req, ['it_support_approve', 'admin']);
  if (!authorized.ok) { context.res = { status: authorized.status, headers, body: authorized.body }; return; }
  const query = req.query || {};
  const mapping = query.liveProject && mappings.find(item => item.key === query.liveProject);
  if (query.liveProject && !mapping) { context.res = { status: 400, headers, body: { ok: false, error: 'Unknown project.' } }; return; }
  if (['from', 'to'].some(field => query[field] && (!/^\d{4}-\d{2}-\d{2}T/.test(query[field]) || !Number.isFinite(Date.parse(query[field])))) ||
    (query.from && query.to && Date.parse(query.from) >= Date.parse(query.to)) ||
    (query.environmentGroup && !['Staging', 'Production', 'Development', 'Other'].includes(query.environmentGroup))) {
    context.res = { status: 400, headers, body: { ok: false, error: 'Invalid date range or environment.' } }; return;
  }
  try {
    if (mapping) {
      const delegated = require('../shared/ado-user-token');
      const token = await delegated.getValidAccessToken(req, authorized.principal, { allowStoreRecovery: true });
      if (!token.ok) { context.res = { status: 428, headers, body: { ok: false, error: 'กรุณาเชื่อมต่อ Azure DevOps ด้วยบัญชีของคุณก่อนดึงประวัติ' } }; return; }
      if (token.setCookie) headers['Set-Cookie'] = token.setCookie;
      const history = await require('../shared/pr-build-live').loadProjectHistory(mapping, token.accessToken, require('../shared/ado-client'));
      context.res = { status: 200, headers, body: { ok: true, tracking: buildTracking(history.items, { mappings: [mapping] }),
        history: { source: 'azure-devops', project: mapping.key, buildCount: history.buildCount, releaseCount: history.releaseCount, limited: history.limited } } };
      return;
    }
    // Do not filter by result: successful events are required to evaluate recovery.
    const items = await store.listAll({ from: req.query && req.query.from, to: req.query && req.query.to,
      environmentGroup: req.query && req.query.environmentGroup });
    context.res = { status: 200, headers,
      body: { ok: true, tracking: buildTracking(items) } };
  } catch (error) {
    context.log.error('ado-pr-build-tracking failed:', error.message);
    context.res = { status: mapping ? 502 : 503, headers, body: { ok: false, error: mapping ? 'ดึงประวัติ Azure DevOps ไม่สำเร็จ' : 'PR / CI-CD tracking is unavailable.', ...(mapping && error.status ? { adoStatus: error.status } : {}) } };
  }
};
