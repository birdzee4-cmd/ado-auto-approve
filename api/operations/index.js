const auth = require('../shared/auth');
const sharePoint = require('../shared/operations-sharepoint-client');
const operationsService = require('../shared/operations-service');
const alertService = require('../shared/operations-alert-service');
const crypto = require('crypto');

module.exports = async function (context, req) {
  const path = normalizePath(req.params && req.params.path);
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'POST' && path === 'alert-events' && automationAuthorized(req)) {
    try {
      const result = await alertService.ingest(parseBody(req.body), automationActionContext(req));
      return jsonResponse(context, result.duplicate ? 200 : 202, { ok: true, data: result });
    } catch (err) {
      return jsonResponse(context, Number(err.status) || 503, { ok: false, error: err.code || 'ALERT_EVENT_INGEST_FAILED', detail: err.message });
    }
  }
  const roleCheck = auth.requireAnyRole(context, req, ['it_support_approve', 'admin']);
  if (!roleCheck.ok) return jsonResponse(context, roleCheck.status, roleCheck.body);
  try {
    if (method === 'POST') {
      // Await inside this try/catch so rejected write operations are converted
      // into the same sanitized JSON error contract as read operations.
      return await handleWrite(context, req, path, roleCheck.principal);
    }

    if (path === 'dashboard') {
      const incidents = await sharePoint.listIncidents(1000);
      return jsonResponse(context, 200, { ok: true, data: dashboardSummary(incidents, req.query || {}) });
    }

    if (path === 'capabilities') {
      return jsonResponse(context, 200, {
        ok: true,
        data: {
          createRelated: operationsService.featureEnabled('OPERATIONS_CREATE_ENABLED'),
          linkExisting: operationsService.featureEnabled('OPERATIONS_LINK_ENABLED'),
          synchronize: operationsService.featureEnabled('OPERATIONS_SYNC_ENABLED'),
          closeIncident: operationsService.featureEnabled('OPERATIONS_CLOSE_ENABLED'),
          manualCloseIncident: operationsService.featureEnabled('OPERATIONS_MANUAL_CLOSE_ENABLED'),
          restartAppService: operationsService.featureEnabled('OPERATIONS_RESTART_ENABLED'),
          alertEventWrite: alertService.featureEnabled('OPERATIONS_ALERT_EVENT_WRITE_ENABLED')
        }
      });
    }

    if (path === 'incidents') {
      const incidents = filterIncidents(await sharePoint.listIncidents(1000), req.query || {});
      return jsonResponse(context, 200, { ok: true, data: { items: incidents, count: incidents.length } });
    }

    if (path === 'alert-events') {
      const status = String(req.query && req.query.status || '').trim().toUpperCase();
      const top = Math.max(1, Math.min(Number(req.query && req.query.top) || 200, 1000));
      const events = await sharePoint.listAlertEvents(top, status);
      return jsonResponse(context, 200, { ok: true, data: { items: events, count: events.length } });
    }

    if (path === 'mappings') {
      const admin = auth.requireAnyRole(context, req, ['admin']);
      if (!admin.ok) return jsonResponse(context, admin.status, admin.body);
      const mappings = await sharePoint.listMappings({ includeDisabled: true });
      return jsonResponse(context, 200, { ok: true, data: { items: mappings, count: mappings.length } });
    }

    const detailMatch = /^incidents\/([A-Za-z0-9._:-]+)$/.exec(path);
    if (detailMatch) {
      const incident = await sharePoint.getIncident(detailMatch[1]);
      if (!incident) return jsonResponse(context, 404, { ok: false, error: 'Incident not found' });
      const audit = await sharePoint.listAudit(incident.incidentId);
      return jsonResponse(context, 200, {
        ok: true,
        data: {
          incident: { ...incident, closeEligibility: operationsService.closeEligibility(incident) },
          timeline: [...audit, ...buildTimeline(incident)]
            .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0))
        }
      });
    }

    if (path === 'mappings/resolve') {
      const incident = await sharePoint.getIncident(req.query && req.query.incidentId);
      if (!incident) return jsonResponse(context, 404, { ok: false, error: 'Incident not found' });
      const mapping = operationsService.resolveMapping(await sharePoint.listMappings(), incident, req.query && req.query.supportTeam);
      return jsonResponse(context, 200, { ok: true, data: { mapping } });
    }

    return jsonResponse(context, 404, { ok: false, error: 'Operations API route not found' });
  } catch (err) {
    context.log.error('Operations SharePoint API failed:', sanitizeError(err));
    return jsonResponse(context, Number(err.status) || 503, {
      ok: false,
      error: err.code || 'OPERATIONS_REQUEST_FAILED',
      detail: err.message || 'Check the Operations Hub SharePoint List and API settings.',
      data: err.data
    });
  }
};

async function handleWrite(context, req, path, principal) {
  const writer = auth.requireOperationsWriter(context, req);
  if (!writer.ok) return jsonResponse(context, writer.status, writer.body);
  const body = parseBody(req.body);
  const actionContext = userActionContext(req, principal);
  if (path === 'alert-events') {
    return jsonResponse(context, 405, {
      ok: false,
      error: 'ALERT_EVENTS_READ_ONLY',
      detail: 'Alert Events ingestion is restricted to the authenticated Production Power Automate endpoint.'
    });
  }
  const legacyResolved = /^legacy-resolved-migration$/.test(path);
  if (legacyResolved) {
    const admin = auth.requireAnyRole(context, req, ['admin']);
    if (!admin.ok) return jsonResponse(context, admin.status, admin.body);
    if (body.confirmWrite !== true) {
      const incidents = (await sharePoint.listIncidents(1000)).filter(item => inLegacyRange(item.incidentId, body.from, body.to));
      return jsonResponse(context, 200, { ok: true, dryRun: true, data: incidents.map(legacyMigrationPreview) });
    }
    const incidents = (await sharePoint.listIncidents(1000)).filter(item => inLegacyRange(item.incidentId, body.from, body.to));
    const results = [];
    for (const incident of incidents) {
      const resolvedAt = legacyResolvedAt(incident);
      if (String(incident.status || '').toUpperCase() === 'RESOLVED' && incident.resolvedAt) {
        results.push({ incidentId: incident.incidentId, skipped: true, reason: 'ALREADY_RESOLVED' });
        continue;
      }
      await sharePoint.updateIncidentRecord(incident.sharePointId, {
        AlertStatus: 'RESOLVED',
        ResolvedAt: resolvedAt,
        LastSyncedAt: new Date().toISOString(),
        LastSourceMessageId: `legacy-resolved-migration:${incident.incidentId}`
      });
      await sharePoint.appendAudit({
        Title: 'LEGACY_RESOLVED_MIGRATION', EventId: crypto.randomUUID(),
        EventKey: `LEGACY_RESOLVED_MIGRATION:${incident.incidentId}`,
        CorrelationId: String(req.headers && (req.headers['x-correlation-id'] || req.headers['x-ms-request-id']) || crypto.randomUUID()),
        IncidentId: incident.incidentId, Action: 'LEGACY_RESOLVED_MIGRATION', Result: 'SUCCEEDED',
        OperationsUserId: principal.userId || '', OperationsUserName: principal.userDetails || '',
        OperationsUserEmail: auth.getUserEmail(principal) || '',
        Detail: 'One-time legacy migration: AlertStatus set to RESOLVED; related work and Operations status preserved.',
        OccurredAt: new Date().toISOString()
      });
      results.push({ incidentId: incident.incidentId, updated: true, resolvedAt });
    }
    return jsonResponse(context, 200, { ok: true, dryRun: false, data: results });
  }
  // Alert Events is intentionally a read-only monitoring surface. Event
  // ingestion remains automation-only above; reconciliation is owned by the
  // scheduled service and must not be triggered from the UI.
  if (/^alert-events\/[A-Za-z0-9._:-]+\/(process|confirm|reject)$/.test(path)) {
    return jsonResponse(context, 405, {
      ok: false,
      error: 'ALERT_EVENTS_READ_ONLY',
      detail: 'Alert Events is read-only. The production Flow and scheduled reconciliation own lifecycle updates.'
    });
  }
  const backfill = /^incidents\/([A-Za-z0-9._:-]+)\/resolved-backfill$/.exec(path);
  if (backfill) {
    const incident = await sharePoint.getIncident(backfill[1]);
    if (!incident) return jsonResponse(context, 404, { ok: false, error: 'INCIDENT_NOT_FOUND' });
    const result = await alertService.ingest({
      ...body, eventType: 'RESOLVED', incidentId: incident.incidentId,
      messageId: body.messageId || `resolved-backfill:${incident.incidentId}:${body.resolvedAt || ''}`,
      alertName: body.alertName || incident.alertName, resource: body.resource || incident.resource,
      firstSeenAt: body.firstSeenAt || incident.firstSeen, receivedAt: body.receivedAt || body.resolvedAt
    }, actionContext);
    return jsonResponse(context, result.duplicate ? 200 : 202, { ok: true, data: result });
  }
  const manualClose = /^incidents\/([A-Za-z0-9._:-]+)\/manual-close$/.exec(path);
  if (manualClose) {
    const data = await operationsService.manualCloseIncident({ ...body, incidentId: manualClose[1] }, actionContext);
    return jsonResponse(context, 200, { ok: true, data });
  }
  const delegated = require('../shared/ado-user-token');
  const token = await delegated.getValidAccessToken(req, principal);
  if (!token.ok) {
    return jsonResponse(context, token.status || 428, {
      ok: false,
      error: token.error || 'Azure DevOps connection required',
      connectUrl: '/api/ado-auth-start?returnTo=/operations.html'
    });
  }
  const verified = await require('../shared/ado-identity').verifyAdoIdentity(token.accessToken);
  if (!verified.ok) {
    return jsonResponse(context, 428, {
      ok: false,
      error: verified.error,
      connectUrl: '/api/ado-auth-start?returnTo=/operations.html'
    }, token.setCookie);
  }
  const match = /^incidents\/([A-Za-z0-9._:-]+)\/(.+)$/.exec(path);
  if (!match) return jsonResponse(context, 404, { ok: false, error: 'Operations write route not found' }, token.setCookie);
  const incidentId = match[1];
  const action = match[2];
  const adoActionContext = {
    accessToken: token.accessToken,
    correlationId: String(req.headers && (req.headers['x-correlation-id'] || req.headers['x-ms-request-id']) || require('crypto').randomUUID()),
    operationsIdentity: {
      id: principal.userId || '',
      name: principal.userDetails || '',
      email: principal.userDetails || ''
    },
    adoIdentity: verified.identity,
    principalHeader: req.headers && (req.headers['x-ms-client-principal'] || req.headers['X-MS-CLIENT-PRINCIPAL'] || '')
  };
  let data;
  if (action === 'work-items/related/preview') data = await operationsService.previewRelatedBatch({ ...body, incidentId }, adoActionContext);
  else if (action === 'work-items/related') data = await operationsService.createRelated({ ...body, incidentId }, adoActionContext);
  else if (action === 'work-items/related/batch') data = await operationsService.createRelatedBatch({ ...body, incidentId }, adoActionContext);
  else if (action === 'work-items/link') data = await operationsService.linkExisting({ ...body, incidentId }, adoActionContext);
  else if (action === 'synchronize') data = await operationsService.synchronize({ ...body, incidentId }, adoActionContext);
  else if (action === 'close') data = await operationsService.closeIncident({ ...body, incidentId }, adoActionContext);
  else if (action === 'tier1/restart-app-service') data = await operationsService.restartAppService({ ...body, incidentId }, adoActionContext);
  else return jsonResponse(context, 404, { ok: false, error: 'Operations write route not found' }, token.setCookie);
  return jsonResponse(context, 200, { ok: true, data }, token.setCookie);
}

function inLegacyRange(id, from = 180, to = 278) {
  const match = /^INC-\d{4}-(\d+)$/.exec(String(id || '').trim().toUpperCase());
  if (!match) return false;
  const number = Number(match[1]);
  return number >= Number(from) && number <= Number(to);
}

function legacyResolvedAt(incident) {
  const candidates = [incident.lastAlertAt, incident.lastSeen, incident.firstSeen];
  const first = Date.parse(incident.firstSeen || '');
  for (const value of candidates) {
    const parsed = Date.parse(value || '');
    if (Number.isFinite(parsed) && (!Number.isFinite(first) || parsed > first)) return new Date(parsed).toISOString();
  }
  return new Date((Number.isFinite(first) ? first : Date.now()) + 1000).toISOString();
}

function legacyMigrationPreview(incident) {
  return { incidentId: incident.incidentId, currentAlertStatus: incident.status || '', operationsStatus: incident.operationsStatus || '', resolvedAt: legacyResolvedAt(incident), action: String(incident.status || '').toUpperCase() === 'RESOLVED' && incident.resolvedAt ? 'SKIP' : 'UPDATE_ALERT_TO_RESOLVED' };
}

function userActionContext(req, principal) {
  return {
    correlationId: String(req.headers && (req.headers['x-correlation-id'] || req.headers['x-ms-request-id']) || crypto.randomUUID()),
    operationsIdentity: { id: principal.userId || '', name: principal.userDetails || '', email: principal.userDetails || '' }
  };
}

function automationActionContext(req) {
  return {
    correlationId: String(req.headers && (req.headers['x-correlation-id'] || req.headers['x-ms-workflow-run-id']) || crypto.randomUUID()),
    operationsIdentity: { id: 'power-automate', name: 'Power Automate', email: '' }, shadow: true
  };
}

function automationAuthorized(req) {
  const expected = String(process.env.OPERATIONS_AUTOMATION_KEY || '');
  const actual = String(req.headers && req.headers['x-operations-automation-key'] || '');
  return Boolean(expected && actual && expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual)));
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  try { return JSON.parse(body); } catch (err) {
    throw Object.assign(new Error('Request body must be valid JSON'), { status: 400, code: 'INVALID_JSON' });
  }
}

function normalizePath(path) {
  const value = String(path || '').replace(/^\/+|\/+$/g, '');
  if (!value || value.includes('..') || value.includes('\\') || /%2f|%5c/i.test(value)) return '';
  return value;
}

function filterIncidents(items, query) {
  const status = String(query.status || '').trim().toUpperCase();
  const search = String(query.search || '').trim().toLowerCase();
  return (items || []).filter(item => {
    const statusMatch = !status || [item.status, item.trackingStatus, item.workflowStatus, item.adoState]
      .some(value => String(value || '').toUpperCase() === status);
    const workItemSearch = (item.workItems || []).flatMap(workItem => [
      workItem.workItemId,
      workItem.role,
      workItem.supportTeam,
      workItem.state,
      workItem.assignedTo
    ]);
    const haystack = [item.displayId, item.sharePointId, item.incidentId, item.alertName, item.resource, item.service, item.environment, item.workItemId, item.assignedTo, ...workItemSearch]
      .join(' ').toLowerCase();
    return statusMatch && (!search || haystack.includes(search));
  });
}

function dashboardSummary(incidents, query = {}, now = new Date()) {
  const items = incidents || [];
  const selectedDate = validBangkokDate(query.date) || bangkokDateKey(now);
  const dailyItems = items
    .filter(item => incidentDateKey(item) === selectedDate)
    .sort((a, b) => incidentTimestamp(b) - incidentTimestamp(a));
  const resolvedToday = items.filter(item => dateKey(item.resolvedAt) === selectedDate);
  const adoCreatedToday = items.filter(item => dateKey(item.adoCreatedAt) === selectedDate);
  const activeItems = items.filter(item => !isOperationsClosed(item));
  const lifecycleConflicts = activeItems.filter(item => item.hasLifecycleConflict && !isWaitingForResolved(item));
  const needsAttention = activeItems
    .filter(item => isBacklogItem(item))
    .sort((a, b) => incidentTimestamp(b) - incidentTimestamp(a))
    .slice(0, 8);

  return {
    totalIncidents: items.length,
    adoWorkItems: items.reduce((sum, item) => sum + workItemCount(item, 'total'), 0),
    openWorkItems: items.reduce((sum, item) => sum + workItemCount(item, 'open'), 0),
    closedWorkItems: items.reduce((sum, item) => sum + workItemCount(item, 'closed'), 0),
    awaitingApproval: items.filter(item => item.workflowStatus === 'AWAITING_APPROVAL' || item.trackingStatus === 'PENDING').length,
    cancelledItems: items.filter(item => item.trackingStatus === 'CANCELLED').length,
    failedItems: items.filter(item => item.trackingStatus === 'FAILED').length,
    lifecycleConflicts: lifecycleConflicts.length,
    recentIncidents: items.slice(0, 10),
    selectedDate,
    daily: {
      newIncidents: dailyItems.length,
      resolvedIncidents: resolvedToday.length,
      adoCreated: adoCreatedToday.length,
      failedIncidents: dailyItems.filter(item => item.trackingStatus === 'FAILED').length,
      pendingApproval: dailyItems.filter(item => item.workflowStatus === 'AWAITING_APPROVAL' || item.trackingStatus === 'PENDING').length,
      openBacklog: items.filter(item => {
        const openedDate = dateKey(item.firstSeen || item.receivedAt || item.createdAt);
        return activeItems.includes(item) && isBacklogItem(item) && openedDate && openedDate <= selectedDate;
      }).length,
      lifecycleConflicts: lifecycleConflicts.length,
      incidents: dailyItems.slice(0, 25),
      totalIncidents: dailyItems.length
    },
    dailySeries: buildDailySeries(items, selectedDate, 14),
    needsAttention,
    generatedAt: new Date().toISOString()
  };
}

function isOperationsClosed(item) {
  return String(item.operationsStatus || '').toUpperCase() === 'CLOSED';
}

function isWaitingForResolved(item) {
  return !isOperationsClosed(item)
    && item.status === 'FIRING'
    && workItemCount(item, 'total') > 0
    && workItemCount(item, 'open') === 0;
}

function isWaitingForSupport(item) {
  return !isOperationsClosed(item)
    && !['PENDING', 'FAILED', 'NOT_CREATED'].includes(item.trackingStatus)
    && (item.workItems || []).some(workItem => workItem.role === 'RELATED' && !isClosedWorkItemState(workItem.state));
}

function isReadyToClose(item) {
  return !isOperationsClosed(item)
    && item.status === 'RESOLVED'
    && workItemCount(item, 'total') > 0
    && workItemCount(item, 'open') === 0;
}

function isActionRequired(item) {
  return !isOperationsClosed(item)
    && !isWaitingForSupport(item)
    && !isWaitingForResolved(item)
    && !isReadyToClose(item)
    && (['PENDING', 'FAILED', 'NOT_CREATED'].includes(item.trackingStatus)
      || Boolean(item.hasLifecycleConflict));
}

function isBacklogItem(item) {
  return isActionRequired(item) || isWaitingForSupport(item) || isWaitingForResolved(item) || isReadyToClose(item);
}

function isClosedWorkItemState(value) {
  return ['CLOSED', 'DONE', 'REMOVED', 'RESOLVED', 'REJECT', 'REJECTED'].includes(String(value || '').trim().toUpperCase());
}

function workItemCount(item, kind) {
  if (item.workItemSummary && Number.isFinite(Number(item.workItemSummary[kind]))) {
    return Number(item.workItemSummary[kind]);
  }
  if (!item.workItemId) return 0;
  if (kind === 'total') return 1;
  if (kind === 'open') return item.trackingStatus === 'OPEN' ? 1 : 0;
  if (kind === 'closed') return item.trackingStatus === 'CLOSED' ? 1 : 0;
  return 0;
}

function buildDailySeries(items, endDate, days) {
  const end = bangkokDateToUtc(endDate);
  const series = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const point = new Date(end.getTime() - offset * 86400000);
    const date = bangkokDateKey(point);
    series.push({
      date,
      opened: items.filter(item => incidentDateKey(item) === date).length,
      resolved: items.filter(item => dateKey(item.resolvedAt) === date).length,
      failed: items.filter(item => incidentDateKey(item) === date && item.trackingStatus === 'FAILED').length
    });
  }
  return series;
}

function incidentDateKey(item) {
  return dateKey(item.firstSeen || item.receivedAt || item.createdAt || item.lastSeen);
}

function incidentTimestamp(item) {
  return Date.parse(item.firstSeen || item.receivedAt || item.createdAt || item.lastSeen || '') || 0;
}

function dateKey(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? bangkokDateKey(new Date(parsed)) : '';
}

function bangkokDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function bangkokDateToUtc(value) {
  return new Date(`${value}T00:00:00+07:00`);
}

function validBangkokDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const parsed = bangkokDateToUtc(text);
  return !Number.isNaN(parsed.getTime()) && bangkokDateKey(parsed) === text ? text : '';
}

function buildTimeline(incident) {
  const events = [];
  addTimeline(events, incident.receivedAt, 'ALERT_RECEIVED', 'RECEIVED', 'Power Automate recorded the alert.');
  addTimeline(events, incident.firstSeen, 'ALERT_FIRING', 'FIRING', 'Monitoring first detected the incident.');
  addTimeline(events, incident.approvalRequestedAt, 'APPROVAL_REQUESTED', 'AWAITING_APPROVAL', 'Approval was requested.');
  addTimeline(events, incident.approvalCompletedAt, 'APPROVAL_COMPLETED', incident.approvalOutcome || 'COMPLETED', incident.approvalComment || 'Approval completed.');
  addTimeline(events, incident.adoCreatedAt, 'ADO_WORK_ITEM_CREATED', incident.adoState || 'CREATED', incident.workItemId ? `Work item #${incident.workItemId}` : '');
  addTimeline(events, incident.resolvedAt, 'ALERT_RESOLVED', 'RESOLVED', incident.durationMinutes == null ? 'Monitoring reported that the alert was resolved.' : `Alert resolved after ${incident.durationMinutes} minutes.`);
  addTimeline(events, incident.adoClosedAt, 'ADO_WORK_ITEM_CLOSED', incident.adoState || 'CLOSED', 'Azure DevOps work item closed.');
  addTimeline(events, incident.lastSyncedAt, 'LAST_SYNCED', incident.workflowStatus || 'SYNCED', incident.errorDetail || 'Latest status synchronized from Power Automate.');
  return events.sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
}

function addTimeline(events, timestamp, eventType, result, detail) {
  if (!timestamp) return;
  events.push({ eventId: `${eventType}:${timestamp}`, timestamp, eventType, result, detail });
}

function jsonResponse(context, status, payload, setCookie) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate' };
  if (setCookie) headers['Set-Cookie'] = setCookie;
  context.res = {
    status,
    headers,
    body: JSON.stringify(payload)
  };
}

function sanitizeError(err) {
  return { name: err && err.name, code: err && err.code, message: err && err.message };
}

module.exports.dashboardSummary = dashboardSummary;
module.exports.filterIncidents = filterIncidents;
module.exports.normalizePath = normalizePath;
