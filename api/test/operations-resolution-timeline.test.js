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

test('receipt order catches stale recovery even when stored timestamps have timezone drift', () => {
  assert.equal(service.hasInvalidResolutionTimeline({ ...incident, resolvedAt: '2026-10-19T11:29:00Z' }), true);
});

test('a subsequent recovery in the same episode permits readiness', () => {
  const recovered = { ...incident, resolvedAt: '2026-10-19T04:49:00Z', lastAlertAt: '2026-10-19T11:49:37Z' };
  assert.equal(service.closeEligibility(recovered).allowed, true);
  assert.equal(reconcile.notificationCandidate(recovered, 0).type, 'READY_TO_CLOSE');
});
