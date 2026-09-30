const assert = require('node:assert/strict');
const test = require('node:test');
const service = require('../shared/operations-service');
const reconcile = require('../operations-reconcile');
const operationsSharePoint = require('../shared/operations-sharepoint-client');

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
  assert.doesNotThrow(() => service.resolveMapping([{ ...mapping, assignedTeam: '' }], incident, 'APP_SUPPORT'));
  assert.throws(() => service.resolveMapping([{ ...mapping, supportTeam: 'TIER2', assignedTeam: '' }], incident, 'TIER2'), error => error.code === 'MAPPING_INCOMPLETE');
});

test('work-item patch uses mapped fields and a Related relation', () => {
  const patches = service.buildCreatePatches(incident, mapping, { detail: '<unsafe>' }, 9101, 'Buzzebees');
  assert.equal(patches.find(item => item.path === '/fields/System.Title').value, '[INC-2026-000031] Checkout failure | prd-checkout');
  const description = patches.find(item => item.path === '/fields/System.Description').value;
  assert.ok(patches.some(item => item.path === '/fields/System.AreaPath' && item.value === mapping.areaPath));
  assert.ok(patches.some(item => item.path === '/fields/System.AssignedTo' && item.value === mapping.assignedTeam));
  assert.equal(patches.find(item => item.path === '/fields/System.Tags').value, 'P1');
  assert.ok(!patches.find(item => item.path === '/fields/System.Tags').value.includes('OperationsHub'));
  assert.ok(!patches.find(item => item.path === '/fields/System.Tags').value.includes(incident.displayId));
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

test('App Support profile matches the required Production Service Form fields', () => {
  const appMapping = {
    ...mapping,
    workItemType: 'Service Form',
    areaPath: 'Buzzebees\\Other\\IT Support Team',
    assignedTeam: '',
    defaultTags: 'appsupport_pool; ITSupport_Pool'
  };
  const patches = service.buildCreatePatches(incident, appMapping, {}, 9101, 'Buzzebees', {
    fields: { 'System.Description': '<p>Exact primary description</p>' }
  });
  const field = name => patches.find(item => item.path === `/fields/${name}`)?.value;
  assert.equal(field('System.Description'), '<p>Exact primary description</p>');
  assert.equal(field('Custom.RequestType'), 'Incident/Issue');
  assert.equal(field('Custom.SeverityIncidentIssue'), 'Severity-2');
  assert.equal(field('Custom.Deadline'), '2026-09-26T17:00:00.000Z');
  assert.equal(field('Custom.ServicePriority'), '2-High');
  assert.equal(field('Custom.Country'), 'Thai');
  assert.equal(field('Custom.GroupsofSubject'), 'อื่น ๆ (Other)');
  assert.equal(field('Custom.MonitoringSourceTracker'), 'Not Applicable (N/A)');
  assert.equal(field('Custom.ActualIncidentTime'), incident.firstSeen);
  assert.equal(field('System.AssignedTo'), undefined);
  assert.equal(field('System.Tags'), 'appsupport_pool; ITSupport_Pool');
});

test('Tier 2 profile clones the verified IT Support Case fields from Tier 1', () => {
  const tier2Mapping = {
    ...mapping,
    supportTeam: 'TIER2',
    workItemType: 'IT Support Case',
    areaPath: 'Buzzebees\\Other\\IT Support Team',
    assignedTeam: 'ITSupport Admin'
  };
  const primaryFields = {
    'System.Description': '<p>Exact Tier 1 description</p>',
    'Custom.Environment': 'Production',
    'Custom.ApprovalStatus': 'Approve',
    'Custom.Permission': 'None',
    'Custom.Owner': 'Poon',
    'Custom.ImpactCase': 'Incident',
    'Custom.PriorityCase': '1-Critical',
    'Custom.TYPE_ALL': 'Problem Server',
    'Custom.SUBTYPE': 'Problem Server',
    'Custom.41f3ce19-9c22-4dda-95b0-f8d89964dfda': 'Support Request',
    'Custom.TypeVSTS': 'Standard'
  };
  const patches = service.buildCreatePatches(incident, tier2Mapping, {}, 9101, 'Buzzebees', { fields: primaryFields });
  for (const [name, value] of Object.entries(primaryFields)) {
    assert.equal(patches.find(item => item.path === `/fields/${name}`)?.value, value);
  }
  assert.equal(patches.find(item => item.path === '/fields/System.AssignedTo')?.value, 'ITSupport Admin');
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
      async getWorkItem(id, options) {
        assert.equal(id, 9101);
        assert.equal(options.accessToken, 'delegated-token');
        return { ok: true, body: { id, fields: { 'System.Description': '<p>Primary description</p>' } } };
      },
      async createWorkItem(project, type, patches, options) {
        assert.equal(project, mapping.adoProject);
        assert.equal(type, mapping.workItemType);
        assert.equal(options.accessToken, 'delegated-token');
        assert.ok(patches.some(item => item.path === '/relations/-'));
        assert.ok(patches.some(item => item.path === '/fields/System.Description' && item.value === '<p>Primary description</p>'));
        return { ok: true, status: 200, body: { id: 9102, fields: { 'System.Title': 'App task', 'System.State': 'New', 'System.AssignedTo': { displayName: 'App Support Agent' } }, _links: { html: { href: 'https://dev.azure.com/Buzzebees/_workitems/edit/9102' } } } };
      }
    };
    const result = await service.createRelated({ incidentId: incident.incidentId, supportTeam: 'APP_SUPPORT', idempotencyKey: 'request-1' }, actionContext, { sharePoint, ado });
    assert.equal(result.workItem.role, 'RELATED');
    assert.equal(writes.records[0].SupportTeam, 'APP_SUPPORT');
    assert.equal(writes.records[0].AssignedTo, 'App Support Agent');
    assert.equal(writes.records[0].WorkItemUrl, 'https://dev.azure.com/Buzzebees/_workitems/edit/9102');
    assert.equal(writes.audits[0].OperationsUserEmail, 'tier1@example.com');
    assert.equal(writes.audits[0].AdoIdentityEmail, 'tier1.ado@example.com');
  });
});

test('create persists the mapped assignee when the ADO create response omits identity fields', async () => {
  await withFlags({ OPERATIONS_CREATE_ENABLED: 'true' }, async () => {
    const records = [];
    const tier2Mapping = { ...mapping, supportTeam: 'TIER2', assignedTeam: 'ITSupport Admin' };
    const sharePoint = {
      async getIncident() { return incident; },
      async listMappings() { return [tier2Mapping]; },
      async listConfiguredWorkItems() { return []; },
      async createWorkItemRecord(fields) { records.push(fields); },
      async appendAudit() {}
    };
    const ado = {
      getConfig() { return { org: 'Buzzebees' }; },
      async getWorkItem() { return { ok: true, status: 200, body: { id: 9101, fields: {} } }; },
      async createWorkItem() { return { ok: true, status: 200, body: { id: 9103, fields: { 'System.Title': 'Tier 2 task', 'System.State': 'New' } } }; }
    };

    await service.createRelated({ incidentId: incident.incidentId, supportTeam: 'TIER2', idempotencyKey: 'tier2-request' }, actionContext, { sharePoint, ado });

    assert.equal(records[0].AssignedTo, 'ITSupport Admin');
    assert.equal(records[0].WorkItemUrl, 'https://dev.azure.com/Buzzebees/Buzzebees/_workitems/edit/9103');
  });
});

test('related ticket preview reads the primary description without creating or writing records', async () => {
  const sharePoint = { async getIncident() { return incident; }, async listMappings() { return [mapping]; } };
  const ado = {
    getConfig() { return { org: 'Buzzebees' }; },
    async getWorkItem(id, options) {
      assert.equal(id, incident.workItemId);
      assert.equal(options.accessToken, actionContext.accessToken);
      return { ok: true, status: 200, body: { id, fields: { 'System.Description': '<p><strong>Alert:</strong> Checkout failure</p>' } } };
    },
    async createWorkItem() { throw new Error('Preview must not create a work item'); }
  };
  const result = await service.previewRelatedBatch({ incidentId: incident.incidentId, supportTeams: ['APP_SUPPORT'] }, actionContext, { sharePoint, ado });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].description, '<p><strong>Alert:</strong> Checkout failure</p>');
  assert.equal(result.results[0].descriptionText, 'Alert: Checkout failure');
  assert.equal(result.results[0].tags, 'P1');
  assert.equal(result.results[0].primaryWorkItemId, 9101);
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

test('one related work item per team is enforced across different request keys', async () => {
  await withFlags({ OPERATIONS_CREATE_ENABLED: 'true' }, async () => {
    const stored = {
      incidentId: incident.incidentId,
      workItemId: 9102,
      supportTeam: 'APP_SUPPORT',
      idempotencyKey: service.makeIdempotencyKey(incident.incidentId, 'APP_SUPPORT', 'first-request')
    };
    const audits = [];
    const sharePoint = {
      async getIncident() { return incident; },
      async listMappings() { return [mapping]; },
      async listConfiguredWorkItems() { return [stored]; },
      async appendAudit(fields) { audits.push(fields); }
    };
    const ado = { getConfig() { throw new Error('ADO must not be called for an existing team ticket'); } };
    const result = await service.createRelated({
      incidentId: incident.incidentId,
      supportTeam: 'APP_SUPPORT',
      idempotencyKey: 'different-request'
    }, actionContext, { sharePoint, ado });

    assert.equal(result.duplicate, true);
    assert.equal(result.workItem.workItemId, 9102);
    assert.equal(audits[0].Result, 'EXISTING_TEAM_WORK_ITEM');
  });
});

test('closure policy requires a primary and all work items closed, while unresolved monitoring is an audited warning', () => {
  const blocked = service.closeEligibility(incident);
  assert.equal(blocked.allowed, false);
  assert.deepEqual(blocked.blockingWorkItems, [9101]);
  assert.equal(blocked.readinessStatus, 'TIER1_INVESTIGATING');
  assert.ok(blocked.reasons.includes('TIER1 #9101 is Active'));
  assert.ok(blocked.warnings.includes('Monitoring alert is not RESOLVED; manual closure will be recorded in the audit trail'));
  const manualEligible = service.closeEligibility({
    ...incident,
    status: 'FIRING',
    workItems: [{ workItemId: 9101, role: 'PRIMARY', state: 'Closed' }]
  });
  assert.equal(manualEligible.allowed, true);
  assert.equal(manualEligible.readinessStatus, 'READY_TO_CLOSE_WITH_WARNING');
  const eligible = service.closeEligibility({
    ...incident,
    status: 'RESOLVED',
    workItems: [{ workItemId: 9101, role: 'PRIMARY', state: 'Closed' }]
  });
  assert.equal(eligible.allowed, true);
  assert.equal(eligible.readinessStatus, 'READY_TO_CLOSE');
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
    assert.equal(Object.hasOwn(records[0], 'ClosedAt'), false);
    assert.equal(Object.values(records[0]).some(value => value == null), false);
    assert.equal(audits[0].Action, 'LINK_EXISTING_WORK_ITEM');
  });
});

test('link existing rejects a work item already tracked by another incident', async () => {
  await withFlags({ OPERATIONS_LINK_ENABLED: 'true' }, async () => {
    const sharePoint = {
      async getIncident() { return incident; },
      async listConfiguredWorkItems() { return [{ incidentId: 'INC-OTHER', workItemId: 9201, supportTeam: 'TIER2' }]; }
    };
    const ado = { async getWorkItem() { throw new Error('ADO must not be called'); } };
    await assert.rejects(
      service.linkExisting({ incidentId: incident.incidentId, supportTeam: 'TIER2', workItemId: 9201 }, actionContext, { sharePoint, ado }),
      error => error.code === 'WORK_ITEM_ALREADY_TRACKED'
    );
  });
});

test('link existing enforces one related work item per incident team', async () => {
  await withFlags({ OPERATIONS_LINK_ENABLED: 'true' }, async () => {
    const sharePoint = {
      async getIncident() { return incident; },
      async listConfiguredWorkItems() { return [{ incidentId: incident.incidentId, workItemId: 9200, supportTeam: 'TIER2' }]; }
    };
    const ado = { async getWorkItem() { throw new Error('ADO must not be called'); } };
    await assert.rejects(
      service.linkExisting({ incidentId: incident.incidentId, supportTeam: 'TIER2', workItemId: 9201 }, actionContext, { sharePoint, ado }),
      error => error.code === 'TEAM_WORK_ITEM_EXISTS'
    );
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

test('scheduled reconciliation can synchronize related work items without rewriting primary', async () => {
  const incidentUpdates = [];
  const relatedUpdates = [];
  const requestedIds = [];
  const multi = {
    ...incident,
    workItems: [
      { workItemId: 9101, role: 'PRIMARY', state: 'Active' },
      { sharePointId: 44, workItemId: 9102, role: 'RELATED', supportTeam: 'TIER2', state: 'Active' }
    ]
  };
  const sharePoint = {
    async getIncident() { return multi; },
    async updateIncidentRecord(id, fields) { incidentUpdates.push({ id, fields }); },
    async updateWorkItemRecord(id, fields) { relatedUpdates.push({ id, fields }); },
    async appendAudit() {}
  };
  const ado = {
    async getWorkItem(id) {
      requestedIds.push(id);
      return { ok: true, body: { id, fields: { 'System.State': 'Closed' } } };
    }
  };
  const result = await service.synchronizeWorkItems({ incidentId: incident.incidentId, roles: ['RELATED'] }, actionContext, { sharePoint, ado });
  assert.deepEqual(requestedIds, [9102]);
  assert.equal(result.items.length, 1);
  assert.equal(incidentUpdates.length, 0);
  assert.equal(relatedUpdates[0].id, 44);
});

test('resolved reconciliation closes Tier 1 only after every related work item is closed', async () => {
  const writes = [];
  const audits = [];
  const resolvedIncident = {
    ...incident,
    status: 'RESOLVED',
    resolvedAt: '2026-09-28T03:56:00.000Z',
    sharePointId: 241,
    workItems: [
      { workItemId: 9101, role: 'PRIMARY', supportTeam: 'TIER1', state: 'New' },
      { workItemId: 9102, role: 'RELATED', supportTeam: 'APP_SUPPORT', state: 'Closed' },
      { workItemId: 9103, role: 'RELATED', supportTeam: 'TIER2', state: 'Closed' }
    ]
  };
  const sharePoint = {
    async getIncident() { return resolvedIncident; },
    async listAudit() { return []; },
    async updateIncidentRecord(id, fields) { writes.push({ id, fields }); },
    async appendAudit(fields) { audits.push(fields); }
  };
  let updateCalls = 0;
  const ado = {
    async updateWorkItem(id, patches) {
      updateCalls += 1;
      assert.equal(id, 9101);
      if (updateCalls === 1) {
        const resolvedComment = patches.find(item => item.path === '/fields/System.History').value;
        assert.ok(resolvedComment.includes('MONITORING ALERT RESOLVED'));
        assert.ok(resolvedComment.includes('Case ID:'));
        assert.ok(resolvedComment.includes('Incident ID:'));
        assert.ok(resolvedComment.includes('AzureAppServiceHigh5xxRateCritical') || resolvedComment.includes('Checkout failure'));
        assert.equal(patches.some(item => item.path === '/fields/System.State'), false);
      } else {
        assert.ok(patches.some(item => item.path === '/fields/System.State' && item.value === 'Closed'));
        assert.equal(patches.some(item => item.path === '/fields/System.History'), false);
      }
      return { ok: true, status: 200, body: { id, fields: { 'System.State': 'Closed', 'Microsoft.VSTS.Common.ClosedDate': '2026-09-28T04:00:00.000Z' } } };
    }
  };

  const result = await service.closeResolvedPrimaryIfReady({ incidentId: incident.incidentId }, actionContext, { sharePoint, ado });

  assert.equal(result.closed, true);
  assert.equal(result.commented, true);
  assert.equal(updateCalls, 2);
  assert.equal(writes[0].fields.AdoState, 'Closed');
  assert.deepEqual(audits.map(item => item.Action), ['ADD_RESOLVED_COMMENT_TO_TIER1', 'AUTO_CLOSE_TIER1_AFTER_RESOLVED']);
});

test('resolved reconciliation keeps Tier 1 open while a related work item remains open', async () => {
  const resolvedIncident = {
    ...incident,
    status: 'RESOLVED',
    workItems: [
      { workItemId: 9101, role: 'PRIMARY', supportTeam: 'TIER1', state: 'New' },
      { workItemId: 9102, role: 'RELATED', supportTeam: 'APP_SUPPORT', state: 'Processing' }
    ]
  };
  const audits = [];
  const sharePoint = {
    async getIncident() { return resolvedIncident; },
    async listAudit() { return []; },
    async appendAudit(fields) { audits.push(fields); }
  };
  const writes = [];
  const ado = {
    async updateWorkItem(id, patches) {
      writes.push({ id, patches });
      return { ok: true, body: { id, fields: { 'System.State': 'New' } } };
    }
  };

  const result = await service.closeResolvedPrimaryIfReady({ incidentId: incident.incidentId }, actionContext, { sharePoint, ado });

  assert.equal(result.closed, false);
  assert.equal(result.commented, true);
  assert.equal(result.reason, 'related-work-open');
  assert.deepEqual(result.blockingWorkItems, [9102]);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].patches.some(item => item.path === '/fields/System.History'));
  assert.equal(writes[0].patches.some(item => item.path === '/fields/System.State'), false);
  assert.equal(audits[0].Action, 'ADD_RESOLVED_COMMENT_TO_TIER1');
});

test('resolved reconciliation does not add the Tier 1 comment more than once', async () => {
  const resolvedIncident = {
    ...incident,
    status: 'RESOLVED',
    workItems: [
      { workItemId: 9101, role: 'PRIMARY', supportTeam: 'TIER1', state: 'New' },
      { workItemId: 9102, role: 'RELATED', supportTeam: 'TIER2', state: 'Processing' }
    ]
  };
  const sharePoint = {
    async getIncident() { return resolvedIncident; },
    async listAudit() { return [{ eventKey: `RESOLVED_TIER1_COMMENT:${incident.incidentId}:9101` }]; }
  };
  const ado = { async updateWorkItem() { throw new Error('Duplicate comment must not be written'); } };

  const result = await service.closeResolvedPrimaryIfReady({ incidentId: incident.incidentId }, actionContext, { sharePoint, ado });

  assert.equal(result.closed, false);
  assert.equal(result.commented, false);
  assert.equal(result.reason, 'related-work-open');
});

test('close synchronizes current ADO state and succeeds without the standalone sync flag', async () => {
  await withFlags({ OPERATIONS_SYNC_ENABLED: 'false', OPERATIONS_CLOSE_ENABLED: 'true' }, async () => {
    const updates = [];
    const audits = [];
    const readyToClose = {
      ...incident,
      status: 'RESOLVED',
      workItems: [{ workItemId: 9101, role: 'PRIMARY', state: 'Closed' }],
      workItemSummary: { total: 1, closed: 1, open: 0 }
    };
    const sharePoint = {
      async getIncident() { return readyToClose; },
      async updateIncidentRecord(id, fields) {
        updates.push({ id, fields });
      },
      async appendAudit(fields) { audits.push(fields); }
    };
    const ado = { async getWorkItem(id) { return { ok: true, body: { id, fields: { 'System.State': 'Closed' } } }; } };
    const result = await service.closeIncident({ incidentId: incident.incidentId }, actionContext, { sharePoint, ado });
    assert.equal(result.closed, true);
    assert.equal(updates.some(item => Object.hasOwn(item.fields, 'OperationsStatus')), false);
    assert.ok(audits.some(item => item.Action === 'INCIDENT_CLOSED' && item.Result === 'SUCCEEDED'));
  });
});

test('close is idempotent when the incident already has a successful closure audit', async () => {
  await withFlags({ OPERATIONS_SYNC_ENABLED: 'false', OPERATIONS_CLOSE_ENABLED: 'true' }, async () => {
    const audits = [];
    const alreadyClosed = {
      ...incident,
      status: 'FIRING',
      operationsStatus: 'CLOSED',
      operationsClosedAt: '2026-09-27T14:06:51.000Z',
      workItems: [{ workItemId: 9101, role: 'PRIMARY', state: 'Closed' }]
    };
    const sharePoint = {
      async getIncident() { return alreadyClosed; },
      async updateIncidentRecord() {},
      async appendAudit(fields) { audits.push(fields); }
    };
    const ado = { async getWorkItem(id) { return { ok: true, body: { id, fields: { 'System.State': 'Closed' } } }; } };
    const result = await service.closeIncident({ incidentId: incident.incidentId }, actionContext, { sharePoint, ado });
    assert.equal(result.closed, true);
    assert.equal(result.duplicate, true);
    assert.equal(result.closedAt, alreadyClosed.operationsClosedAt);
    assert.equal(audits.filter(item => item.Action === 'INCIDENT_CLOSED').length, 0);
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

test('reconciliation dry-run candidate contains only operational summary fields', () => {
  assert.deepEqual(reconcile.dryRunCandidate({
    incidentId: 'INC-031',
    displayId: 'INC-2026-000031',
    operationsStatus: 'OPEN',
    lastSyncedAt: '2026-09-25T10:00:00.000Z',
    workItemSummary: { total: 3, open: 1, closed: 2 },
    workItems: [{ workItemId: 9101 }],
    alertSummary: 'must not be returned'
  }), {
    incidentId: 'INC-031',
    displayId: 'INC-2026-000031',
    operationsStatus: 'OPEN',
    workItems: 3,
    openWorkItems: 1,
    lastSyncedAt: '2026-09-25T10:00:00.000Z'
  });
});

test('reconciliation dry-run works with write flags disabled and performs no synchronization', async () => {
  const previousKey = process.env.OPERATIONS_AUTOMATION_KEY;
  const previousFlag = process.env.OPERATIONS_RECONCILIATION_ENABLED;
  const originalListIncidents = operationsSharePoint.listIncidents;
  const originalSynchronize = service.synchronize;
  process.env.OPERATIONS_AUTOMATION_KEY = 'dry-run-key';
  process.env.OPERATIONS_RECONCILIATION_ENABLED = 'false';
  operationsSharePoint.listIncidents = async () => [{
    incidentId: 'INC-031',
    displayId: 'INC-2026-000031',
    operationsStatus: 'OPEN',
    workItemSummary: { total: 1, open: 1 },
    lastSyncedAt: ''
  }];
  service.synchronize = async () => assert.fail('dry-run must not synchronize');
  try {
    const context = { log: { warn() {}, error() {} } };
    await reconcile(context, {
      headers: { 'x-operations-automation-key': 'dry-run-key' },
      body: { dryRun: true, maxItems: 10 }
    });
    const body = JSON.parse(context.res.body);
    assert.equal(context.res.status, 200);
    assert.equal(body.dryRun, true);
    assert.equal(body.processed, 1);
    assert.equal(body.writeOperations, 0);
  } finally {
    operationsSharePoint.listIncidents = originalListIncidents;
    service.synchronize = originalSynchronize;
    if (previousKey == null) delete process.env.OPERATIONS_AUTOMATION_KEY;
    else process.env.OPERATIONS_AUTOMATION_KEY = previousKey;
    if (previousFlag == null) delete process.env.OPERATIONS_RECONCILIATION_ENABLED;
    else process.env.OPERATIONS_RECONCILIATION_ENABLED = previousFlag;
  }
});

test('reconciliation processes the oldest synchronized incidents first so small batches do not starve', async () => {
  const previousKey = process.env.OPERATIONS_AUTOMATION_KEY;
  const originalListIncidents = operationsSharePoint.listIncidents;
  process.env.OPERATIONS_AUTOMATION_KEY = 'rotation-key';
  operationsSharePoint.listIncidents = async () => [
    { incidentId: 'INC-NEW', displayId: 'INC-2026-000003', operationsStatus: 'OPEN', workItemSummary: { total: 1, open: 1 }, lastSyncedAt: '2026-09-27T09:00:00Z' },
    { incidentId: 'INC-NEVER', displayId: 'INC-2026-000001', operationsStatus: 'OPEN', workItemSummary: { total: 1, open: 1 }, lastSyncedAt: '' },
    { incidentId: 'INC-OLD', displayId: 'INC-2026-000002', operationsStatus: 'OPEN', workItemSummary: { total: 1, open: 1 }, lastSyncedAt: '2026-09-26T09:00:00Z' }
  ];
  try {
    const context = { log: { warn() {}, error() {} } };
    await reconcile(context, {
      headers: { 'x-operations-automation-key': 'rotation-key' },
      body: { dryRun: true, maxItems: 2 }
    });
    const body = JSON.parse(context.res.body);
    assert.deepEqual(body.candidates.map(item => item.incidentId), ['INC-NEVER', 'INC-OLD']);
  } finally {
    operationsSharePoint.listIncidents = originalListIncidents;
    if (previousKey == null) delete process.env.OPERATIONS_AUTOMATION_KEY;
    else process.env.OPERATIONS_AUTOMATION_KEY = previousKey;
  }
});

test('reconciliation can target one incident for controlled UAT', async () => {
  const previousKey = process.env.OPERATIONS_AUTOMATION_KEY;
  const originalListIncidents = operationsSharePoint.listIncidents;
  process.env.OPERATIONS_AUTOMATION_KEY = 'target-key';
  operationsSharePoint.listIncidents = async () => [
    { incidentId: 'INC-031', displayId: 'INC-2026-000031', operationsStatus: 'OPEN', workItemSummary: { total: 1, open: 1 } },
    { incidentId: 'INC-032', displayId: 'INC-2026-000032', operationsStatus: 'OPEN', workItemSummary: { total: 2, open: 2 } }
  ];
  try {
    const context = { log: { warn() {}, error() {} } };
    await reconcile(context, {
      headers: { 'x-operations-automation-key': 'target-key' },
      body: { dryRun: true, incidentId: 'INC-2026-000032' }
    });
    const body = JSON.parse(context.res.body);
    assert.equal(context.res.status, 200);
    assert.equal(body.processed, 1);
    assert.equal(body.candidates[0].incidentId, 'INC-032');
  } finally {
    operationsSharePoint.listIncidents = originalListIncidents;
    if (previousKey == null) delete process.env.OPERATIONS_AUTOMATION_KEY;
    else process.env.OPERATIONS_AUTOMATION_KEY = previousKey;
  }
});

test('targeted reconciliation returns 404 instead of silently processing another incident', async () => {
  const previousKey = process.env.OPERATIONS_AUTOMATION_KEY;
  const originalListIncidents = operationsSharePoint.listIncidents;
  process.env.OPERATIONS_AUTOMATION_KEY = 'target-key';
  operationsSharePoint.listIncidents = async () => [];
  try {
    const context = { log: { warn() {}, error() {} } };
    await reconcile(context, {
      headers: { 'x-operations-automation-key': 'target-key' },
      body: { dryRun: true, incidentId: 'INC-2026-999999' }
    });
    assert.equal(context.res.status, 404);
    assert.equal(JSON.parse(context.res.body).error, 'INCIDENT_NOT_FOUND');
  } finally {
    operationsSharePoint.listIncidents = originalListIncidents;
    if (previousKey == null) delete process.env.OPERATIONS_AUTOMATION_KEY;
    else process.env.OPERATIONS_AUTOMATION_KEY = previousKey;
  }
});

test('live reconciliation uses its own gate and does not require the manual sync flag', async () => {
  const previousKey = process.env.OPERATIONS_AUTOMATION_KEY;
  const previousReconcile = process.env.OPERATIONS_RECONCILIATION_ENABLED;
  const previousSync = process.env.OPERATIONS_SYNC_ENABLED;
  const previousNotify = process.env.OPERATIONS_NOTIFICATION_ENABLED;
  const originalListIncidents = operationsSharePoint.listIncidents;
  const originalGetIncident = operationsSharePoint.getIncident;
  const originalSynchronizeWorkItems = service.synchronizeWorkItems;
  process.env.OPERATIONS_AUTOMATION_KEY = 'live-key';
  process.env.OPERATIONS_RECONCILIATION_ENABLED = 'true';
  process.env.OPERATIONS_SYNC_ENABLED = 'false';
  process.env.OPERATIONS_NOTIFICATION_ENABLED = 'false';
  operationsSharePoint.listIncidents = async () => [{
    incidentId: 'INC-031', operationsStatus: 'OPEN', workItemSummary: { total: 1, open: 1 }
  }];
  operationsSharePoint.getIncident = async () => ({ incidentId: 'INC-031', workItems: [] });
  let calls = 0;
  service.synchronizeWorkItems = async input => {
    calls += 1;
    assert.deepEqual(input.roles, ['RELATED']);
    return { incidentId: 'INC-031', items: [{ workItemId: 9101, ok: true }] };
  };
  try {
    const context = { log: { warn() {}, error() {} } };
    await reconcile(context, {
      headers: { 'x-operations-automation-key': 'live-key' },
      body: { dryRun: false, maxItems: 10, scope: 'RELATED' }
    });
    const body = JSON.parse(context.res.body);
    assert.equal(context.res.status, 200);
    assert.equal(body.succeeded, 1);
    assert.equal(calls, 1);
  } finally {
    operationsSharePoint.listIncidents = originalListIncidents;
    operationsSharePoint.getIncident = originalGetIncident;
    service.synchronizeWorkItems = originalSynchronizeWorkItems;
    for (const [key, value] of Object.entries({
      OPERATIONS_AUTOMATION_KEY: previousKey,
      OPERATIONS_RECONCILIATION_ENABLED: previousReconcile,
      OPERATIONS_SYNC_ENABLED: previousSync,
      OPERATIONS_NOTIFICATION_ENABLED: previousNotify
    })) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('reconciliation PRIMARY scope compares only primary work items in dry-run', async () => {
  const originalListIncidents = operationsSharePoint.listIncidents;
  const originalListAudit = operationsSharePoint.listAudit;
  const originalPreview = service.previewWorkItemSynchronization;
  const previousKey = process.env.OPERATIONS_AUTOMATION_KEY;
  let capturedRoles;
  process.env.OPERATIONS_AUTOMATION_KEY = 'shadow-key';
  operationsSharePoint.listIncidents = async () => [{
    ...incident,
    operationsStatus: 'OPEN',
    workItemSummary: { total: 2, open: 2 },
    workItems: [
      { workItemId: 7001, role: 'PRIMARY', state: 'Processing' },
      { workItemId: 7002, role: 'RELATED', state: 'New' }
    ]
  }];
  operationsSharePoint.listAudit = async () => [];
  service.previewWorkItemSynchronization = async input => {
    capturedRoles = input.roles;
    return { readOnly: true, items: [{ workItemId: 7001, role: 'PRIMARY', ok: true }] };
  };
  try {
    const requestContext = { log: { warn() {}, error() {} } };
    await reconcile(requestContext, {
      headers: { 'x-operations-automation-key': 'shadow-key' },
      body: { dryRun: true, compareAdo: true, scope: 'PRIMARY', maxItems: 1 }
    });
    const body = JSON.parse(requestContext.res.body);
    assert.deepEqual(capturedRoles, ['PRIMARY']);
    assert.equal(body.writeOperations, 0);
    assert.equal(body.candidates[0].adoComparison.length, 1);
    assert.equal(body.candidates[0].adoComparison[0].role, 'PRIMARY');
  } finally {
    operationsSharePoint.listIncidents = originalListIncidents;
    operationsSharePoint.listAudit = originalListAudit;
    service.previewWorkItemSynchronization = originalPreview;
    if (previousKey == null) delete process.env.OPERATIONS_AUTOMATION_KEY;
    else process.env.OPERATIONS_AUTOMATION_KEY = previousKey;
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

test('reconciliation dry-run previews notification and checks audit without sending', async () => {
  const originalListAudit = operationsSharePoint.listAudit;
  const relatedOpen = {
    ...incident,
    displayId: 'INC-2026-000235',
    workItems: [
      { workItemId: 882975, role: 'PRIMARY', state: 'Processing' },
      { workItemId: 882976, role: 'RELATED', state: 'New' }
    ],
    workItemSummary: { total: 2, closed: 0, open: 2 }
  };
  let auditReads = 0;
  operationsSharePoint.listAudit = async () => {
    auditReads += 1;
    return [];
  };
  try {
    const preview = await reconcile.notificationDryRunCandidate(relatedOpen);
    assert.equal(preview.notification.required, true);
    assert.equal(preview.notification.duplicate, false);
    assert.equal(preview.notification.type, 'RELATED_WORK_REMAINS');
    assert.match(preview.notification.eventKey, /related-open:882976:New$/);
    assert.match(preview.notification.message, /Incident: INC-2026-000235/);
    assert.match(preview.notification.message, /#882976 \(New\)/);
    assert.equal(auditReads, 1);
  } finally {
    operationsSharePoint.listAudit = originalListAudit;
  }
});

test('work item synchronization preview compares ADO without SharePoint writes or audit', async () => {
  let writes = 0;
  let audits = 0;
  const result = await service.previewWorkItemSynchronization(
    { incidentId: incident.incidentId, roles: ['PRIMARY'] },
    { accessToken: 'test-token', operationsIdentity: {}, adoIdentity: {} },
    {
      sharePoint: {
        getIncident: async () => ({
          ...incident,
          workItems: [
            { workItemId: 7001, role: 'PRIMARY', state: 'Processing', assignedTo: 'Bird', closedAt: null },
            { workItemId: 7002, role: 'RELATED', state: 'New' }
          ]
        }),
        updateIncidentRecord: async () => { writes += 1; },
        updateWorkItemRecord: async () => { writes += 1; },
        createAudit: async () => { audits += 1; }
      },
      ado: {
        getWorkItem: async id => ({
          ok: true,
          status: 200,
          body: {
            id,
            fields: {
              'System.State': 'Closed',
              'System.AssignedTo': { displayName: 'Bird' },
              'Microsoft.VSTS.Common.ClosedDate': '2026-09-27T08:00:00Z'
            }
          }
        })
      }
    }
  );
  assert.equal(result.readOnly, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].workItemId, 7001);
  assert.equal(result.items[0].matches, false);
  assert.equal(result.items[0].comparison.state.ado, 'Closed');
  assert.equal(writes, 0);
  assert.equal(audits, 0);
});

test('work item synchronization preview treats sub-second timestamp precision as equivalent', async () => {
  const result = await service.previewWorkItemSynchronization(
    { incidentId: incident.incidentId, roles: ['PRIMARY'] },
    { accessToken: 'test-token', operationsIdentity: {}, adoIdentity: {} },
    {
      sharePoint: {
        getIncident: async () => ({
          ...incident,
          workItems: [{
            workItemId: 7003,
            role: 'PRIMARY',
            state: 'Closed',
            assignedTo: 'Bird',
            closedAt: '2026-09-26T11:05:58Z'
          }]
        })
      },
      ado: {
        getWorkItem: async id => ({
          ok: true,
          status: 200,
          body: {
            id,
            fields: {
              'System.State': 'Closed',
              'System.AssignedTo': { displayName: 'Bird' },
              'Microsoft.VSTS.Common.ClosedDate': '2026-09-26T11:05:58.68Z'
            }
          }
        })
      }
    }
  );
  assert.equal(result.items[0].matches, true);
});
