const store = require('../shared/deployment-store');
const http = require('../shared/deployment-http');

module.exports = async function (context, req) {
  const access = http.authorize(context, req, false);
  if (!access.ok) return http.json(context, access.status, access.body);
  try {
    const items = await store.listAudit(context.bindingData.id, req.query && req.query.top);
    http.json(context, 200, { ok: true, count: items.length, audit: items });
  } catch (error) {
    http.fail(context, error);
  }
};
