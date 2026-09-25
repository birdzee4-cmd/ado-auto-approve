const crypto = require('crypto');
const sharePoint = require('../shared/operations-sharepoint-client');
const service = require('../shared/operations-service');

module.exports = async function (context, req) {
  try {
    if (!authorized(req)) return respond(context, 401, { ok: false, error: 'Unauthorized' });
    const dryRun = Boolean(req.body && req.body.dryRun === true);
    if (!dryRun && !service.featureEnabled('OPERATIONS_RECONCILIATION_ENABLED')) {
      return respond(context, 503, { ok: false, error: 'FEATURE_DISABLED' });
    }
    const maximum = Math.max(1, Math.min(Number(req.body && req.body.maxItems) || 100, 250));
    const incidents = (await sharePoint.listIncidents(1000))
      .filter(item => item.operationsStatus !== 'CLOSED' && item.workItemSummary && item.workItemSummary.total > 0)
      .slice(0, maximum);
    if (dryRun) {
      return respond(context, 200, {
        ok: true,
        dryRun: true,
        processed: incidents.length,
        writeOperations: 0,
        candidates: incidents.map(dryRunCandidate)
      });
    }
    const results = [];
    for (const incident of incidents) {
      try {
        const actionContext = automationContext(req);
        const result = await service.synchronize({ incidentId: incident.incidentId }, actionContext);
        const failed = result.items.filter(item => !item.ok).length;
        const refreshed = await sharePoint.getIncident(incident.incidentId);
        const notification = await notifyIfNeeded(refreshed, failed, actionContext);
        results.push({ incidentId: incident.incidentId, ok: failed === 0, synchronized: result.items.length, failed, notification });
      } catch (err) {
        context.log.warn(`Operations reconciliation failed for ${incident.incidentId}: ${err.message}`);
        results.push({ incidentId: incident.incidentId, ok: false, error: err.code || err.message });
      }
    }
    return respond(context, results.some(item => !item.ok) ? 207 : 200, {
      ok: results.every(item => item.ok),
      processed: results.length,
      succeeded: results.filter(item => item.ok).length,
      failed: results.filter(item => !item.ok).length,
      results
    });
  } catch (err) {
    context.log.error('Operations reconciliation failed:', err);
    return respond(context, 500, { ok: false, error: 'RECONCILIATION_FAILED', detail: err.message });
  }
};

function dryRunCandidate(incident) {
  const summary = incident.workItemSummary || {};
  return {
    incidentId: incident.incidentId,
    displayId: incident.displayId,
    operationsStatus: incident.operationsStatus || '',
    workItems: Number(summary.total || 0),
    openWorkItems: Number(summary.open || 0),
    lastSyncedAt: incident.lastSyncedAt || ''
  };
}

async function notifyIfNeeded(incident, failedCount, actionContext) {
  if (!incident || !service.featureEnabled('OPERATIONS_NOTIFICATION_ENABLED')) return { sent: false, reason: 'disabled' };
  const candidate = notificationCandidate(incident, failedCount);
  if (!candidate) return { sent: false, reason: 'not-required' };
  const existing = await sharePoint.listAudit(incident.incidentId);
  if (existing.some(event => event.eventKey === candidate.eventKey)) return { sent: false, reason: 'duplicate', eventKey: candidate.eventKey };
  const notifier = require('../shared/teams-notifier');
  const result = await notifier.sendTeamsText(candidate.message);
  if (!result.ok) return { sent: false, reason: 'provider-failed', status: result.status };
  await service.audit(sharePoint, actionContext, {
    incidentId: incident.incidentId,
    action: 'RECONCILIATION_NOTIFICATION',
    result: 'SUCCEEDED',
    detail: candidate.type,
    eventKey: candidate.eventKey
  });
  return { sent: true, type: candidate.type, eventKey: candidate.eventKey };
}

function notificationCandidate(incident, failedCount) {
  const displayId = incident.displayId || incident.incidentId;
  const hubUrl = String(process.env.OPERATIONS_HUB_URL || 'https://mango-wave-09cff3700.7.azurestaticapps.net/operations.html');
  if (failedCount > 0) {
    return {
      type: 'SYNC_FAILED',
      eventKey: `operations-notification:${incident.incidentId}:sync-failed:${failedCount}`,
      message: `**Operations Hub synchronization failed**\n\nIncident: ${displayId}\nFailed work items: ${failedCount}\n${hubUrl}#/incidents`
    };
  }
  const items = incident.workItems || [];
  const openRelated = items.filter(item => item.role === 'RELATED' && !require('../shared/operations-work-items').isClosedState(item.state));
  if (openRelated.length > 0) {
    const signature = openRelated.map(item => `${item.workItemId}:${item.state}`).sort().join(',');
    return {
      type: 'RELATED_WORK_REMAINS',
      eventKey: `operations-notification:${incident.incidentId}:related-open:${signature}`,
      message: `**Related Work Items remain open**\n\nIncident: ${displayId}\nOpen related items: ${openRelated.map(item => `#${item.workItemId} (${item.state})`).join(', ')}\n${hubUrl}#/incidents`
    };
  }
  return null;
}

function automationContext(req) {
  return {
    accessToken: undefined,
    correlationId: String(req.headers && (req.headers['x-correlation-id'] || req.headers['x-ms-workflow-run-id']) || crypto.randomUUID()),
    operationsIdentity: { id: 'operations-automation', name: 'Operations Hub Automation', email: '' },
    adoIdentity: { id: 'service-account', displayName: 'Configured Azure DevOps service account', email: '' }
  };
}

function authorized(req) {
  const expected = String(process.env.OPERATIONS_AUTOMATION_KEY || '');
  const actual = String(req.headers && req.headers['x-operations-automation-key'] || '');
  if (!expected || !actual || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function respond(context, status, payload) {
  context.res = {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(payload)
  };
}

module.exports.authorized = authorized;
module.exports.notificationCandidate = notificationCandidate;
module.exports.dryRunCandidate = dryRunCandidate;
