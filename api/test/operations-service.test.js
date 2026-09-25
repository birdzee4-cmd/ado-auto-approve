const assert = require('node:assert/strict');
const test = require('node:test');
const service = require('../shared/operations-service');
const reconcile = require('../operations-reconcile');

function withFlags(flags, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(flags)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  return Promise.resolve().then(fn).finally(() => {
    for (const key of Object.keys(flags)) {
      if (previous[key] == null) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

const incident = {
  sharePointId: 31,
  displayId: 'INC-2026-000031',
  incidentId: 'INC-031',
  alertName: 'Checkout failure',
  severity: 'CRITICAL',
  priority: 'P1',
  service: 'Checkout API',
  resource: 'prd-checkout',
  environment: 'Production',
  subscription: 'Buzzebees Thailand',
  resourceGroup: 'default-prd-th-apiservices-all-group',
  appServicePlan: 'prd-th-appserviceplan-apiservices17',
  defaultHost: 'prd-checkout.azurewebsites.net',
  metric: 'Http5xxRate',
  currentValue: '12.25',
  thresholdDetail: 'HTTP 5xx Rate > 5% AND 5xx Count >= 10',
  alertSummary: 'Azure App Service high 5xx rate critical',
  firstSeen: '2026-09-24T13:24:00.000Z',
  status: 'FIRING',
  workItemId: 9101,
  workItems: [{ workItemId: 9101, role: 'PRIMARY', supportTeam: 'TIER1', state: 'Active' }],
  workItemSummary: { total: 1, closed: 0, open: 1 },
};

const mapping = {
  mappingId: 'checkout-app',
  service: 'Checkout API',
  environment: 'Production',
  supportTeam: 'APP_SUPPORT',
  adoProject: 'Buzzebees',
  workItemType: 'Task',
  areaPath: 'Buzzebees\\Application Support',
  iterationPath: 'Buzzebees',
  assignedTeam: 'App Support',
  defaultTags: 'P1',
  enabled: true,
  priority: 10
};

const actionContext = {
  accessToken: 'delegated-token',
  correlationId: 'correlation-1',
  operationsIdentity: { id: 'ops-id', name: 'Tier One', email: 'tier1@example.com' },
  adoIdentity: { id: 'ado-id', displayName: 'Tier One ADO', email: 'tier1.ado@example.com' }
};

test('mapping resolution is deterministic and mapping-only', () => {
  const lowerPriority = { ...mapping, mappingId: 'lower', priority: 1 };
  assert.equal(service.resolveMapping([lowerPriority, mapping], incident, 'APP_SUPPORT').mappingId, 'checkout-app');
  assert.throws(() => service.resolveMapping([mapping], incident, 'TIER2'), error => error.code === 'MAPPING_NOT_FOUND');
  assert.throws(() => service.resolveMapping([{ ...mapping, assignedTeam: '' }], incident, 'APP_SUPPORT'), error => error.code === 'MAPPING_INCOMPLETE');
});

test('work-item patch uses mapped fields and a Related relation', () => {
  const patches = service.buildCreatePatches(incident, mapping, { detail: '<unsafe>' }, 9101, 'Buzzebees');
  const description = patches.find(item => item.path === '/fields/System.Description').value;
  assert.ok(patches.some(item => item.path === '/fields/System.AreaPath' && item.value === mapping.areaPath));
  assert.ok(patches.some(item => item.path === '/fields/System.AssignedTo' && item.value === mapping.assignedTeam));
  assert.ok(patches.some(item => item.path === '/relations/-' && item.value.rel === 'System.LinkTypes.Related'));
  assert.ok(description.includes('CRITICAL / P1'));
  assert.ok(description.includes('Buzzebees Thailand'));
  assert.ok(description.includes('default-prd-th-apiservices-all-group'));
  assert.ok(description.includes('HTTP 5xx Rate &gt; 5% AND 5xx Count &gt;= 10'));
  assert.ok(description.includes('prd-checkout.azurewebsites.net'));
  assert.ok(description.includes('24/09/2026 20:24 น.'));
  assert.ok(description.includes('&lt;unsafe&gt;'));
  assert.ok(!description.includes('Resolved At'), 'FIRING alert has no resolution timestamp');
  const resolved = service.buildCreatePatches({ ...incident, status: 'RESOLVED', resolvedAt: '2026-09-24T13:44:00.000Z' }, mapping, {}, 9101, 'Buzzebees');
  const resolvedDescription = resolved.find(item => item.path === '/fields/System.Description').value;
  assert.ok(resolvedDescription.includes('Current Alert State:</strong> RESOLVED'));
  assert.equal((resolvedDescription.match(/First Seen:/g) || []).length, 1);
  assert.equal((resolvedDescription.match(/Resolved At:/g) || []).length, 1);
  assert.ok(resolvedDescription.includes('24/09/2026 20:44 น.'));
});

test('create related work item uses delegated identity, persists mapping output, and audits both identities', async () => {
  await withFlags({ OPERATIONS_CREATE_ENABLED: 'true' }, async () => {
    const writes = { records: [], audits: [] };
    const sharePoint = {
      async getIncident() { return incident; },
      async listMappings() { return [mapping]; },
      async listConfiguredWorkItems() { return []; },
      async createWorkItemRecord(fields) { writes.records.push(fields); },
      async appendAudit(fields) { writes.audits.push(fields); }
    };
    const ado = {
      getConfig() { return { org: 'Buzzebees' }; },
      async createWorkItem(project, type, patches, options) {
        assert.equal(project, mapping.adoProject);
        assert.equal(type, mapping.workItemType);
        assert.equal(options.accessToken, 'delegated-token');
        assert.ok(patches.some(item => item.path === '/relations/-'));
        return { ok: true, status: 200, body: { id: 9102, fields: { 'System.Title': 'App task', 'System.State': 'New' }, _links: { html: { href: 'https://dev.azure.com/Buzzebees/_workitems/edit/9102' } } } };
      }
    };
    const result = await service.createRelated({ incidentId: incident.incidentId, supportTeam: 'APP_SUPPORT', idempotencyKey: 'request-1' }, actionContext, { sharePoint, ado });
    assert.equal(result.workItem.role, 'RELATED');
    assert.equal(writes.records[0].SupportTeam, 'APP_SUPPORT');
    assert.equal(writes.audits[0].OperationsUserEmail, 'tier1@example.com');
    assert.equal(writes.audits[0].AdoIdentityEmail, 'tier1.ado@example.com');
  });
});

test('idempotent create returns the stored work item without calling Azure DevOps', async () => {
  await withFlags({ OPERATIONS_CREATE_ENABLED: 'true' }, async () => {
    const key = service.makeIdempotencyKey(incident.incidentId, 'APP_SUPPORT', 'same-request');
    const stored = { incidentId: incident.incidentId, workItemId: 9102, idempotencyKey: key };
    const sharePoint = {
      async getIncident() { return incident; },
      async listMappings() { return [mapping]; },
      async listConfiguredWorkItems() { return [stored]; },
      async appendAudit() {}
    };
    const ado = { getConfig() { throw new Error('ADO must not be called'); } };
    const result = await service.createRelated({ incidentId: incident.incidentId, supportTeam: 'APP_SUPPORT', idempotencyKey: 'same-request' }, actionContext, { sharePoint, ado });
    assert.equal(result.duplicate, true);
    assert.equal(result.workItem.workItemId, 9102);
  });
});

test('closure policy requires a primary and all work items closed, without recovery confirmation', () => {
  assert.deepEqual(service.closeEligibility(incident), {
    allowed: false,
    blockingWorkItems: [9101],
    reasons: ['All work items must be closed']
  });
  const eligible = service.closeEligibility({
    ...incident,
    workItems: [{ workItemId: 9101, role: 'PRIMARY', state: 'Closed' }]
  });
  assert.equal(eligible.allowed, true);
});

test('link existing validates ADO, adds Related relation, persists, and audits', async () => {
  await withFlags({ OPERATIONS_LINK_ENABLED: 'true' }, async () => {
    const records = [];
    const audits = [];
    const sharePoint = {
      async getIncident() { return incident; },
      async listConfiguredWorkItems() { return []; },
      async createWorkItemRecord(fields) { records.push(fields); },
      async appendAudit(fields) { audits.push(fields); }
    };
    const ado = {
      async getWorkItem(id, options) {
        assert.equal(id, 9201);
        assert.equal(options.accessToken, 'delegated-token');
        return { ok: true, body: { id, fields: { 'System.Title': 'Existing task', 'System.State': 'Active' }, _links: { html: { href: `https://dev.azure.com/Buzzebees/_workitems/edit/${id}` } } } };
      },
      async addRelatedWorkItemLink(id, primaryId) {
        assert.equal(id, 9201);
        assert.equal(primaryId, 9101);
        return { ok: true, status: 200 };
      }
    };
    const result = await service.linkExisting({ incidentId: incident.incidentId, supportTeam: 'TIER2', workItemId: 9201 }, actionContext, { sharePoint, ado });
    assert.equal(result.workItem.role, 'RELATED');
    assert.equal(records[0].SupportTeam, 'TIER2');
    assert.equal(audits[0].Action, 'LINK_EXISTING_WORK_ITEM');
  });
});

test('synchronize updates primary and related stores independently', async () => {
  await withFlags({ OPERATIONS_SYNC_ENABLED: 'true' }, async () => {
    const incidentUpdates = [];
    const relatedUpdates = [];
    const multi = {
      ...incident,
      workItems: [
        { workItemId: 9101, role: 'PRIMARY', state: 'Active' },
        { sharePointId: 44, workItemId: 9102, role: 'RELATED', supportTeam: 'APP_SUPPORT', state: 'Active' }
      ]
    };
    const sharePoint = {
      async getIncident() { return multi; },
      async updateIncidentRecord(id, fields) { incidentUpdates.push({ id, fields }); },
      async updateWorkItemRecord(id, fields) { relatedUpdates.push({ id, fields }); },
      async appendAudit() {}
    };
    const ado = {
      async getWorkItem(id) { return { ok: true, body: { id, fields: { 'System.State': 'Closed', 'Microsoft.VSTS.Common.ClosedDate': '2026-09-24T08:00:00Z' } } }; }
    };
    const result = await service.synchronize({ incidentId: incident.incidentId }, actionContext, { sharePoint, ado });
    assert.equal(result.items.length, 2);
    assert.equal(incidentUpdates[0].id, 31);
    assert.equal(incidentUpdates[0].fields.AdoState, 'Closed');
    assert.equal(relatedUpdates[0].id, 44);
    assert.equal(relatedUpdates[0].fields.State, 'Closed');
  });
});

test('close synchronizes current ADO state and succeeds without the standalone sync flag', async () => {
  await withFlags({ OPERATIONS_SYNC_ENABLED: 'false', OPERATIONS_CLOSE_ENABLED: 'true' }, async () => {
    const updates = [];
    const readyToClose = {
      ...incident,
      workItems: [{ workItemId: 9101, role: 'PRIMARY', state: 'Closed' }],
      workItemSummary: { total: 1, closed: 1, open: 0 }
    };
    const sharePoint = {
      async getIncident() { return readyToClose; },
      async updateIncidentRecord(id, fields) {
        updates.push({ id, fields });
      },
      async appendAudit() {}
    };
    const ado = { async getWorkItem(id) { return { ok: true, body: { id, fields: { 'System.State': 'Closed' } } }; } };
    const result = await service.closeIncident({ incidentId: incident.incidentId }, actionContext, { sharePoint, ado });
    assert.equal(result.closed, true);
    assert.ok(updates.some(item => item.fields.OperationsStatus === 'CLOSED'));
    assert.equal(updates.some(item => Object.hasOwn(item.fields, 'RecoveryConfirmed')), false);
    assert.equal(updates.some(item => Object.hasOwn(item.fields, 'WorkflowStatus')), false);
  });
});

test('close is blocked if any Work Item latest state cannot be verified', async () => {
  await withFlags({ OPERATIONS_SYNC_ENABLED: 'false', OPERATIONS_CLOSE_ENABLED: 'true' }, async () => {
    const sharePoint = {
      async getIncident() { return { ...incident, workItems: [{ workItemId: 9101, role: 'PRIMARY', state: 'Closed' }] }; },
      async updateIncidentRecord() { assert.fail('Incident must not be closed with an unverified state'); },
      async appendAudit() {}
    };
    const ado = { async getWorkItem() { return { ok: false, status: 503 }; } };
    await assert.rejects(
      service.closeIncident({ incidentId: incident.incidentId }, actionContext, { sharePoint, ado }),
      error => error.code === 'WORK_ITEM_SYNC_FAILED' && error.status === 502
    );
  });
});

test('automation key comparison fails closed', () => {
  const previous = process.env.OPERATIONS_AUTOMATION_KEY;
  process.env.OPERATIONS_AUTOMATION_KEY = 'expected-key';
  try {
    assert.equal(reconcile.authorized({ headers: {} }), false);
    assert.equal(reconcile.authorized({ headers: { 'x-operations-automation-key': 'wrong-key' } }), false);
    assert.equal(reconcile.authorized({ headers: { 'x-operations-automation-key': 'expected-key' } }), true);
  } finally {
    if (previous == null) delete process.env.OPERATIONS_AUTOMATION_KEY;
    else process.env.OPERATIONS_AUTOMATION_KEY = previous;
  }
});

test('reconciliation notifications have stable duplicate keys', () => {
  const relatedOpen = {
    ...incident,
    workItems: [
      { workItemId: 9101, role: 'PRIMARY', state: 'Closed' },
      { workItemId: 9102, role: 'RELATED', state: 'Active' }
    ],
    workItemSummary: { total: 2, closed: 1, open: 1 }
  };
  const first = reconcile.notificationCandidate(relatedOpen, 0);
  const second = reconcile.notificationCandidate(relatedOpen, 0);
  assert.equal(first.type, 'RELATED_WORK_REMAINS');
  assert.equal(first.eventKey, second.eventKey);

  const allClosed = reconcile.notificationCandidate({
    ...relatedOpen,
    workItems: relatedOpen.workItems.map(item => ({ ...item, state: 'Closed' })),
    workItemSummary: { total: 2, closed: 2, open: 0 },
  }, 0);
  assert.equal(allClosed, null);
});
