const assert = require('node:assert/strict');
const test = require('node:test');
const { getPublicErrorDetail } = require('../shared/appservice-portal-handlers');

test('Azure failures identify the action needed without exposing SDK messages', () => {
  const secretMessage = 'Bearer secret-token client_secret=secret';
  for (const [error, expected] of [
    [{ code: 'AuthorizationFailed', statusCode: 403 }, /identity permissions/],
    [{ code: 'ResourceGroupNotFound', statusCode: 404 }, /subscription and resource group/],
    [{ code: 'InvalidAuthenticationToken', statusCode: 401 }, /authentication failed/],
    [{ statusCode: 500 }, /Azure App Service request failed/]
  ]) {
    const detail = getPublicErrorDetail({ ...error, message: secretMessage });
    assert.match(detail, expected);
    assert.ok(!detail.includes('secret'));
  }
});

test('explicitly public validation and cooldown errors retain their detail', () => {
  assert.equal(getPublicErrorDetail({ expose: true, statusCode: 429, message: 'Restart cooldown is active' }), 'Restart cooldown is active');
});
