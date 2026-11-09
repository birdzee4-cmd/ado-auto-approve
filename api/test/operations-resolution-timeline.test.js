const assert = require('node:assert/strict');
const test = require('node:test');
const service = require('../shared/operations-service');
const reconcile = require('../operations-reconcile');

const incident = {
  incidentId: 'inc-324', status: 'RESOLVED', firstSeen: '2026-10-19T04:39:00Z',
  resolvedAt: '2026-10-19T03:29:00Z', receivedAt: '2026-10-19T11:39:36Z',
  lastAlertAt: '2026-10-19T10:29:37Z',
  workItems: [{ role: 'PRIMARY', state: 'Closed', workItemId: 892972 }]
};

test('a stale recovery cannot trigger readiness or automatic primary closure', async () => {
  assert.equal(service.closeEligibility(incident).allowed, false);
  assert.equal(reconcile.notificationCandidate(incident, 0), null);
  const result = await service.closeResolvedPrimaryIfReady({ incidentId: incident.incidentId }, {}, {
    sharePoint: { getIncident: async () => ({ ...incident, workItems: [{ ...incident.workItems[0], state: 'New' }] }) },
    ado: { updateWorkItem: async () => assert.fail('must not write to ADO') }
  });
  assert.equal(result.reason, 'invalid-resolution-timeline');
});

test('reconciliation repairs a stale recovery timestamp before closing VSTS', async () => {
  const writes = [];
  const audits = [];
  const repaired = { ...incident, workItems: [{ ...incident.workItems[0], state: 'Closed' }] };
  const result = await service.closeResolvedPrimaryIfReady({ incidentId: incident.incidentId }, {}, {
    sharePoint: {
      getIncident: async () => ({ ...repaired, resolvedAt: writes[0]?.ResolvedAt || repaired.resolvedAt }),
      updateIncidentRecord: async (_id, fields) => writes.push(fields),
      appendAudit: async event => audits.push(event),
      listAudit: async () => []
    },
    ado: {
      getWorkItem: async () => ({ ok: true, body: { id: 892972, rev: 1, fields: { 'System.State': 'New' } } }),
      updateWorkItem: async () => ({ ok: true, body: { id: 892972, fields: { 'System.State': 'Closed' } } })
    }
  });
  assert.equal(result.closed, true);
  assert.equal(writes[0].ResolvedAt, incident.lastAlertAt);
  assert.equal(audits[0].Action, 'RESOLVED_TIMELINE_NORMALIZED');
});

test('receipt order catches stale recovery even when stored timestamps have timezone drift', () => {
  assert.equal(service.hasInvalidResolutionTimeline({ ...incident, resolvedAt: '2026-10-19T11:29:00Z' }), true);
});

test('a subsequent recovery in the same episode permits readiness', () => {
  const recovered = { ...incident, resolvedAt: '2026-10-19T04:49:00Z', lastAlertAt: '2026-10-19T11:49:37Z' };
  assert.equal(service.closeEligibility(recovered).allowed, true);
  assert.equal(reconcile.notificationCandidate(recovered, 0).type, 'READY_TO_CLOSE');
});
