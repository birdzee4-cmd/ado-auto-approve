const store = require('../shared/ado-deployment-event-store');

module.exports = async function (context, req) {
  try {
    const items = await store.list({
      projectId: req.query && req.query.projectId,
      limit: req.query && req.query.limit
    });
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: { ok: true, count: items.length, items }
    };
  } catch (error) {
    context.log.error('ado-deployment-status failed:', error.message);
    context.res = { status: 503, body: { ok: false, error: 'Deployment status storage is unavailable.' } };
  }
};

