const sharePoint = require('../shared/operations-sharepoint-client');
const service = require('../shared/operations-service');

const DISCOVERY_LIMIT = 5000;

module.exports = async function (context, req) {
  if (!authorized(req)) return respond(context, 401, { ok: false, error: 'Unauthorized' });
  if (!service.featureEnabled('OPERATIONS_CLOSE_ENABLED')) {
    return respond(context, 503, { ok: false, error: 'FEATURE_DISABLED' });
  }

  const body = req.body || {};
  const dryRun = body.dryRun === true;
  const maxItems = Math.max(1, Math.min(Number(body.maxItems) || 100, 250));
  try {
    const incidents = (await sharePoint.listIncidentRecords(DISCOVERY_LIMIT))
      .filter(item => String(item.operationsStatus || '').toUpperCase() !== 'CLOSED')
      .filter(item => String(item.status || '').toUpperCase() === 'RESOLVED')
      .filter(item => item.workItemSummary && item.workItemSummary.total > 0)
      .slice(0, maxItems);
    if (dryRun) {
      return respond(context, 200, { ok: true, dryRun: true, scanned: incidents.length,
        eligible: incidents.length,
        candidates: incidents.map(item => ({ incidentId: item.incidentId, displayId: item.displayId, operationsStatus: item.operationsStatus, status: item.status, workItems: item.workItemSummary })) });
    }
    const results = [];
    for (const incident of incidents) {
      try {
        const result = await service.closeIncident({ incidentId: incident.incidentId }, automationContext(req));
        results.push({ incidentId: incident.incidentId, ok: true, ...result });
      } catch (error) {
        results.push({ incidentId: incident.incidentId, ok: false, error: error.code || error.message });
      }
    }
    return respond(context, results.some(item => !item.ok) ? 207 : 200, {
      ok: results.every(item => item.ok), scanned: incidents.length,
      eligible: incidents.length, closed: results.filter(item => item.ok && item.closed).length,
      failed: results.filter(item => !item.ok).length, results
    });
  } catch (error) {
    context.log.error('Operations auto-close failed:', error);
    return respond(context, 500, { ok: false, error: 'AUTO_CLOSE_FAILED', detail: error.message });
  }
};

function authorized(req) {
  const expected = String(process.env.OPERATIONS_AUTOMATION_KEY || '');
  const actual = String(req.headers && req.headers['x-operations-automation-key'] || '');
  return Boolean(expected && actual && expected === actual);
}

function automationContext(req) {
  return { actor: 'Operations Hub Auto Close', correlationId: String(req.headers?.['x-correlation-id'] || '') };
}

function respond(context, status, body) {
  context.res = { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
