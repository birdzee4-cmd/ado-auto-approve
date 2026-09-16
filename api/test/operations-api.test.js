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
  assert.equal(incident.workItemId, 12345);
  assert.equal(incident.trackingStatus, 'OPEN');
  assert.match(incident.workItemUrl, /^https:\/\/dev\.azure\.com\//);
});

test('Operations dashboard summarizes ADO tracking states', () => {
  const items = [
    { workItemId: 1, trackingStatus: 'OPEN', workflowStatus: 'CREATED' },
    { workItemId: 2, trackingStatus: 'CLOSED', workflowStatus: 'CREATED' },
    { trackingStatus: 'PENDING', workflowStatus: 'AWAITING_APPROVAL' },
    { trackingStatus: 'FAILED', workflowStatus: 'FAILED' }
  ];
  const summary = operations.dashboardSummary(items);
  assert.equal(summary.totalIncidents, 4);
  assert.equal(summary.adoWorkItems, 2);
  assert.equal(summary.openWorkItems, 1);
  assert.equal(summary.closedWorkItems, 1);
  assert.equal(summary.awaitingApproval, 1);
  assert.equal(summary.failedItems, 1);
});

test('Operations filters support tracking status and search', () => {
  const items = [
    { incidentId: 'INC-1', alertName: 'Checkout down', resource: 'checkout', trackingStatus: 'OPEN' },
    { incidentId: 'INC-2', alertName: 'Worker fixed', resource: 'worker', trackingStatus: 'CLOSED' }
  ];
  assert.deepEqual(operations.filterIncidents(items, { status: 'open', search: 'checkout' }), [items[0]]);
  assert.equal(operations.normalizePath('../health'), '');
});

test('Operations only exposes trusted Azure DevOps work-item URLs', () => {
  assert.equal(sharePoint.safeAdoUrl('javascript:alert(1)'), '');
  assert.equal(sharePoint.safeAdoUrl('https://evil.example/workitem/1'), '');
  assert.match(sharePoint.safeAdoUrl('https://buzzebees.visualstudio.com/Project/_workitems/edit/1'), /^https:/);
});
