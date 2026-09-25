const auth = require('../shared/auth');
const sharePoint = require('../shared/operations-sharepoint-client');
const operationsService = require('../shared/operations-service');

module.exports = async function (context, req) {
  const roleCheck = auth.requireAnyRole(context, req, ['it_support_approve', 'admin']);
  if (!roleCheck.ok) return jsonResponse(context, roleCheck.status, roleCheck.body);

  const path = normalizePath(req.params && req.params.path);
  try {
    if (String(req.method || 'GET').toUpperCase() === 'POST') {
      return handleWrite(context, req, path, roleCheck.principal);
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
          closeIncident: operationsService.featureEnabled('OPERATIONS_CLOSE_ENABLED')
        }
      });
    }

    if (path === 'incidents') {
      const incidents = filterIncidents(await sharePoint.listIncidents(1000), req.query || {});
      return jsonResponse(context, 200, { ok: true, data: { items: incidents, count: incidents.length } });
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
  const body = parseBody(req.body);
  const actionContext = {
    accessToken: token.accessToken,
    correlationId: String(req.headers && (req.headers['x-correlation-id'] || req.headers['x-ms-request-id']) || require('crypto').randomUUID()),
    operationsIdentity: {
      id: principal.userId || '',
      name: principal.userDetails || '',
      email: principal.userDetails || ''
    },
    adoIdentity: verified.identity
  };
  let data;
  if (action === 'work-items/related') data = await operationsService.createRelated({ ...body, incidentId }, actionContext);
  else if (action === 'work-items/related/batch') data = await operationsService.createRelatedBatch({ ...body, incidentId }, actionContext);
  else if (action === 'work-items/link') data = await operationsService.linkExisting({ ...body, incidentId }, actionContext);
  else if (action === 'synchronize') data = await operationsService.synchronize({ ...body, incidentId }, actionContext);
  else if (action === 'close') data = await operationsService.closeIncident({ ...body, incidentId }, actionContext);
  else return jsonResponse(context, 404, { ok: false, error: 'Operations write route not found' }, token.setCookie);
  return jsonResponse(context, 200, { ok: true, data }, token.setCookie);
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
  const needsAttention = items
    .filter(item => ['OPEN', 'PENDING', 'FAILED'].includes(item.trackingStatus) || item.hasLifecycleConflict)
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
    lifecycleConflicts: items.filter(item => item.hasLifecycleConflict).length,
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
        return (['OPEN', 'PENDING', 'FAILED'].includes(item.trackingStatus) || item.hasLifecycleConflict) && openedDate && openedDate <= selectedDate;
      }).length,
      lifecycleConflicts: items.filter(item => item.hasLifecycleConflict).length,
      incidents: dailyItems.slice(0, 25)
    },
    dailySeries: buildDailySeries(items, selectedDate, 14),
    needsAttention,
    generatedAt: new Date().toISOString()
  };
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
