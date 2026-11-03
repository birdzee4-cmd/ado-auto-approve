const assert = require('node:assert/strict');
const test = require('node:test');
const service = require('../shared/operations-service');

test('bulk close validates refreshed readiness and records batch attribution', async () => {
  const previous = process.env.OPERATIONS_CLOSE_ENABLED;
  process.env.OPERATIONS_CLOSE_ENABLED = 'true';
  try {
    for (const scenario of ['ready', 'active', 'conflict', 'open', 'sync-failed', 'closed', 'invalid-timeline', 'missing-primary']) {
      const audits = [];
      const incident = {
        sharePointId: 1, incidentId: 'INC-001', status: scenario === 'active' ? 'FIRING' : 'RESOLVED',
        operationsStatus: scenario === 'closed' ? 'CLOSED' : '',
        hasLifecycleConflict: scenario === 'conflict',
        firstSeen: '2026-10-27T08:00:00Z',
        resolvedAt: scenario === 'invalid-timeline' ? '2026-10-27T07:00:00Z' : '2026-10-27T09:00:00Z',
        workItems: [{ workItemId: 42, role: scenario === 'missing-primary' ? 'RELATED' : 'PRIMARY', state: 'Closed' }]
      };
      const dependencies = {
        sharePoint: {
          async getIncident() { return incident; },
          async updateIncidentRecord() {},
          async appendAudit(event) { audits.push(event); }
        },
        ado: { async getWorkItem(id) { return scenario === 'sync-failed' ? { ok: false, status: 503 } : { ok: true, body: { id, fields: { 'System.State': scenario === 'open' ? 'Active' : 'Closed' } } }; } }
      };
      const run = () => service.closeIncident({ incidentId: incident.incidentId, batchClose: true, batchId: 'batch-test', note: 'Reviewed recovery' }, { accessToken: 'test', operationsIdentity: { id: 'operator' } }, dependencies);
      if (scenario === 'ready' || scenario === 'closed') {
        const result = await run();
        assert.equal(result.closed, true);
        if (scenario === 'ready') {
          const closure = audits.find(event => event.Action === 'INCIDENT_CLOSED');
          assert.match(closure.Detail, /batch-test.*Reviewed recovery/);
          assert.equal(closure.OperationsUserId, 'operator');
        } else assert.equal(result.duplicate, true);
      } else {
        await assert.rejects(run);
        assert.equal(audits.some(event => event.Action === 'INCIDENT_CLOSED'), false, scenario);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.OPERATIONS_CLOSE_ENABLED;
    else process.env.OPERATIONS_CLOSE_ENABLED = previous;
  }
});
