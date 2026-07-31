const store = require('../shared/deployment-store');
const http = require('../shared/deployment-http');

module.exports = async function (context, req) {
  const access = http.authorize(context, req, false);
  if (!access.ok) return http.json(context, access.status, access.body);
  try {
    const deployments = await store.listDeployments({ top: 1000 });
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const counts = {
      total: deployments.length,
      planned: 0,
      inProgress: 0,
      completed: 0,
      cancelled: 0,
      issue: 0,
      rolledBack: 0,
      webService: 0,
      mobile: 0,
      today: 0
    };
    deployments.forEach(item => {
      if (item.lifecycleStatus === 'Planned') counts.planned++;
      if (item.lifecycleStatus === 'In Progress') counts.inProgress++;
      if (item.lifecycleStatus === 'Completed') counts.completed++;
      if (item.lifecycleStatus === 'Cancelled') counts.cancelled++;
      if (/Issue/.test(item.deployResult || '')) counts.issue++;
      if (/Rolled Back/.test(item.deployResult || '')) counts.rolledBack++;
      if (item.category === 'mobile') counts.mobile++; else counts.webService++;
      if (String(item.plannedDeployAt || '').slice(0, 10) === today) counts.today++;
    });
    http.json(context, 200, {
      ok: true,
      counts,
      upcoming: deployments.filter(item => item.lifecycleStatus === 'Planned').slice(0, 8),
      recent: deployments.slice(0, 8)
    });
  } catch (error) {
    http.fail(context, error);
  }
};
