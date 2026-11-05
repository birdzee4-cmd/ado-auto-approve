const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, load } = require('../shared/company-deployment-monitor');
const row = overrides => ({ BuildId: '615209_M', CiName: 'service', Status: 'Complete', Branch: 'staging', LastUpdate: '05/11/2026 20:06:13', ...overrides });
test('preserves module/plugin identities and separates environment from Git branch', () => {
  const items = normalize([row({ BranchName: 'refs/heads/main' }), row({ BuildId: '615209_P', Status: 'Build fail' })]);
  assert.equal(items.length, 2); assert.notEqual(items[0].id, items[1].id);
  assert.equal(items[0].azureBuildId, '615209'); assert.equal(items[0].environment, 'Staging');
  assert.equal(items[0].branch, 'refs/heads/main'); assert.equal(items[1].terminal, true);
  assert.equal(items[0].updatedAt, '2026-11-05T20:06:13+07:00');
});
test('terminal rules include failure and cancellation; unknown environment stays Other', () => {
  const items = normalize(['Complete', 'Build fail', 'Deploy fail', 'Cancel Deploy', 'Building'].map(Status => row({ Status, Branch: 'unmapped' })));
  assert.equal(items.filter(item => item.terminal).length, 4); assert.ok(items.every(item => item.environment === 'Other'));
});
test('sorts newest first and rejects malformed upstream without returning partial counts', () => {
  assert.equal(normalize([row({ LastUpdate: '05/11/2026 09:00:00' }), row({ BuildId: '2' })])[0].id, '2');
  assert.throws(() => normalize({})); assert.throws(() => normalize([row({}), {}]));
});
test('upstream errors and HTML login responses are rejected', async () => {
  await assert.rejects(load(async () => ({ ok: false })));
  await assert.rejects(load(async () => ({ ok: true, headers: new Headers({ 'content-type': 'text/html' }) })));
});
test('HTTP handler requires dashboard roles before accessing upstream', async () => {
  const handler = require('../company-deployment-monitor');
  const context = { log: { warn() {}, error() {} } };
  await handler(context, { headers: {} }); assert.equal(context.res.status, 401);
  const principal = Buffer.from(JSON.stringify({ userRoles: ['authenticated'] })).toString('base64');
  await handler(context, { headers: { 'x-ms-client-principal': principal } }); assert.equal(context.res.status, 403);
});
