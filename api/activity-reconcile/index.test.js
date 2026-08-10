const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('./index');

function encodePrincipal(userRoles) {
  return Buffer.from(JSON.stringify({
    userDetails: 'tester@example.com',
    userRoles: userRoles
  })).toString('base64');
}

function createContext() {
  return {
    log: Object.assign(() => {}, {
      error: () => {},
      warn: () => {}
    }),
    res: null
  };
}

test('activity reconcile requires authentication', async () => {
  const context = createContext();
  await handler(context, { headers: {}, body: {} });
  assert.equal(context.res.status, 401);
  assert.equal(JSON.parse(context.res.body).ok, false);
});

test('activity reconcile rejects an approver without admin role', async () => {
  const context = createContext();
  await handler(context, {
    headers: {
      'x-ms-client-principal': encodePrincipal(['authenticated', 'it_support_approve'])
    },
    body: {}
  });
  assert.equal(context.res.status, 403);
  assert.match(JSON.parse(context.res.body).error, /Admin role required/);
});
