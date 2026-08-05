const store = require('../shared/deployment-store');
const http = require('../shared/deployment-http');

module.exports = async function (context, req) {
  const access = http.authorize(context, req, false);
  if (!access.ok) return http.json(context, access.status, access.body);
  try {
    const method = String(req.method || 'GET').toUpperCase();
    const id = context.bindingData && context.bindingData.id;
    if (method === 'GET' && id) {
      const deployment = await store.getDeployment(id);
      return deployment
        ? http.json(context, 200, { ok: true, deployment })
        : http.json(context, 404, { ok: false, error: 'Deployment not found' });
    }
    if (method === 'GET') {
      const query = req.query || {};
      if (String(query.history || '').toLowerCase() === 'true' && query.project) {
        let deployments = await store.listAllDeployments({ project: query.project });
        if (query.excludeId) deployments = deployments.filter(item => item.id !== query.excludeId);
        const completedCount = deployments.filter(item => item.lifecycleStatus === 'Completed').length;
        const inProgressCount = deployments.filter(item => item.lifecycleStatus === 'In Progress').length;
        return http.json(context, 200, {
          ok: true,
          count: deployments.length,
          completedCount,
          inProgressCount,
          latestDeployAt: deployments.length ? deployments[0].plannedDeployAt : null,
          deployments: deployments.slice(0, 5)
        });
      }
      const deployments = await store.listDeployments(query);
      return http.json(context, 200, { ok: true, count: deployments.length, deployments });
    }
    if (method === 'POST') {
      const result = await store.createDeployment(req.body || {}, http.userOf(access));
      return http.json(context, result.status || 200, result);
    }
    if (method === 'PUT' && id) {
      const etag = req.headers['if-match'] || req.headers['If-Match'] || req.body && req.body.etag;
      const result = await store.updateDeployment(id, req.body || {}, http.userOf(access), etag);
      return http.json(context, result.status || 200, result);
    }
    return http.json(context, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    http.fail(context, error);
  }
};
