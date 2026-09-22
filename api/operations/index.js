const auth = require('../shared/auth');
const sharePoint = require('../shared/operations-sharepoint-client');

module.exports = async function (context, req) {
  const roleCheck = auth.requireAnyRole(context, req, ['it_support_approve', 'admin']);
  if (!roleCheck.ok) return jsonResponse(context, roleCheck.status, roleCheck.body);

  const path = normalizePath(req.params && req.params.path);
  try {
    if (path === 'dashboard') {
      const incidents = await sharePoint.listIncidents(1000);
      return jsonResponse(context, 200, { ok: true, data: dashboardSummary(incidents, req.query || {}) });
    }

    if (path === 'incidents') {
      const incidents = filterIncidents(await sharePoint.listIncidents(1000), req.query || {});
      return jsonResponse(context, 200, { ok: true, data: { items: incidents, count: incidents.length } });
    }

    const detailMatch = /^incidents\/([A-Za-z0-9._:-]+)$/.exec(path);
    if (detailMatch) {
      const incident = await sharePoint.getIncident(detailMatch[1]);
      if (!incident) return jsonResponse(context, 404, { ok: false, error: 'Incident not found' });
      return jsonResponse(context, 200, {
        ok: true,
        data: { incident, timeline: buildTimeline(incident) }
      });
    }

    return jsonResponse(context, 404, { ok: false, error: 'Operations API route not found' });
  } catch (err) {
    context.log.error('Operations SharePoint API failed:', sanitizeError(err));
    return jsonResponse(context, 503, {
      ok: false,
      error: 'Operations incident store is unavailable',
      detail: 'Check the Operations Hub SharePoint List and API settings.'
    });
  }
};

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
    const haystack = [item.displayId, item.sharePointId, item.incidentId, item.alertName, item.resource, item.service, item.environment, item.workItemId, item.assignedTo]
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
    .filter(item => ['OPEN', 'PENDING', 'FAILED'].includes(item.trackingStatus))
    .sort((a, b) => incidentTimestamp(b) - incidentTimestamp(a))
    .slice(0, 8);

  return {
    totalIncidents: items.length,
    adoWorkItems: items.filter(item => Boolean(item.workItemId)).length,
    openWorkItems: items.filter(item => item.trackingStatus === 'OPEN').length,
    closedWorkItems: items.filter(item => item.trackingStatus === 'CLOSED').length,
    awaitingApproval: items.filter(item => item.workflowStatus === 'AWAITING_APPROVAL' || item.trackingStatus === 'PENDING').length,
    cancelledItems: items.filter(item => item.trackingStatus === 'CANCELLED').length,
    failedItems: items.filter(item => item.trackingStatus === 'FAILED').length,
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
        return item.trackingStatus === 'OPEN' && openedDate && openedDate <= selectedDate;
      }).length,
      incidents: dailyItems.slice(0, 25)
    },
    dailySeries: buildDailySeries(items, selectedDate, 14),
    needsAttention,
    generatedAt: new Date().toISOString()
  };
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
  addTimeline(events, incident.resolvedAt, 'ALERT_RESOLVED', 'RESOLVED', incident.durationMinutes == null ? 'Monitoring reported recovery.' : `Recovered after ${incident.durationMinutes} minutes.`);
  addTimeline(events, incident.adoClosedAt, 'ADO_WORK_ITEM_CLOSED', incident.adoState || 'CLOSED', 'Azure DevOps work item closed.');
  addTimeline(events, incident.lastSyncedAt, 'LAST_SYNCED', incident.workflowStatus || 'SYNCED', incident.errorDetail || 'Latest status synchronized from Power Automate.');
  return events.sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
}

function addTimeline(events, timestamp, eventType, result, detail) {
  if (!timestamp) return;
  events.push({ eventId: `${eventType}:${timestamp}`, timestamp, eventType, result, detail });
}

function jsonResponse(context, status, payload) {
  context.res = {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    body: JSON.stringify(payload)
  };
}

function sanitizeError(err) {
  return { name: err && err.name, code: err && err.code, message: err && err.message };
}

module.exports.dashboardSummary = dashboardSummary;
module.exports.filterIncidents = filterIncidents;
module.exports.normalizePath = normalizePath;
