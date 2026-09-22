const assert = require('node:assert/strict');
const test = require('node:test');
const operations = require('../operations');
const sharePoint = require('../shared/operations-sharepoint-client');

function principal(roles) {
  return Buffer.from(JSON.stringify({ userId: 'operator', userRoles: roles })).toString('base64');
}

test('Operations API rejects unauthenticated and unauthorized requests', async () => {
  const unauthenticated = {};
  await operations(unauthenticated, { headers: {}, params: { path: 'dashboard' }, query: {} });
  assert.equal(unauthenticated.res.status, 401);

  const forbidden = { log: { warn() {} } };
  await operations(forbidden, {
    headers: { 'x-ms-client-principal': principal(['authenticated']) },
    params: { path: 'dashboard' },
    query: {}
  });
  assert.equal(forbidden.res.status, 403);
});

test('SharePoint incident mapping derives safe dashboard fields', () => {
  const incident = sharePoint.mapSharePointIncident({
    id: '12',
    createdDateTime: '2026-09-16T01:00:00Z',
    lastModifiedDateTime: '2026-09-16T02:00:00Z',
    fields: {
      IncidentId: 'INC-001',
      Title: 'API latency alert',
      Service: 'Checkout API',
      Priority: 'P1',
      AlertStatus: 'FIRING',
      WorkflowStatus: 'CREATED',
      AdoWorkItemId: '12345',
      AdoWorkItemUrl: 'https://dev.azure.com/Buzzebees/Buzzebees/_workitems/edit/12345',
      AdoState: 'Active'
    }
  });

  assert.equal(incident.incidentId, 'INC-001');
  assert.equal(incident.sharePointId, 12);
  assert.equal(incident.displayId, 'INC-2026-000012');
  assert.equal(incident.createdAt, '2026-09-16T01:00:00.000Z');
  assert.equal(incident.workItemId, 12345);
  assert.equal(incident.trackingStatus, 'OPEN');
  assert.match(incident.workItemUrl, /^https:\/\/dev\.azure\.com\//);
});

test('Incident display IDs use SharePoint ID with six-digit padding', () => {
  assert.equal(sharePoint.formatIncidentDisplayId({
    id: '1',
    fields: { FirstSeenAt: '2026-01-15T08:00:00+07:00' }
  }), 'INC-2026-000001');
  assert.equal(sharePoint.formatIncidentDisplayId({
    id: '27',
    fields: { FirstSeenAt: '2026-09-21T13:24:00+07:00' }
  }), 'INC-2026-000027');
  assert.equal(sharePoint.formatIncidentDisplayId({
    id: '123456',
    fields: { FirstSeenAt: '2027-02-01T00:00:00+07:00' }
  }), 'INC-2027-123456');
});

test('Incident display ID year falls back from FirstSeenAt to Created and current year', () => {
  assert.equal(sharePoint.formatIncidentDisplayId({
    id: '27',
    createdDateTime: '2025-12-31T18:30:00Z',
    fields: { FirstSeenAt: '2026-01-01T00:30:00+07:00' }
  }), 'INC-2026-000027');
  assert.equal(sharePoint.formatIncidentDisplayId({
    id: '28',
    createdDateTime: '2027-04-10T02:00:00Z',
    fields: { FirstSeenAt: 'not-a-date' }
  }), 'INC-2027-000028');
  assert.equal(sharePoint.formatIncidentDisplayId({ fields: {} }, new Date('2028-06-01T00:00:00Z')), 'INC-2028-UNKNOWN');
});

test('Operations dashboard summarizes ADO tracking states', () => {
  const items = [
    { workItemId: 1, trackingStatus: 'OPEN', workflowStatus: 'CREATED' },
    { workItemId: 2, trackingStatus: 'CLOSED', workflowStatus: 'CREATED' },
    { trackingStatus: 'PENDING', workflowStatus: 'AWAITING_APPROVAL' },
    { trackingStatus: 'CANCELLED', workflowStatus: 'CANCELLED' },
    { trackingStatus: 'FAILED', workflowStatus: 'FAILED' }
  ];
  const summary = operations.dashboardSummary(items);
  assert.equal(summary.totalIncidents, 5);
  assert.equal(summary.adoWorkItems, 2);
  assert.equal(summary.openWorkItems, 1);
  assert.equal(summary.closedWorkItems, 1);
  assert.equal(summary.awaitingApproval, 1);
  assert.equal(summary.cancelledItems, 1);
  assert.equal(summary.failedItems, 1);
});

test('Operations dashboard provides a Bangkok daily brief and 14-day series', () => {
  const items = [
    { incidentId: 'a', firstSeen: '2026-09-21T17:30:00Z', resolvedAt: '2026-09-22T02:00:00Z', trackingStatus: 'CLOSED', workflowStatus: 'CREATED', adoCreatedAt: '2026-09-22T01:00:00Z' },
    { incidentId: 'b', receivedAt: '2026-09-22T08:00:00+07:00', trackingStatus: 'PENDING', workflowStatus: 'AWAITING_APPROVAL' },
    { incidentId: 'c', firstSeen: '2026-09-21T12:00:00Z', trackingStatus: 'OPEN', workflowStatus: 'CREATED' }
  ];
  const summary = operations.dashboardSummary(items, { date: '2026-09-22' }, new Date('2026-09-22T06:00:00Z'));
  assert.equal(summary.selectedDate, '2026-09-22');
  assert.equal(summary.daily.newIncidents, 2);
  assert.equal(summary.daily.resolvedIncidents, 1);
  assert.equal(summary.daily.adoCreated, 1);
  assert.equal(summary.daily.pendingApproval, 1);
  assert.equal(summary.dailySeries.length, 14);
  assert.equal(summary.dailySeries.at(-1).date, '2026-09-22');
  assert.equal(operations.dashboardSummary(items, { date: '2026-02-31' }, new Date('2026-09-22T06:00:00Z')).selectedDate, '2026-09-22');
});

test('SharePoint mapping keeps monitoring timestamps distinct and derives environment', () => {
  const incident = sharePoint.mapSharePointIncident({
    id: '13',
    createdDateTime: '2026-09-17T12:00:00Z',
    lastModifiedDateTime: '2026-09-17T12:30:00Z',
    fields: {
      IncidentId: 'INC-002',
      Title: 'AzureAppServiceHigh5xxRateCritical',
      Resource: 'prd-web-example',
      AlertStatus: 'RESOLVED',
      WorkflowStatus: 'CANCELLED',
      ReceivedAt: '2026-09-17T12:01:00Z',
      FirstSeenAt: '2026-09-17T12:00:00Z',
      ResolvedAt: '2026-09-17T12:20:00Z',
      OccurrenceCount: '2'
    }
  });

  assert.equal(incident.firstSeen, '2026-09-17T12:00:00.000Z');
  assert.equal(incident.resolvedAt, '2026-09-17T12:20:00.000Z');
  assert.equal(incident.durationMinutes, 20);
  assert.equal(incident.receivedAt, '2026-09-17T12:01:00.000Z');
  assert.equal(incident.environment, 'Production');
  assert.equal(incident.occurrenceCount, 2);
  assert.equal(incident.trackingStatus, 'CANCELLED');
});

test('Incident duration rejects missing or non-forward timestamps', () => {
  assert.equal(sharePoint.durationMinutes('2026-09-17T12:00:00Z', '2026-09-17T12:20:00Z'), 20);
  assert.equal(sharePoint.durationMinutes('2026-09-17T12:20:00Z', '2026-09-17T12:00:00Z'), undefined);
  assert.equal(sharePoint.durationMinutes('', '2026-09-17T12:00:00Z'), undefined);
});

test('Environment is inferred from the supported resource prefixes', () => {
  assert.equal(sharePoint.inferEnvironment('prd-web-api'), 'Production');
  assert.equal(sharePoint.inferEnvironment('stg-worker'), 'Staging');
  assert.equal(sharePoint.inferEnvironment('uat-checkout'), 'UAT');
  assert.equal(sharePoint.inferEnvironment('dev-portal'), 'Development');
  assert.equal(sharePoint.inferEnvironment('shared-service'), 'Unknown');
});

test('Operations filters support tracking status and search', () => {
  const items = [
    { sharePointId: 27, displayId: 'INC-2026-000027', incidentId: 'inc-20260921132400-checkout-api', alertName: 'Checkout down', resource: 'checkout', trackingStatus: 'OPEN' },
    { sharePointId: 28, displayId: 'INC-2026-000028', incidentId: 'inc-20260921140000-worker', alertName: 'Worker fixed', resource: 'worker', trackingStatus: 'CLOSED' }
  ];
  assert.deepEqual(operations.filterIncidents(items, { status: 'open', search: 'checkout' }), [items[0]]);
  assert.deepEqual(operations.filterIncidents(items, { search: 'inc-2026-000027' }), [items[0]]);
  assert.deepEqual(operations.filterIncidents(items, { search: '27' }), [items[0]]);
  assert.deepEqual(operations.filterIncidents(items, { search: 'INC-20260921132400-CHECKOUT-API' }), [items[0]]);
  assert.deepEqual(operations.filterIncidents(items, { status: 'closed' }), [items[1]]);
  assert.equal(operations.normalizePath('../health'), '');
});

test('Operations only exposes trusted Azure DevOps work-item URLs', () => {
  assert.equal(sharePoint.safeAdoUrl('javascript:alert(1)'), '');
  assert.equal(sharePoint.safeAdoUrl('https://evil.example/workitem/1'), '');
  assert.match(sharePoint.safeAdoUrl('https://buzzebees.visualstudio.com/Project/_workitems/edit/1'), /^https:/);
});
