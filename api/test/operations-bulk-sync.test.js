const assert = require('node:assert/strict');
const test = require('node:test');
const operations = require('../operations');
const sp = require('../shared/operations-sharepoint-client');
const service = require('../shared/operations-service');
const tokens = require('../shared/ado-user-token');
const identity = require('../shared/ado-identity');

test('batch synchronization validates access, limits, partial failures and closed scope', async () => {
  const originals = [sp.getIncident, service.synchronize, tokens.getValidAccessToken, identity.verifyAdoIdentity];
  const flag = process.env.OPERATIONS_SYNC_ENABLED;
  const calls = [];
  const request = async (body, roles = ['admin']) => {
    const context = { log: { error() {}, warn() {} } };
    await operations(context, { method: 'POST', params: { path: 'incidents/synchronize' }, body,
      headers: { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userId: 'operator', userRoles: roles })).toString('base64') } });
    return context.res;
  };
  try {
    process.env.OPERATIONS_SYNC_ENABLED = 'true';
    tokens.getValidAccessToken = async () => ({ ok: true, accessToken: 'test' });
    identity.verifyAdoIdentity = async () => ({ ok: true, identity: {} });
    sp.getIncident = async id => ({ incidentId: id, operationsStatus: id === 'closed' ? 'CLOSED' : '' });
    service.synchronize = async ({ incidentId }, context) => {
      assert.equal(context.accessToken, 'test'); calls.push(incidentId);
      if (incidentId === 'throw') throw new Error('Unavailable');
      return { items: [{ ok: incidentId !== 'partial' }] };
    };
    assert.equal((await request({ incidentIds: ['one'] }, ['authenticated'])).status, 403);
    assert.equal((await request({ incidentIds: [] })).status, 400);
    assert.equal((await request({ incidentIds: Array(6).fill('one') })).status, 400);
    assert.equal((await request({ incidentIds: ['bad/path'] })).status, 400);
    process.env.OPERATIONS_SYNC_ENABLED = 'false';
    assert.equal((await request({ incidentIds: ['one'] })).status, 503);
    process.env.OPERATIONS_SYNC_ENABLED = 'true';
    const result = await request({ incidentIds: ['one', 'partial', 'throw', 'closed', 'one'] });
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.body).data.results.map(item => [item.incidentId, item.ok, !!item.skipped]), [
      ['one', true, false], ['partial', false, false], ['throw', false, false], ['closed', true, true]
    ]);
    assert.deepEqual(calls, ['one', 'partial', 'throw']);
    await request({ incidentIds: ['closed'], includeClosed: true });
    assert.equal(calls.at(-1), 'closed');
    tokens.getValidAccessToken = async () => ({ ok: false, status: 428 });
    assert.equal((await request({ incidentIds: ['one'] })).status, 428);
  } finally {
    [sp.getIncident, service.synchronize, tokens.getValidAccessToken, identity.verifyAdoIdentity] = originals;
    if (flag === undefined) delete process.env.OPERATIONS_SYNC_ENABLED; else process.env.OPERATIONS_SYNC_ENABLED = flag;
  }
});

