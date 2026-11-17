const crypto = require('crypto');
const sharePoint = require('../shared/operations-sharepoint-client');
const service = require('../shared/operations-service');
const alertService = require('../shared/operations-alert-service');
const globalSettings = require('../shared/operations-global-settings');
const READY_TO_CLOSE_DELAY_MS = 12 * 60 * 60 * 1000;
const AUTO_RESTART_DELAY_MS = 5 * 60 * 1000;

module.exports = async function (context, req) {
  try {
    if (!authorized(req)) return respond(context, 401, { ok: false, error: 'Unauthorized' });
    const dryRun = Boolean(req.body && req.body.dryRun === true);
    if (!dryRun && !service.featureEnabled('OPERATIONS_RECONCILIATION_ENABLED')) {
      return respond(context, 503, { ok: false, error: 'FEATURE_DISABLED' });
    }
    const maximum = Math.max(1, Math.min(Number(req.body && req.body.maxItems) || 100, 250));
    const assigneeOnly = req.body && req.body.assigneeOnly === true;
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
    const loadIncidents = async () => (await sharePoint.listIncidents(1000))
      .filter(item => !targetIncidentId || item.incidentId === targetIncidentId || item.displayId === targetIncidentId)
      .filter(item => item.operationsStatus !== 'CLOSED' && item.workItemSummary && item.workItemSummary.total > 0)
      .sort((left, right) => reconciliationOrder(left, right))
      .slice(0, maximum);
    let incidents = await loadIncidents();
    if (targetIncidentId && incidents.length === 0) {
      return respond(context, 404, { ok: false, error: 'INCIDENT_NOT_FOUND', incidentId: targetIncidentId });
    }
    const assigneeReconciliation = await service.reconcileMissingApprovalAssignees({
      maxItems: maximum,
      dryRun,
      incidentId: targetIncidentId
    }, automationContext(req));
    if (assigneeOnly) {
      return respond(context, assigneeReconciliation.results.some(item => !item.ok) ? 207 : 200, {
        ok: assigneeReconciliation.results.every(item => item.ok),
        assigneeOnly: true,
        processed: assigneeReconciliation.scanned,
        fixed: assigneeReconciliation.fixed,
        assigneeReconciliation
      });
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
        assigneeReconciliation,
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
    // RESOLVED events can update the Incident record above. Reload the
    // candidates before synchronizing ADO so the same reconciliation run can
    // add the RESOLVED comment and close the primary Work Item. Without this,
    // the initial pre-event snapshot could defer the ADO action until a later
    // run (or miss it when the event was written by the legacy flow).
    if (pendingAlertEvents.length > 0) incidents = await loadIncidents();
    const results = [];
    for (const incident of incidents) {
      try {
        const actionContext = automationContext(req);
        const autoRestart = await autoRestartIfDue(incident, actionContext);
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
        results.push({ incidentId: incident.incidentId, ok: failed === 0 && autoRestart.ok, synchronized: result.items.length, failed, autoRestart, primaryClosure, notification });
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
      assigneeReconciliation,
      alertEvents: alertEventResults
    });
  } catch (err) {
    context.log.error('Operations reconciliation failed:', err);
    return respond(context, 500, { ok: false, error: 'RECONCILIATION_FAILED', detail: err.message });
  }
};

async function autoRestartIfDue(incident, actionContext, nowMs = Date.now(), dependencies = {}) {
  const targetService = dependencies.service || service;
  const targetSharePoint = dependencies.sharePoint || sharePoint;
  if (!targetService.featureEnabled('OPERATIONS_AUTO_RESTART_ENABLED')) return { ok: true, attempted: false, reason: 'disabled' };
  const global = await globalSettings.getAutoRestart(targetSharePoint);
  if (!global.enabled) return { ok: true, attempted: false, reason: 'global-disabled' };
  if (!targetService.featureEnabled('OPERATIONS_RESTART_ENABLED')) return { ok: false, attempted: false, reason: 'restart-disabled' };
  if (String(incident.status || '').toUpperCase() !== 'FIRING') return { ok: true, attempted: false, reason: 'not-firing' };
  if (String(incident.operationsStatus || '').toUpperCase() === 'CLOSED') return { ok: true, attempted: false, reason: 'incident-closed' };
  if (String(incident.priority || '').trim().toUpperCase() !== 'P1') return { ok: true, attempted: false, reason: 'not-p1' };
  const appServiceSignals = [incident.platform, incident.service, incident.alertName, incident.resource]
    .map(value => String(value || '').toLowerCase()).join(' ');
  if (!appServiceSignals.includes('app service') && !appServiceSignals.includes('appservice')) return { ok: true, attempted: false, reason: 'not-app-service' };
  const firstSeenMs = Date.parse(incident.firstSeen || '');
  if (!Number.isFinite(firstSeenMs) || nowMs - firstSeenMs < AUTO_RESTART_DELAY_MS) {
    return { ok: true, attempted: false, reason: 'waiting', dueAt: Number.isFinite(firstSeenMs) ? new Date(firstSeenMs + AUTO_RESTART_DELAY_MS).toISOString() : null };
  }
  const eventKey = `operations-auto-restart:${incident.incidentId}`;
  const existing = typeof targetSharePoint.listAudit === 'function' ? await targetSharePoint.listAudit(incident.incidentId) : [];
  if (existing.some(event => event.eventKey === eventKey)) return { ok: true, attempted: false, reason: 'already-attempted', eventKey };
  const primary = (incident.workItems || []).find(item => item.role === 'PRIMARY') || {};
  if (!primary.workItemId) return { ok: false, attempted: false, reason: 'primary-required', eventKey };
  const resource = String(incident.resource || '').trim();
  if (!resource) return { ok: false, attempted: false, reason: 'resource-required', eventKey };

  // Record the attempt before calling Azure so a scheduler retry cannot issue
  // a second production restart if the process is interrupted mid-action.
  await targetService.audit(targetSharePoint, actionContext, {
    incidentId: incident.incidentId,
    workItemId: primary.workItemId,
    action: 'TIER1_AUTO_RESTART_APP_SERVICE',
    result: 'STARTED',
    detail: `Automatic restart due after ${AUTO_RESTART_DELAY_MS / 60000} minutes; resource ${resource}`,
    eventKey
  });
  try {
    const result = await targetService.restartAppService({ incidentId: incident.incidentId, resource }, {
      ...actionContext,
      operationsIdentity: {
        id: 'operations-auto-restart',
        name: 'Operations Hub Automation',
        email: String(process.env.OPERATIONS_AUTO_RESTART_ACTOR_EMAIL || '').trim()
      }
    });
    await targetService.audit(targetSharePoint, actionContext, {
      incidentId: incident.incidentId,
      workItemId: primary.workItemId,
      action: 'TIER1_AUTO_RESTART_APP_SERVICE',
      result: 'SUCCEEDED',
      detail: `Automatic Restart App Service completed for ${resource}; VSTS Discussion added.`,
      eventKey: `${eventKey}:completed`
    });
    return { ok: true, attempted: true, result: 'SUCCEEDED', resource, workItemId: primary.workItemId, details: result };
  } catch (err) {
    await targetService.audit(targetSharePoint, actionContext, {
      incidentId: incident.incidentId,
      workItemId: primary.workItemId,
      action: 'TIER1_AUTO_RESTART_APP_SERVICE',
      result: 'FAILED',
      detail: `Automatic Restart App Service failed for ${resource}: ${err.message}`,
      eventKey: `${eventKey}:failed`
    }).catch(() => {});
    return { ok: false, attempted: true, result: 'FAILED', resource, workItemId: primary.workItemId, error: err.code || err.message };
  }
}

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
  const timing = readyNotificationTiming(notification, existing);
  return {
    ...candidate,
    notification: {
      required: true,
      duplicate,
      ...timing,
      type: notification.type,
      eventKey: notification.eventKey,
      message: notification.message
    }
  };
}

async function notifyIfNeeded(incident, failedCount, actionContext, nowMs = Date.now()) {
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
  if (candidate.type === 'READY_TO_CLOSE') {
    const timing = readyNotificationTiming(candidate, audit, nowMs);
    if (!timing.scheduledAt) {
      await service.audit(sharePoint, actionContext, {
        incidentId: incident.incidentId,
        action: 'RECONCILIATION_NOTIFICATION_SCHEDULED',
        result: 'SUCCEEDED',
        detail: candidate.type,
        eventKey: `${candidate.eventKey}:scheduled`
      });
      return { sent: false, reason: 'waiting-first-reminder', dueAt: new Date(nowMs + READY_TO_CLOSE_DELAY_MS).toISOString() };
    }
    if (!timing.due) return { sent: false, reason: 'waiting-first-reminder', dueAt: timing.dueAt };
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

function readyNotificationTiming(candidate, audit, nowMs = Date.now()) {
  if (candidate.type !== 'READY_TO_CLOSE') return {};
  const scheduled = audit.find(event => event.eventKey === `${candidate.eventKey}:scheduled`);
  const scheduledMs = Date.parse(scheduled?.timestamp || '');
  if (!Number.isFinite(scheduledMs)) return { scheduledAt: null, dueAt: null, due: false };
  const dueMs = scheduledMs + READY_TO_CLOSE_DELAY_MS;
  return { scheduledAt: new Date(scheduledMs).toISOString(), dueAt: new Date(dueMs).toISOString(), due: nowMs >= dueMs };
}

function notificationCandidates(incident, failedCount, nowMs = Date.now()) {
  if (!incident) return [];
  return [notificationCandidate(incident, failedCount), resolvedOpen24hReminderCandidate(incident, nowMs)].filter(Boolean);
}

function resolvedOpen24hReminderCandidate(incident, nowMs = Date.now()) {
  if (String(incident.status || '').toUpperCase() !== 'RESOLVED'
    || service.hasInvalidResolutionTimeline(incident)
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
    && !service.hasInvalidResolutionTimeline(incident)
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
module.exports.autoRestartIfDue = autoRestartIfDue;
