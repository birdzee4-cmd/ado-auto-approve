const assert = require('node:assert/strict');
const test = require('node:test');
const reconcile = require('../operations-reconcile');

const baseIncident = {
  incidentId: 'INC-AUTO-1',
  alertName: 'AzureAppService5xxCountCritical',
  resource: 'prd-interface-accounting',
  priority: 'P1',
  status: 'FIRING',
  operationsStatus: 'OPEN',
  firstSeen: '2026-11-17T14:00:00.000Z',
  workItems: [{ role: 'PRIMARY', workItemId: 906361, state: 'Processing' }]
};

function deps(audits = [], calls = []) {
  if (!audits.some(item => item.eventType === 'GLOBAL_AUTO_RESTART_CONFIG')) audits.push({ eventType: 'GLOBAL_AUTO_RESTART_CONFIG', result: 'ENABLED', timestamp: '2026-11-17T14:00:00.000Z' });
  return {
    sharePoint: { listAudit: async () => audits },
    service: {
      featureEnabled: name => name === 'OPERATIONS_AUTO_RESTART_ENABLED' || name === 'OPERATIONS_RESTART_ENABLED',
      audit: async (_sp, _ctx, event) => audits.push({ eventKey: event.eventKey, result: event.result }),
      restartAppService: async input => { calls.push(input); return { discussionAdded: true }; }
    }
  };
}

test('auto restart waits until five minutes after first seen', async () => {
  const result = await reconcile.autoRestartIfDue(baseIncident, {}, Date.parse(baseIncident.firstSeen) + 4 * 60 * 1000, deps());
  assert.equal(result.attempted, false);
  assert.equal(result.reason, 'waiting');
});

test('auto restart runs once for an active P1 App Service incident', async () => {
  const audits = [];
  const calls = [];
  const result = await reconcile.autoRestartIfDue(baseIncident, {}, Date.parse(baseIncident.firstSeen) + 5 * 60 * 1000, deps(audits, calls));
  assert.equal(result.ok, true);
  assert.equal(result.attempted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].resource, 'prd-interface-accounting');
  assert.equal(audits[0].result, 'STARTED');
  assert.equal(audits[1].result, 'SUCCEEDED');
});

test('auto restart does not repeat an existing attempt', async () => {
  const calls = [];
  const result = await reconcile.autoRestartIfDue(baseIncident, {}, Date.parse(baseIncident.firstSeen) + 10 * 60 * 1000, deps([{ eventKey: 'operations-auto-restart:INC-AUTO-1:completed' }], calls));
  assert.equal(result.attempted, false);
  assert.equal(result.reason, 'already-attempted');
  assert.equal(calls.length, 0);
});

test('auto restart retries after a previous failed attempt', async () => {
  const audits = [{ eventKey: 'operations-auto-restart:INC-AUTO-1', result: 'STARTED' }, { eventKey: 'operations-auto-restart:INC-AUTO-1:failed', result: 'FAILED' }];
  const calls = [];
  const result = await reconcile.autoRestartIfDue(baseIncident, {}, Date.parse(baseIncident.firstSeen) + 10 * 60 * 1000, deps(audits, calls));
  assert.equal(result.attempted, true);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
});
