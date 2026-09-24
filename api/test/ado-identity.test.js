const assert = require('node:assert/strict');
const test = require('node:test');
const identity = require('../shared/ado-identity');
const auth = require('../shared/auth');
const callback = require('../ado-auth-callback');

function principal(roles) {
  return Buffer.from(JSON.stringify({
    userId: 'operations-user-id',
    userDetails: 'tier1@example.com',
    userRoles: roles
  })).toString('base64');
}

test('Azure DevOps connection data is normalized as a verified identity', () => {
  const result = identity.normalizeAdoIdentity({
    authenticatedUser: {
      id: 'ado-user-id',
      descriptor: 'aad.descriptor',
      providerDisplayName: 'Tier One User',
      uniqueName: 'tier1.ado@example.com'
    }
  });
  assert.deepEqual(result, {
    id: 'ado-user-id',
    descriptor: 'aad.descriptor',
    displayName: 'Tier One User',
    email: 'tier1.ado@example.com',
    verified: true
  });
});

test('Azure DevOps identity verification uses the delegated access token', async () => {
  let receivedOptions;
  const result = await identity.verifyAdoIdentity('delegated-token', {
    async getConnectionData(options) {
      receivedOptions = options;
      return {
        ok: true,
        status: 200,
        body: { authenticatedUser: { id: 'ado-user-id', uniqueName: 'ado@example.com' } }
      };
    }
  });
  assert.deepEqual(receivedOptions, { accessToken: 'delegated-token' });
  assert.equal(result.ok, true);
  assert.equal(result.identity.email, 'ado@example.com');
});

test('Azure DevOps identity verification fails closed for invalid responses', async () => {
  const forbidden = await identity.verifyAdoIdentity('bad-token', {
    async getConnectionData() { return { ok: false, status: 403 }; }
  });
  assert.deepEqual(forbidden, {
    ok: false,
    status: 403,
    error: 'Azure DevOps identity validation failed'
  });

  const missingIdentity = await identity.verifyAdoIdentity('token', {
    async getConnectionData() { return { ok: true, status: 200, body: {} }; }
  });
  assert.equal(missingIdentity.ok, false);
});

test('Operations writer authorization accepts Tier 1 and admin only by default', () => {
  const previous = process.env.OPERATIONS_WRITE_ROLES;
  delete process.env.OPERATIONS_WRITE_ROLES;
  try {
    const tier1 = auth.requireOperationsWriter({}, {
      headers: { 'x-ms-client-principal': principal(['it_support_approve']) }
    });
    const admin = auth.requireOperationsWriter({}, {
      headers: { 'x-ms-client-principal': principal(['admin']) }
    });
    const viewer = auth.requireOperationsWriter({ log: { warn() {} } }, {
      headers: { 'x-ms-client-principal': principal(['authenticated']) }
    });
    assert.equal(tier1.ok, true);
    assert.equal(admin.ok, true);
    assert.equal(viewer.status, 403);
  } finally {
    if (previous == null) delete process.env.OPERATIONS_WRITE_ROLES;
    else process.env.OPERATIONS_WRITE_ROLES = previous;
  }
});

test('OAuth callback query parameters are inserted before hash routes', () => {
  assert.equal(
    callback.appendQuery('/operations.html#/incidents', 'adoConnected=1'),
    '/operations.html?adoConnected=1#/incidents'
  );
});
