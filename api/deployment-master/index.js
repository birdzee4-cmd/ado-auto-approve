const store = require('../shared/deployment-store');
const http = require('../shared/deployment-http');

module.exports = async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  const access = http.authorize(context, req, method !== 'GET');
  if (!access.ok) return http.json(context, access.status, access.body);
  try {
    if (method === 'GET') {
      const items = await store.listMaster(req.query && req.query.includeInactive === 'true');
      return http.json(context, 200, { ok: true, count: items.length, master: items });
    }
    const item = await store.saveMaster(req.body || {}, http.userOf(access));
    http.json(context, 200, { ok: true, item });
  } catch (error) {
    http.fail(context, error);
  }
};
