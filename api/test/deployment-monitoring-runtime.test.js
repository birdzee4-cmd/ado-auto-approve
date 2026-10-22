const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveAuthConfig } = require('../shared/deployment-monitoring-runtime');

const base = { MONITORING_SQL_SERVER: 'uat.example', MONITORING_SQL_DATABASE: 'planning' };

test('explicit SQL mode requires both server-side secrets and does not fall back', () => {
  assert.equal(resolveAuthConfig(base), null);
  assert.equal(resolveAuthConfig({ ...base, MONITORING_SQL_AUTH_MODE: 'sql', MONITORING_SQL_USERNAME: 'u' }), null);
  const config = resolveAuthConfig({ ...base, MONITORING_SQL_AUTH_MODE: 'sql', MONITORING_SQL_USERNAME: 'u', MONITORING_SQL_PASSWORD: 'p' });
  assert.deepEqual(config, { authMode: 'sql', server: 'uat.example', database: 'planning', user: 'u', password: 'p' });
  assert.equal(resolveAuthConfig({ ...base, MONITORING_SQL_AUTH_MODE: 'sql', MONITORING_SQL_USERNAME: 'u', MONITORING_SQL_PASSWORD: 'p', MONITORING_SQL_TENANT_ID: 'tenant' }).authentication, undefined);
});

test('explicit Entra mode requires tenant/client and never falls back to SQL secrets', () => {
  assert.equal(resolveAuthConfig({ ...base, MONITORING_SQL_AUTH_MODE: 'entra' }), null);
  const config = resolveAuthConfig({ ...base, MONITORING_SQL_AUTH_MODE: 'entra', MONITORING_SQL_TENANT_ID: 'tenant', MONITORING_SQL_CLIENT_ID: 'client', MONITORING_SQL_USERNAME: 'u', MONITORING_SQL_PASSWORD: 'p' });
  assert.equal(config.authMode, 'entra'); assert.equal(config.user, undefined); assert.equal(config.password, undefined);
  assert.equal(config.authentication.type, 'azure-active-directory-default');
});

test('unsupported mode fails closed and credentials are never serialized into errors', () => {
  assert.equal(resolveAuthConfig({ ...base, MONITORING_SQL_AUTH_MODE: 'auto', MONITORING_SQL_USERNAME: 'u', MONITORING_SQL_PASSWORD: 'p' }), null);
});
