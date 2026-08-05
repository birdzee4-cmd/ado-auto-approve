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
        let allDeployments = await store.listAllDeployments({ project: query.project });
        if (query.excludeId) allDeployments = allDeployments.filter(item => item.id !== query.excludeId);
        allDeployments.sort((a, b) => String(b.plannedDeployAt).localeCompare(String(a.plannedDeployAt)) ||
          String(b.jobNo).localeCompare(String(a.jobNo)));
        const deployTypes = [...new Set(allDeployments.map(item => item.deployType).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b));
        const deployments = query.deployType
          ? allDeployments.filter(item => item.deployType === query.deployType)
          : allDeployments;
        const pageSize = 10;
        const requestedPage = Math.max(1, Number.parseInt(query.page, 10) || 1);
        const totalPages = Math.max(1, Math.ceil(deployments.length / pageSize));
        const currentPage = Math.min(requestedPage, totalPages);
        const pageStart = (currentPage - 1) * pageSize;
        const completedCount = allDeployments.filter(item => item.lifecycleStatus === 'Completed').length;
        const inProgressCount = allDeployments.filter(item => item.lifecycleStatus === 'In Progress').length;
        return http.json(context, 200, {
          ok: true,
          count: deployments.length,
          totalCount: allDeployments.length,
          deployTypes,
          currentPage,
          pageSize,
          totalPages,
          completedCount,
          inProgressCount,
          latestDeployAt: allDeployments.length ? allDeployments[0].plannedDeployAt : null,
          deployments: deployments.slice(pageStart, pageStart + pageSize)
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
