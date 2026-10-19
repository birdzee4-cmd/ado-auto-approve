const crypto = require('crypto');
const sharePoint = require('../shared/operations-sharepoint-client');
const service = require('../shared/operations-service');
const alertService = require('../shared/operations-alert-service');

module.exports = async function (context, req) {
  try {
    if (!authorized(req)) return respond(context, 401, { ok: false, error: 'Unauthorized' });
    const dryRun = Boolean(req.body && req.body.dryRun === true);
    if (!dryRun && !service.featureEnabled('OPERATIONS_RECONCILIATION_ENABLED')) {
      return respond(context, 503, { ok: false, error: 'FEATURE_DISABLED' });
    }
    const maximum = Math.max(1, Math.min(Number(req.body && req.body.maxItems) || 100, 250));
    const targetIncidentId = String(req.body && req.body.incidentId || '').trim();
    const reconciliationScope = String(req.body && req.body.scope || '').trim().toUpperCase();
    const roles = reconciliationScope === 'RELATED'
      ? ['RELATED']
      : reconciliationScope === 'PRIMARY'
        ? ['PRIMARY']
        : undefined;
    const alertWritesEnabled = alertService.featureEnabled('OPERATIONS_ALERT_EVENT_WRITE_ENABLED');
    const storedAlertEvents = typeof sharePoint.listAlertEvents === 'function' ? await sharePoint.listAlertEvents(1000) : [];
    const pendingAlertEvents = storedAlertEvents
      .filter(event => (alertService.RETRYABLE.has(event.processingStatus) || (alertWritesEnabled && event.processingStatus === 'MATCHED')) && Number(event.attemptCount || 0) < 5)
      .filter(event => !targetIncidentId || event.incidentId === targetIncidentId || event.matchedIncidentId === targetIncidentId)
      .slice(0, Math.min(maximum, 20));
    const incidents = (await sharePoint.listIncidents(1000))
      .filter(item => !targetIncidentId || item.incidentId === targetIncidentId || item.displayId === targetIncidentId)
      .filter(item => item.operationsStatus !== 'CLOSED' && item.workItemSummary && item.workItemSummary.total > 0)
      .sort((left, right) => reconciliationOrder(left, right))
      .slice(0, maximum);
    if (targetIncidentId && incidents.length === 0) {
      return respond(context, 404, { ok: false, error: 'INCIDENT_NOT_FOUND', incidentId: targetIncidentId });
    }
    if (dryRun) {
      const compareAdo = Boolean(req.body && req.body.compareAdo === true);
      const actionContext = automationContext(req);
      const candidates = await Promise.all(incidents.map(async incident => {
        const candidate = await notificationDryRunCandidate(incident);
        if (!compareAdo) return candidate;
        const comparison = await service.previewWorkItemSynchronization({ incidentId: incident.incidentId, roles }, actionContext);
        return { ...candidate, adoComparison: comparison.items };
      }));
      return respond(context, 200, {
        ok: true,
        dryRun: true,
        compareAdo,
        processed: incidents.length,
        writeOperations: 0,
        candidates,
        alertEvents: pendingAlertEvents.map(event => ({ eventId: event.eventId, eventType: event.eventType, processingStatus: event.processingStatus, attemptCount: event.attemptCount, alertName: event.alertName, resource: event.resource, firstSeenAt: event.firstSeenAt, resolvedAt: event.resolvedAt }))
      });
    }
    const alertEventResults = [];
    for (const event of pendingAlertEvents) {
      try {
        const processed = await alertService.processEvent(event, { ...automationContext(req), shadow: !alertWritesEnabled });
        alertEventResults.push({ eventId: event.eventId, ok: true, status: processed.processingStatus, matchedIncidentId: processed.matchedIncidentId || '' });
      } catch (err) {
        alertEventResults.push({ eventId: event.eventId, ok: false, error: err.code || err.message });
      }
    }
    const results = [];
    for (const incident of incidents) {
      try {
        const actionContext = automationContext(req);
        // Scheduled reconciliation has its own feature gate. It reads Azure DevOps
        // state and mirrors it to SharePoint; it must not depend on the manual Sync flag.
        const result = await service.synchronizeWorkItems({ incidentId: incident.incidentId, roles }, actionContext);
        const failed = result.items.filter(item => !item.ok).length;
        const refreshed = await sharePoint.getIncident(incident.incidentId);
        const primaryClosure = failed === 0
          ? await service.closeResolvedPrimaryIfReady({ incidentId: incident.incidentId }, actionContext)
          : { closed: false, reason: 'synchronization-failed' };
        const afterClosure = primaryClosure.closed ? await sharePoint.getIncident(incident.incidentId) : refreshed;
        const notification = await notifyIfNeeded(afterClosure, failed, actionContext);
        results.push({ incidentId: incident.incidentId, ok: failed === 0, synchronized: result.items.length, failed, primaryClosure, notification });
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
      results,
      alertEvents: alertEventResults
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

function reconciliationOrder(left, right) {
  const leftTime = Date.parse(left.lastSyncedAt || '') || 0;
  const rightTime = Date.parse(right.lastSyncedAt || '') || 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return String(left.displayId || left.incidentId || '').localeCompare(String(right.displayId || right.incidentId || ''));
}

async function notificationDryRunCandidate(incident) {
  const candidate = dryRunCandidate(incident);
  const notifications = notificationCandidates(incident, 0);
  if (notifications.length === 0) return { ...candidate, notification: { required: false } };

  const existing = await sharePoint.listAudit(incident.incidentId);
  const notification = notifications.find(item => !existing.some(event => event.eventKey === item.eventKey)) || notifications[0];
  const duplicate = existing.some(event => event.eventKey === notification.eventKey);
  return {
    ...candidate,
    notification: {
      required: true,
      duplicate,
      type: notification.type,
      eventKey: notification.eventKey,
      message: notification.message
    }
  };
}

async function notifyIfNeeded(incident, failedCount, actionContext) {
  if (!incident) return { sent: false, reason: 'not-required' };
  const candidates = notificationCandidates(incident, failedCount);
  if (candidates.length === 0) return { sent: false, reason: 'not-required' };
  const existing = candidates.length > 1 ? await sharePoint.listAudit(incident.incidentId) : null;
  const candidate = existing
    ? candidates.find(item => !existing.some(event => event.eventKey === item.eventKey)
      && (item.type !== 'RELATED_WORK_REMAINS' && item.type !== 'SYNC_FAILED'
        || service.featureEnabled('OPERATIONS_NOTIFICATION_ENABLED')))
    : candidates[0];
  if (!candidate) return { sent: false, reason: 'duplicate', eventKey: candidates[0].eventKey };
  const dedicatedRoom = candidate.type === 'READY_TO_CLOSE' || candidate.type === 'RESOLVED_OPEN_24H';
  const flag = dedicatedRoom
    ? 'OPERATIONS_READY_TO_CLOSE_NOTIFICATION_ENABLED'
    : 'OPERATIONS_NOTIFICATION_ENABLED';
  if (!service.featureEnabled(flag)) return { sent: false, reason: 'disabled' };
  const readyWebhookUrl = dedicatedRoom
    ? String(process.env.TEAMS_READY_TO_CLOSE_WEBHOOK_URL || '').trim()
    : '';
  if (dedicatedRoom && !readyWebhookUrl) {
    return { sent: false, reason: 'destination-not-configured' };
  }
  if (readyWebhookUrl && readyWebhookUrl === String(process.env.TEAMS_WEBHOOK_URL || '').trim()) {
    return { sent: false, reason: 'destination-matches-default' };
  }
  const audit = existing || await sharePoint.listAudit(incident.incidentId);
  if (audit.some(event => event.eventKey === candidate.eventKey)) {
    return { sent: false, reason: 'duplicate', eventKey: candidate.eventKey };
  }
  const notifier = require('../shared/teams-notifier');
  const result = readyWebhookUrl
    ? await notifier.sendTeamsMessage(candidate.card, { webhookUrl: readyWebhookUrl })
    : await notifier.sendTeamsText(candidate.message);
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

function notificationCandidates(incident, failedCount, nowMs = Date.now()) {
  if (!incident) return [];
  return [notificationCandidate(incident, failedCount), resolvedOpen24hReminderCandidate(incident, nowMs)].filter(Boolean);
}

function resolvedOpen24hReminderCandidate(incident, nowMs = Date.now()) {
  if (String(incident.status || '').toUpperCase() !== 'RESOLVED'
    || String(incident.operationsStatus || '').toUpperCase() === 'CLOSED') return null;

  // LastAlertAt is written when RESOLVED is received. ResolvedAt in older
  // incidents can have a timezone offset, so it is unsafe for this deadline.
  const recordedAt = Date.parse(incident.lastAlertAt || '');
  if (!Number.isFinite(recordedAt) || nowMs - recordedAt < 24 * 60 * 60 * 1000) return null;

  const displayId = incident.displayId || incident.incidentId;
  const hubUrl = String(process.env.OPERATIONS_HUB_URL || 'https://mango-wave-09cff3700.7.azurestaticapps.net/operations.html');
  const incidentUrl = `${hubUrl}#/incidents?id=${encodeURIComponent(incident.incidentId)}`;
  const detail = `Incident: ${displayId}\nMonitoring: Resolved\nThis incident has remained open in Operations Hub for at least 24 hours after RESOLVED was recorded. Please review and close it when the work is complete.`;
  return {
    type: 'RESOLVED_OPEN_24H',
    eventKey: `operations-notification:${incident.incidentId}:resolved-open-24h`,
    message: `⏰ **Operations Hub: Resolved incident still open after 24 hours**\n\n${detail}\n${incidentUrl}`,
    card: {
      type: 'AdaptiveCard',
      version: '1.4',
      body: [
        { type: 'TextBlock', text: '⏰ Operations Hub: Resolved incident still open after 24 hours', weight: 'Bolder', size: 'Medium', wrap: true },
        { type: 'TextBlock', text: detail, wrap: true }
      ],
      actions: [{ type: 'Action.OpenUrl', title: 'Open Incident', url: incidentUrl }]
    }
  };
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
  const workItems = require('../shared/operations-work-items');
  if (String(incident.operationsStatus || '').toUpperCase() !== 'CLOSED'
    && String(incident.status || '').toUpperCase() === 'RESOLVED'
    && items.some(item => item.role === 'PRIMARY')
    && items.every(item => workItems.isClosedState(item.state))) {
    const incidentUrl = `${hubUrl}#/incidents?id=${encodeURIComponent(incident.incidentId)}`;
    return {
      type: 'READY_TO_CLOSE',
      eventKey: `operations-notification:${incident.incidentId}:ready-to-close:azureappservicehigh5xxratecritical`,
      message: `🔔 **Operations Hub: Incident ready to close**\n\nIncident: ${displayId}\nMonitoring: Resolved\nAll ${items.length} tracked work items are in terminal states. Please review and confirm closure in Operations Hub.\n${incidentUrl}`,
      card: {
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          { type: 'TextBlock', text: '🔔 Operations Hub: Incident ready to close', weight: 'Bolder', size: 'Medium', wrap: true },
          { type: 'TextBlock', text: `Incident: ${displayId}\nMonitoring: Resolved\nAll ${items.length} tracked work items are in terminal states. Please review and confirm closure in Operations Hub.`, wrap: true }
        ],
        actions: [{ type: 'Action.OpenUrl', title: 'Open Incident', url: incidentUrl }]
      }
    };
  }
  const openRelated = items.filter(item => item.role === 'RELATED' && !workItems.isClosedState(item.state));
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
module.exports.dryRunCandidate = dryRunCandidate;
module.exports.notificationDryRunCandidate = notificationDryRunCandidate;
module.exports.notificationCandidate = notificationCandidate;
module.exports.resolvedOpen24hReminderCandidate = resolvedOpen24hReminderCandidate;
module.exports.notifyIfNeeded = notifyIfNeeded;
module.exports.reconciliationOrder = reconciliationOrder;
